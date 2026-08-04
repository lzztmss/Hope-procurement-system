function createStateRoute({ readBody, maxBodyBytes, sendJson, requireUser, readState, writeState, assertSensitiveStateWrite }) {
  async function handle(req, res) {
    if (req.method === "GET" && req.url === "/api/db") {
      const user = await requireUser(req, res);
      if (!user) return true;
      sendJson(res, 200, await readState());
      return true;
    }
    if (!((req.method === "PUT" || req.method === "POST") && req.url === "/api/db")) return false;
    const user = await requireUser(req, res);
    if (!user) return true;
    const payload = JSON.parse(await readBody(req, maxBodyBytes));
    const currentState = await readState();
    const currentRevision = Number(currentState.meta?.revision || 0);
    const incomingRevision = Number(payload.meta?.revision || 0);
    if (currentRevision && incomingRevision !== currentRevision) {
      sendJson(res, 409, { ok: false, error: "DATA_OUTDATED", message: "数据已在其他页面更新，请刷新后再操作。", revision: currentRevision });
      return true;
    }
    try {
      assertSensitiveStateWrite(user, currentState, payload);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "STATE_VALIDATION", message: error.message });
      return true;
    }
    payload.meta = { ...(payload.meta || {}), revision: currentRevision + 1 };
    delete payload.meta.forceDelete;
    const saved = await writeState(payload);
    sendJson(res, 200, { ok: true, savedAt: new Date().toISOString(), users: saved.users.length, revision: saved.meta?.revision });
    return true;
  }
  return { handle };
}

module.exports = { createStateRoute };
