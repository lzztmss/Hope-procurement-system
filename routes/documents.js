function createDocumentRoute({ sendJson, requireUser, listDocuments, readState, canAccessModule, canSeeRecord }) {
  const documentKinds = new Set(["salesOrders", "purchases", "deliveries", "trainings", "aftersales", "leads"]);

  async function handle(req, res) {
    const match = req.url.match(/^\/api\/(salesOrders|purchases|deliveries|trainings|aftersales|leads)$/);
    if (req.method !== "GET" || !match || !documentKinds.has(match[1])) return false;
    const user = await requireUser(req, res);
    if (!user) return true;
    const kind = match[1];
    const state = await readState();
    if (!canAccessModule(state, user, kind, "view")) {
      sendJson(res, 403, { ok: false, error: "FORBIDDEN", message: "当前账号无权查看该业务模块" });
      return true;
    }
    const records = await listDocuments(kind);
    sendJson(res, 200, { ok: true, [kind]: records.filter((record) => canSeeRecord(state, user, record)) });
    return true;
  }

  return { handle };
}

module.exports = { createDocumentRoute };
