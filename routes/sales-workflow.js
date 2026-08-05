function nowIso() {
  return new Date().toISOString();
}

function nextCode(prefix) {
  return `${prefix}${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function documentItems(record) {
  if (Array.isArray(record?.items) && record.items.length) return record.items;
  if (!record?.product) return [];
  return [{
    id: `${record.id || "line"}-1`,
    productId: record.productId || "",
    product: record.product,
    model: record.model || "",
    inventoryId: record.inventoryId || "",
    quantity: Number(record.quantity || 0),
    unitPrice: Number(record.unitPrice || 0),
  }];
}

function applyLegacyItemSummary(record) {
  const items = documentItems(record);
  record.items = items;
  const first = items[0] || {};
  record.productId = first.productId || record.productId || "";
  record.product = first.product || record.product || "";
  record.model = first.model || record.model || "";
  record.inventoryId = first.inventoryId || record.inventoryId || "";
  record.quantity = items.reduce((total, item) => total + Number(item.quantity || 0), 0);
  record.totalAmount = items.reduce((total, item) => total + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
}

function findInventory(state, line) {
  const inventory = state.inventory || [];
  if (line.inventoryId) {
    const matched = inventory.find((item) => item.id === line.inventoryId);
    if (matched) return matched;
  }
  if (line.productId) {
    const matched = inventory.find((item) => item.productId === line.productId && (!line.model || normalize(item.model) === normalize(line.model)));
    if (matched) return matched;
  }
  return inventory.find((item) => normalize(item.name) === normalize(line.product) && (!line.model || normalize(item.model) === normalize(line.model)));
}

function logAction(state, operatorId, action, moduleId, recordId, detail) {
  state.auditLogs = state.auditLogs || [];
  state.auditLogs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    moduleId,
    recordId,
    detail,
    operatorId,
    createdAt: nowIso(),
  });
}

function evaluateInventory(state, order) {
  const readyItems = [];
  const shortages = [];
  for (const line of documentItems(order)) {
    const inventory = findInventory(state, line);
    const available = Math.max(0, Number(inventory?.stock || 0) - Number(inventory?.locked || 0));
    const quantity = Number(line.quantity || 0);
    const normalized = { ...line, inventoryId: inventory?.id || line.inventoryId || "" };
    if (inventory && available >= quantity) readyItems.push(normalized);
    else shortages.push({ ...normalized, shortage: Math.max(0, quantity - available) });
  }
  return { ready: shortages.length === 0, readyItems, shortages };
}

function cancelReversiblePurchases(state, order, operatorId) {
  const statuses = new Set(["待采购审批", "待技术确认", "待采购确认", "异常"]);
  (state.purchases || []).filter((purchase) => purchase.sourceSalesOrderId === order.id && statuses.has(purchase.status)).forEach((purchase) => {
    purchase.status = "已取消";
    purchase.updatedAt = nowIso();
    logAction(state, operatorId, "cancel", "purchases", purchase.id, `销售订单 ${order.code} 库存已满足，自动作废待处理采购申请`);
  });
}

function createPurchase(state, order, shortages, operatorId, details = {}) {
  const existing = (state.purchases || []).find((purchase) => purchase.sourceSalesOrderId === order.id && purchase.status !== "已取消");
  if (existing) return existing;
  const buyer = (state.users || []).find((user) => user.role === "purchase" && user.status === "启用");
  const purchase = {
    id: `purchase-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    code: nextCode("PR"),
    requester: order.owner || operatorId,
    owner: buyer?.id || "",
    type: "项目采购",
    items: shortages.map((line) => ({ ...line, quantity: Number(line.shortage || line.quantity || 0) })),
    project: order.customer || "",
    requiredDate: details.requiredDate || order.deliveryDate || "",
    sourceSalesOrderId: order.id,
    status: "待采购审批",
    remark: details.remark || `销售订单 ${order.code} 库存不足，等待有采购权限的人员审批`,
    createdBy: operatorId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  applyLegacyItemSummary(purchase);
  state.purchases = state.purchases || [];
  state.purchases.unshift(purchase);
  order.purchaseId = purchase.id;
  logAction(state, operatorId, "create", "purchases", purchase.id, `销售订单 ${order.code} 缺货自动生成采购申请`);
  return purchase;
}

function createSalesWorkflowRoute({ readBody, maxBodyBytes, sendJson, requireUser, readState, writeState, canPerformWorkflow }) {
  async function saveWorkflow(state, revision) {
    state.meta = { ...(state.meta || {}), revision: revision + 1, updatedAt: nowIso() };
    return writeState(state, revision);
  }

  async function handle(req, res) {
    const matched = req.url.match(/^\/api\/sales-orders\/([^/]+)\/(approve|check-inventory|create-purchase-request)$/);
    if (req.method !== "POST" || !matched) return false;
    const user = await requireUser(req, res);
    if (!user) return true;
    const [, encodedId, action] = matched;
    const state = await readState();
    const requiredAction = action === "approve" ? "sales_approve" : (action === "create-purchase-request" ? "purchase_request_create" : "inventory_check");
    if (!canPerformWorkflow(state, user, requiredAction)) {
      sendJson(res, 403, { ok: false, error: "FORBIDDEN", message: "当前账号没有此流程操作权限" });
      return true;
    }
    const order = (state.salesOrders || []).find((item) => item.id === decodeURIComponent(encodedId));
    if (!order) {
      sendJson(res, 404, { ok: false, error: "NOT_FOUND", message: "销售订单不存在或已被删除" });
      return true;
    }
    if (action === "create-purchase-request") {
      if (order.status !== "待采购申请") {
        sendJson(res, 409, { ok: false, error: "INVALID_STATUS", message: "当前订单不需要发起采购申请" });
        return true;
      }
      const check = evaluateInventory(state, order);
      const revision = Number(state.meta?.revision || 0);
      order.updatedAt = nowIso();
      if (check.ready) {
        order.status = "待出库";
        order.items = check.readyItems;
        delete order.procurementShortages;
        applyLegacyItemSummary(order);
        logAction(state, user.id, "inventory_check", "salesOrders", order.id, "发起采购前复核发现库存已满足，订单转为待出库");
        await saveWorkflow(state, revision);
        sendJson(res, 200, { ok: true, status: order.status, order, message: "库存已满足，无需采购，销售订单已进入待出库" });
        return true;
      }
      const payload = JSON.parse(await readBody(req, maxBodyBytes) || "{}");
      const purchase = createPurchase(state, order, check.shortages, user.id, {
        requiredDate: String(payload.requiredDate || "").slice(0, 10),
        remark: String(payload.remark || "").trim(),
      });
      order.status = "待采购审批";
      order.procurementShortages = check.shortages;
      logAction(state, user.id, "purchase_request", "salesOrders", order.id, `已确认缺货并发起采购申请 ${purchase.code}`);
      await saveWorkflow(state, revision);
      sendJson(res, 200, { ok: true, status: order.status, order, purchaseId: purchase.id, message: `采购申请 ${purchase.code} 已发给采购部门` });
      return true;
    }
    if (action === "approve") {
      if (order.status !== "待销售审批") {
        sendJson(res, 409, { ok: false, error: "INVALID_STATUS", message: "订单状态已变化，请刷新后重试" });
        return true;
      }
      order.approvedBy = user.id;
      order.approvedAt = nowIso();
      logAction(state, user.id, "approve", "salesOrders", order.id, "销售订单审批通过，系统开始核验库存");
    } else if (order.status !== "待库存确认") {
      sendJson(res, 409, { ok: false, error: "INVALID_STATUS", message: "当前订单无需重新核验库存" });
      return true;
    }

    const check = evaluateInventory(state, order);
    order.updatedAt = nowIso();
    const revision = Number(state.meta?.revision || 0);
    if (check.ready) {
      cancelReversiblePurchases(state, order, user.id);
      order.status = "待出库";
      order.items = check.readyItems;
      applyLegacyItemSummary(order);
      logAction(state, user.id, "inventory_check", "salesOrders", order.id, `订单 ${documentItems(order).length} 项产品库存均充足，可一次性出库`);
      await saveWorkflow(state, revision);
      sendJson(res, 200, { ok: true, status: order.status, order, message: "库存充足，销售订单已进入待出库" });
      return true;
    }

    order.status = "待采购申请";
    order.procurementShortages = check.shortages;
    logAction(state, user.id, "inventory_shortage", "salesOrders", order.id, `有 ${check.shortages.length} 项产品库存不足，等待销售确认采购申请`);
    await saveWorkflow(state, revision);
    sendJson(res, 200, { ok: true, status: order.status, order, shortages: check.shortages, message: "审批通过，库存不足，请确认后发起采购申请" });
    return true;
  }

  return { handle };
}

module.exports = { createSalesWorkflowRoute };
