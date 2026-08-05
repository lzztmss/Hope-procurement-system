function createStateRoute({ readBody, maxBodyBytes, sendJson, requireUser, readState, writeState, assertSensitiveStateWrite, filterStateForUser, assertStateWriteAccess, mergeStateForUser }) {
  async function handle(req, res) {
    if (req.method === "GET" && req.url === "/api/db") {
      const user = await requireUser(req, res);
      if (!user) return true;
      const state = await readState();
      sendJson(res, 200, filterStateForUser(state, user));
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
      assertStateWriteAccess(user, currentState, payload);
      // 非管理员拿到的是已裁剪的视图，先与完整状态合并后再做完整性校验，
      // 避免“看不到产品”被误判为删除产品。
      const merged = mergeStateForUser(currentState, payload, user);
      assertSensitiveStateWrite(user, currentState, merged);
      merged.meta = { ...(merged.meta || {}), revision: currentRevision + 1 };
      delete merged.meta.forceDelete;
      // writeState 在同一数据库事务中用 revision 条件更新，避免两个请求同时
      // 通过前置检查后发生“后写覆盖前写”。
      const saved = await writeState(merged, currentRevision);
      sendJson(res, 200, { ok: true, savedAt: new Date().toISOString(), users: saved.users.length, revision: saved.meta?.revision });
      return true;
    } catch (error) {
      if (error.code === "DATA_OUTDATED") {
        sendJson(res, 409, { ok: false, error: "DATA_OUTDATED", message: error.message, revision: error.revision });
        return true;
      }
      sendJson(res, 400, { ok: false, error: "STATE_VALIDATION", message: error.message });
      return true;
    }
  }
  return { handle };
}

module.exports = { createStateRoute };
