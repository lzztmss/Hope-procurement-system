function createInventoryRoute({
  readBody,
  maxBodyBytes,
  sendJson,
  requireUser,
  listInventory,
  adjustInventory,
  adjustInventoryBatch,
  ensureInventory,
  receivePurchase,
  confirmDeliveryOutbound,
  canWorkflow,
  readState,
  canAccessModule,
}) {
  const permittedRoles = new Set(["admin", "warehouse", "purchase", "aftersales"]);
  const ensureRoles = new Set(["admin", "warehouse", "purchase"]);

  async function canAdjust(user, res, payload = {}) {
    if (permittedRoles.has(user.role)) return true;
    // 技术人员只能在其已获授权的售后质检/维修完成流程中做“入库”；不能借
    // 通用库存接口任意增减库存。
    const aftersalesActions = new Set(["aftersales_quality_return", "aftersales_repair"]);
    if (user.role === "technician" && payload.sourceModule === "aftersales"
      && payload.action === "入库" && aftersalesActions.has(payload.workflowAction)
      && await canWorkflow(user, payload.workflowAction)) return true;
    sendJson(res, 403, { ok: false, error: "FORBIDDEN", message: "当前角色不能执行库存变动" });
    return false;
  }

  async function handle(req, res) {
    if (req.method === "GET" && req.url === "/api/inventory") {
      const user = await requireUser(req, res);
      if (!user) return true;
      if (!canAccessModule(await readState(), user, "inventory", "view")) {
        sendJson(res, 403, { ok: false, error: "FORBIDDEN", message: "当前账号无权查看库存" });
        return true;
      }
      sendJson(res, 200, { ok: true, inventory: await listInventory() });
      return true;
    }
    const adjustment = req.url.match(/^\/api\/inventory\/([^/]+)\/adjust$/);
    if (req.method === "POST" && adjustment) {
      const user = await requireUser(req, res);
      const payload = JSON.parse(await readBody(req, maxBodyBytes) || "{}");
      if (!user || !await canAdjust(user, res, payload)) return true;
      const result = await adjustInventory({
        inventoryId: decodeURIComponent(adjustment[1]),
        delta: payload.delta,
        action: payload.action,
        operatorId: user.id,
        sourceId: payload.sourceId,
        sourceModule: payload.sourceModule,
        remark: payload.remark,
      });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    if (req.method === "POST" && req.url === "/api/inventory/adjustments") {
      const user = await requireUser(req, res);
      const payload = JSON.parse(await readBody(req, maxBodyBytes) || "{}");
      const permitted = payload.sourceModule === "aftersales" && Array.isArray(payload.adjustments)
        && payload.adjustments.every((item) => item?.action === "入库");
      if (!user || !await canAdjust(user, res, permitted ? { ...payload, action: "入库" } : payload)) return true;
      const batch = await adjustInventoryBatch({
        adjustments: payload.adjustments,
        operatorId: user.id,
        sourceId: payload.sourceId,
        sourceModule: payload.sourceModule,
      });
      sendJson(res, 200, { ok: true, ...batch });
      return true;
    }
    if (req.method === "POST" && req.url === "/api/inventory/ensure") {
      const user = await requireUser(req, res);
      if (!user) return true;
      if (!ensureRoles.has(user.role)) {
        sendJson(res, 403, { ok: false, error: "FORBIDDEN", message: "当前角色不能建立库存记录" });
        return true;
      }
      const payload = JSON.parse(await readBody(req, maxBodyBytes) || "{}");
      const result = await ensureInventory({ item: payload.item, operatorId: user.id });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    const receipt = req.url.match(/^\/api\/purchases\/([^/]+)\/receive$/);
    if (req.method === "POST" && receipt) {
      const user = await requireUser(req, res);
      if (!user) return true;
      if (!await canWorkflow(user, "purchase_receive")) {
        sendJson(res, 403, { ok: false, error: "FORBIDDEN", message: "当前角色不能确认采购到货" });
        return true;
      }
      const result = await receivePurchase({ purchaseId: decodeURIComponent(receipt[1]), operatorId: user.id });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    const outbound = req.url.match(/^\/api\/deliveries\/([^/]+)\/outbound$/);
    if (req.method === "POST" && outbound) {
      const user = await requireUser(req, res);
      if (!user) return true;
      if (!await canWorkflow(user, "delivery_outbound")) {
        sendJson(res, 403, { ok: false, error: "FORBIDDEN", message: "当前角色不能确认出库" });
        return true;
      }
      const result = await confirmDeliveryOutbound({ deliveryId: decodeURIComponent(outbound[1]), operatorId: user.id });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    return false;
  }

  return { handle };
}

module.exports = { createInventoryRoute };
