const { getPool } = require("./database");
const { syncDomainState } = require("./domain-sync");

function number(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) throw new Error("库存变动数量必须为非零数字");
  return parsed;
}

async function adjustInventoryBatch({ adjustments, operatorId, sourceId = null, sourceModule = null, mutateState = null }) {
  if (!Array.isArray(adjustments) || !adjustments.length) throw new Error("至少需要一条库存变动");
  // 所有事务按相同顺序锁定库存行，避免两张多产品单据交叉锁行造成死锁。
  const orderedAdjustments = [...adjustments].sort((left, right) => String(left.inventoryId).localeCompare(String(right.inventoryId)));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const change of orderedAdjustments) {
      if (!change.inventoryId) throw new Error("缺少库存记录");
      const quantity = number(change.delta);
      const locked = await client.query("SELECT id, stock, data FROM inventory WHERE id = $1 FOR UPDATE", [change.inventoryId]);
      if (!locked.rows.length) throw new Error("库存记录不存在");
      const row = locked.rows[0];
      const beforeStock = Number(row.stock);
      const afterStock = beforeStock + quantity;
      if (afterStock < 0) throw new Error("库存不足，无法完成出库");
      const action = change.action || (quantity > 0 ? "入库" : "出库");
      const movementId = `im-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await client.query("UPDATE inventory SET stock = $2, data = $3::jsonb, synced_at = now() WHERE id = $1", [change.inventoryId, afterStock, JSON.stringify({ ...row.data, stock: afterStock })]);
      await client.query(`INSERT INTO inventory_movements (id, inventory_id, action, quantity, before_stock, after_stock, source_id, source_module, operator_id, occurred_at, data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10::jsonb)`, [movementId, change.inventoryId, action, Math.abs(quantity), beforeStock, afterStock, sourceId, sourceModule, operatorId, JSON.stringify({ id: movementId, itemId: change.inventoryId, action, quantity: Math.abs(quantity), beforeStock, afterStock, sourceId, sourceModule, operatorId, remark: change.remark || "", createdAt: new Date().toISOString() })]);
      results.push({ movementId, inventoryId: change.inventoryId, action, quantity: Math.abs(quantity), beforeStock, afterStock, remark: change.remark || "" });
    }
    const stateResult = await client.query("SELECT data FROM app_state WHERE id = $1 FOR UPDATE", ["main"]);
    let revision = null;
    if (stateResult.rows.length) {
      const state = stateResult.rows[0].data;
      for (const result of results) {
        const item = Array.isArray(state.inventory) && state.inventory.find((candidate) => candidate.id === result.inventoryId);
        if (item) item.stock = result.afterStock;
        state.inventoryLogs = state.inventoryLogs || [];
        state.inventoryLogs.unshift({ id: result.movementId, itemId: result.inventoryId, action: result.action, quantity: result.quantity, beforeStock: result.beforeStock, afterStock: result.afterStock, sourceId, sourceType: sourceModule, operatorId, createdAt: new Date().toISOString(), remark: result.remark });
      }
      if (typeof mutateState === "function") await mutateState(state, results);
      revision = Number(state.meta?.revision || 0) + 1;
      state.meta = { ...(state.meta || {}), revision };
      await client.query("UPDATE app_state SET data = $2::jsonb, updated_at = now() WHERE id = $1", ["main", JSON.stringify(state)]);
      await syncDomainState(client, state);
    }
    await client.query("COMMIT");
    return { results, revision };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function receivePurchase({ purchaseId, operatorId }) {
  const { readState } = require("./database");
  let snapshot = await readState();
  const purchase = (snapshot.purchases || []).find((record) => record.id === purchaseId);
  if (!purchase) throw new Error("采购单不存在");
  if (purchase.status !== "在途" || purchase.receivedApplied) throw new Error("该采购单当前不能确认到货");
  const items = Array.isArray(purchase.items) && purchase.items.length ? purchase.items : [{ inventoryId: purchase.inventoryId, quantity: purchase.quantity }];
  for (const line of items) {
    const existing = (snapshot.inventory || []).find((record) => record.id === line.inventoryId
      || (line.productId && record.productId === line.productId)
      || (record.name === line.product && String(record.model || "") === String(line.model || "")));
    if (existing) continue;
    const product = (snapshot.products || []).find((record) => record.id === line.productId
      || (record.name === line.product && String(record.model || "") === String(line.model || ""))) || {};
    await ensureInventory({
      operatorId,
      item: {
        id: `inv-auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        productId: product.id || line.productId || "",
        sku: product.sku || "",
        name: product.name || line.product || "未命名产品",
        model: product.model || line.model || "",
        category: product.category || "其他",
        safeStock: Number(product.safeStock || 0), stock: 0, locked: 0, inTransit: 0,
        location: "待分配", remark: "由采购到货自动创建",
      },
    });
  }
  snapshot = await readState();
  const adjustments = items.map((line) => {
    const inventory = (snapshot.inventory || []).find((record) => record.id === line.inventoryId
      || (line.productId && record.productId === line.productId)
      || (record.name === line.product && String(record.model || "") === String(line.model || "")));
    if (!inventory) throw new Error("采购产品尚未建立库存记录，请先保存库存台账");
    return { inventoryId: inventory.id, delta: Number(line.quantity || 0), action: "入库", remark: `采购到货 ${purchase.code}` };
  });
  return adjustInventoryBatch({
    adjustments, operatorId, sourceId: purchase.id, sourceModule: "purchase",
    mutateState: (state) => {
      const current = (state.purchases || []).find((record) => record.id === purchaseId);
      if (!current || current.status !== "在途" || current.receivedApplied) throw new Error("采购单已被其他操作处理，请刷新后重试");
      current.status = "已到货";
      current.receivedApplied = true;
      current.inTransitCleared = true;
      current.updatedAt = new Date().toISOString();
      for (const line of items) {
        const inventory = (state.inventory || []).find((record) => record.id === line.inventoryId
          || (line.productId && record.productId === line.productId)
          || (record.name === line.product && String(record.model || "") === String(line.model || "")));
        if (inventory && current.inTransitApplied) {
          inventory.inTransit = Math.max(0, Number(inventory.inTransit || 0) - Number(line.quantity || 0));
          if (!Number(inventory.inTransit)) inventory.eta = "";
        }
      }
      if (current.sourceSalesOrderId) {
        const order = (state.salesOrders || []).find((record) => record.id === current.sourceSalesOrderId);
        if (order && order.status !== "已取消") {
          const orderItems = Array.isArray(order.items) && order.items.length ? order.items : [{ inventoryId: order.inventoryId, productId: order.productId, product: order.product, model: order.model, quantity: order.quantity }];
          const ready = orderItems.every((line) => {
            const inventory = (state.inventory || []).find((record) => record.id === line.inventoryId
              || (line.productId && record.productId === line.productId)
              || (record.name === line.product && String(record.model || "") === String(line.model || "")));
            return inventory && Number(inventory.stock || 0) - Number(inventory.locked || 0) >= Number(line.quantity || 0);
          });
          order.status = ready ? "待出库" : "待采购到货";
          order.updatedAt = new Date().toISOString();
        }
      }
    },
  });
}

async function confirmDeliveryOutbound({ deliveryId, operatorId }) {
  const { readState } = require("./database");
  const snapshot = await readState();
  const delivery = (snapshot.deliveries || []).find((record) => record.id === deliveryId);
  if (!delivery) throw new Error("出库单不存在");
  if (delivery.status !== "待出库") throw new Error("该出库单当前不能确认出库");
  const rawItems = Array.isArray(delivery.items) && delivery.items.length ? delivery.items : [{ inventoryId: delivery.inventoryId, quantity: delivery.quantity }];
  if (!rawItems.length || rawItems.some((line) => !line.inventoryId || Number(line.quantity || 0) <= 0)) throw new Error("出库单缺少有效产品或数量");
  const productsById = new Map((snapshot.products || []).map((item) => [item.id, item]));
  const items = rawItems.map((line) => {
    const inventory = (snapshot.inventory || []).find((item) => item.id === line.inventoryId);
    const product = productsById.get(line.productId) || productsById.get(inventory?.productId);
    const model = line.model || inventory?.model || product?.model || "";
    if (!inventory || !model) throw new Error("出库必须绑定有效的库存产品和型号/规格，请补齐库存档案后重试");
    return {
      ...line,
      inventoryId: inventory.id,
      productId: line.productId || inventory.productId || product?.id || "",
      product: line.product || inventory.name || product?.name || "",
      model,
      quantity: Number(line.quantity),
    };
  });
  return adjustInventoryBatch({
    adjustments: items.map((line) => ({ inventoryId: line.inventoryId, delta: -Number(line.quantity), action: "出库", remark: `出库单 ${delivery.code}` })),
    operatorId, sourceId: deliveryId, sourceModule: "delivery",
    mutateState: (state) => {
      const current = (state.deliveries || []).find((record) => record.id === deliveryId);
      if (!current || current.status !== "待出库") throw new Error("出库单已被其他操作处理，请刷新后重试");
      current.items = items;
      const first = items[0];
      current.inventoryId = first.inventoryId;
      current.productId = first.productId;
      current.product = first.product;
      current.model = first.model;
      current.status = "已出库";
      current.outboundAt = new Date().toISOString();
      current.updatedAt = new Date().toISOString();
      const order = (state.salesOrders || []).find((record) => record.id === current.sourceSalesOrderId);
      if (order) { order.status = "已出库"; order.updatedAt = new Date().toISOString(); }
      const afterSales = (state.aftersales || []).find((record) => record.id === current.sourceAfterSalesId);
      if (afterSales) { afterSales.status = "已换货"; afterSales.result = `换货设备已出库，出库单 ${current.code}`; afterSales.updatedAt = new Date().toISOString(); }
    },
  });
}

async function adjustInventory(change) {
  const batch = await adjustInventoryBatch({ adjustments: [change], operatorId: change.operatorId, sourceId: change.sourceId, sourceModule: change.sourceModule });
  return { ...batch.results[0], revision: batch.revision };
}

async function ensureInventory({ item, operatorId }) {
  if (!item || !item.id || !item.name) throw new Error("库存记录缺少名称或编号");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const stateResult = await client.query("SELECT data FROM app_state WHERE id = $1 FOR UPDATE", ["main"]);
    if (!stateResult.rows.length) throw new Error("系统数据尚未初始化");
    const state = stateResult.rows[0].data;
    state.inventory = Array.isArray(state.inventory) ? state.inventory : [];
    const existing = state.inventory.find((candidate) => candidate.id === item.id
      || (item.productId && candidate.productId === item.productId)
      || (candidate.name === item.name && String(candidate.model || "") === String(item.model || "")));
    if (existing) {
      await client.query("COMMIT");
      return { item: existing, created: false, revision: Number(state.meta?.revision || 0) };
    }
    const normalized = {
      ...item,
      stock: Number(item.stock || 0),
      locked: Number(item.locked || 0),
      inTransit: Number(item.inTransit || 0),
      owner: item.owner || operatorId || "",
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await client.query(`INSERT INTO inventory (id, product_id, sku, stock, locked, in_transit, data, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now())`, [normalized.id, normalized.productId || null, normalized.sku || null, normalized.stock, normalized.locked, normalized.inTransit, JSON.stringify(normalized)]);
    state.inventory.unshift(normalized);
    const revision = Number(state.meta?.revision || 0) + 1;
    state.meta = { ...(state.meta || {}), revision };
    await client.query("UPDATE app_state SET data = $2::jsonb, updated_at = now() WHERE id = $1", ["main", JSON.stringify(state)]);
    await client.query("COMMIT");
    return { item: normalized, created: true, revision };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { adjustInventory, adjustInventoryBatch, ensureInventory, receivePurchase, confirmDeliveryOutbound };
