function createAuthRoute({
  readBody,
  maxBodyBytes,
  parseCookies,
  sendJson,
  cookieName,
  sessionCookie,
  clearSessionCookie,
  findUserByAccount,
  createSession,
  getSessionUser,
  deleteSession,
  createSessionToken,
  verifyPassword,
  sessionSecret,
}) {
  async function currentUser(req) {
    const token = parseCookies(req)[cookieName];
    return getSessionUser(token, sessionSecret());
  }

  async function handle(req, res) {
    if (req.method === "POST" && req.url === "/api/auth/login") {
      const payload = JSON.parse(await readBody(req, maxBodyBytes) || "{}");
      const account = String(payload.account || "").trim();
      const password = String(payload.password || "");
      const user = await findUserByAccount(account);
      if (!user || user.status !== "启用" || !verifyPassword(password, user.password_hash)) {
        sendJson(res, 401, { ok: false, error: "账号或密码错误" });
        return true;
      }
      const token = createSessionToken();
      await createSession(user.id, token, sessionSecret(), {
        userAgent: req.headers["user-agent"] || "",
        ip: req.socket.remoteAddress || "",
      });
      res.setHeader("Set-Cookie", sessionCookie(token));
      const { password_hash, ...safeUser } = user;
      sendJson(res, 200, { ok: true, user: safeUser });
      return true;
    }
    if (req.method === "POST" && req.url === "/api/auth/logout") {
      const token = parseCookies(req)[cookieName];
      await deleteSession(token, sessionSecret());
      res.setHeader("Set-Cookie", clearSessionCookie());
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (req.method === "GET" && req.url === "/api/me") {
      const user = await currentUser(req);
      if (!user) {
        sendJson(res, 401, { ok: false, error: "UNAUTHORIZED" });
        return true;
      }
      sendJson(res, 200, { ok: true, user });
      return true;
    }
    return false;
  }

  return { handle, currentUser };
}

module.exports = { createAuthRoute };
