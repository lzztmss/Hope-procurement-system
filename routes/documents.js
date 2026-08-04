function createDocumentRoute({ sendJson, requireUser, listDocuments }) {
  const documentKinds = new Set(["salesOrders", "purchases", "deliveries", "trainings", "aftersales", "leads"]);

  async function handle(req, res) {
    const match = req.url.match(/^\/api\/(salesOrders|purchases|deliveries|trainings|aftersales|leads)$/);
    if (req.method !== "GET" || !match || !documentKinds.has(match[1])) return false;
    const user = await requireUser(req, res);
    if (!user) return true;
    const kind = match[1];
    sendJson(res, 200, { ok: true, [kind]: await listDocuments(kind) });
    return true;
  }

  return { handle };
}

module.exports = { createDocumentRoute };
