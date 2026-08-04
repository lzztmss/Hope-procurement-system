const { getPool } = require("./database");

function number(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) throw new Error("库存变动数量必须为非零数字");
  return parsed;
}

async function adjustInventoryBatch({ adjustments, operatorId, sourceId = null, sourceModule = null }) {
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
      revision = Number(state.meta?.revision || 0) + 1;
      state.meta = { ...(state.meta || {}), revision };
      await client.query("UPDATE app_state SET data = $2::jsonb, updated_at = now() WHERE id = $1", ["main", JSON.stringify(state)]);
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

module.exports = { adjustInventory, adjustInventoryBatch, ensureInventory };
