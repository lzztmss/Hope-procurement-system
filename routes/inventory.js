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
}) {
  const permittedRoles = new Set(["admin", "warehouse", "purchase", "aftersales"]);
  const ensureRoles = new Set(["admin", "warehouse", "purchase"]);

  function canAdjust(user, res) {
    if (permittedRoles.has(user.role)) return true;
    sendJson(res, 403, { ok: false, error: "FORBIDDEN", message: "当前角色不能执行库存变动" });
    return false;
  }

  async function handle(req, res) {
    if (req.method === "GET" && req.url === "/api/inventory") {
      const user = await requireUser(req, res);
      if (!user) return true;
      sendJson(res, 200, { ok: true, inventory: await listInventory() });
      return true;
    }
    const adjustment = req.url.match(/^\/api\/inventory\/([^/]+)\/adjust$/);
    if (req.method === "POST" && adjustment) {
      const user = await requireUser(req, res);
      if (!user || !canAdjust(user, res)) return true;
      const payload = JSON.parse(await readBody(req, maxBodyBytes) || "{}");
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
      if (!user || !canAdjust(user, res)) return true;
      const payload = JSON.parse(await readBody(req, maxBodyBytes) || "{}");
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
      if (!user || !permittedRoles.has(user.role)) return true;
      const result = await receivePurchase({ purchaseId: decodeURIComponent(receipt[1]), operatorId: user.id });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    return false;
  }

  return { handle };
}

module.exports = { createInventoryRoute };
