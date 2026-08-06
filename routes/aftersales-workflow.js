function nowIso() {
  return new Date().toISOString();
}

function nextCode(prefix) {
  return `${prefix}${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function logAction(state, operatorId, action, moduleId, recordId, detail) {
  state.auditLogs = state.auditLogs || [];
  state.auditLogs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action, moduleId, recordId, detail, operatorId, createdAt: nowIso(),
  });
}

function createAfterSalesWorkflowRoute({ readBody, maxBodyBytes, sendJson, requireUser, readState, writeState, canPerformWorkflow }) {
  async function handle(req, res) {
    const matched = req.url.match(/^\/api\/aftersales\/([^/]+)\/create-replacement-delivery$/);
    if (req.method !== "POST" || !matched) return false;
    const user = await requireUser(req, res);
    if (!user) return true;
    const state = await readState();
    if (!canPerformWorkflow(state, user, "aftersales_replacement_delivery")) {
      sendJson(res, 403, { ok: false, error: "FORBIDDEN", message: "当前账号没有生成换货出库单的流程权限" });
      return true;
    }
    const record = (state.aftersales || []).find((item) => item.id === decodeURIComponent(matched[1]));
    if (!record) {
      sendJson(res, 404, { ok: false, error: "NOT_FOUND", message: "售后工单不存在或已被删除" });
      return true;
    }
    if (record.status !== "待换货") {
      sendJson(res, 409, { ok: false, error: "INVALID_STATUS", message: "当前售后单不处于待换货状态，请刷新后重试" });
      return true;
    }
    const payload = JSON.parse(await readBody(req, maxBodyBytes) || "{}");
    const quantity = Number(payload.quantity || 0);
    const inventory = (state.inventory || []).find((item) => item.id === payload.inventoryId);
    if (!inventory || !Number.isFinite(quantity) || quantity <= 0) {
      sendJson(res, 400, { ok: false, error: "INVALID_INPUT", message: "请选择实际换货产品，并填写大于 0 的数量" });
      return true;
    }
    const available = Number(inventory.stock || 0) - Number(inventory.locked || 0);
    if (available < quantity) {
      sendJson(res, 409, { ok: false, error: "INSUFFICIENT_STOCK", message: `库存不足：${inventory.name} 可用 ${available}，无法换货出库 ${quantity}` });
      return true;
    }
    const existing = (state.deliveries || []).find((item) => item.sourceAfterSalesId === record.id && item.status !== "已取消");
    if (existing) {
      sendJson(res, 200, { ok: true, aftersales: record, delivery: existing, revision: Number(state.meta?.revision || 0), message: `该售后单已有换货出库单 ${existing.code}` });
      return true;
    }
    const productDefinition = (state.products || []).find((item) => item.id === inventory.productId);
    const product = inventory.name || productDefinition?.name || record.product || "";
    const model = inventory.model || productDefinition?.model || record.model || "";
    if (!product || !model) {
      sendJson(res, 409, { ok: false, error: "MISSING_MODEL", message: "换货出库必须绑定产品和型号/规格；请先在库存台账补齐该库存项的型号/规格" });
      return true;
    }
    const line = {
      id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      inventoryId: inventory.id,
      productId: inventory.productId || productDefinition?.id || record.productId || "",
      product,
      model,
      quantity,
      unitPrice: 0,
    };
    const delivery = {
      id: `delivery-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      code: nextCode("D"),
      date: nowIso().slice(0, 10),
      project: record.customer || "",
      type: "售后换货",
      inventoryId: inventory.id,
      productId: line.productId,
      product: line.product,
      model: line.model,
      quantity,
      items: [line],
      receiver: record.customer || "",
      owner: record.owner || user.id,
      tested: "是",
      systemReady: "不适用",
      training: "不需要",
      status: "待出库",
      sourceAfterSalesId: record.id,
      remark: `由售后工单 ${record.code} 生成换货出库`,
      createdBy: user.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.deliveries = state.deliveries || [];
    state.deliveries.unshift(delivery);
    record.replacementInventoryId = inventory.id;
    record.replacementQuantity = quantity;
    record.replacementDeliveryId = delivery.id;
    record.status = "换货待出库";
    record.updatedAt = nowIso();
    logAction(state, user.id, "replacement_create", "aftersales", record.id, `已生成换货出库单 ${delivery.code}`);
    logAction(state, user.id, "create", "deliveries", delivery.id, `由售后工单 ${record.code} 生成换货出库单`);
    const revision = Number(state.meta?.revision || 0);
    state.meta = { ...(state.meta || {}), revision: revision + 1, updatedAt: nowIso() };
    await writeState(state, revision);
    sendJson(res, 200, { ok: true, aftersales: record, delivery, revision: revision + 1, message: `换货出库单 ${delivery.code} 已生成，等待仓库确认出库` });
    return true;
  }
  return { handle };
}

module.exports = { createAfterSalesWorkflowRoute };
