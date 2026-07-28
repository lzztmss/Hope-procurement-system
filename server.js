const http = require("http");
const fs = require("fs");
const path = require("path");
const { createSessionToken, verifyPassword } = require("./lib/security");
const {
  initializeDatabase,
  readState,
  writeState,
  findUserByAccount,
  createSession,
  getSessionUser,
  deleteSession,
} = require("./lib/database");

const ROOT = __dirname;
const APP_DIR = path.join(ROOT, "app");
const INITIAL_DB = path.join(ROOT, "data", "initial-db.json");
const ENV_FILE = path.join(ROOT, ".env");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const COOKIE_NAME = "xlx_session";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function sessionCookie(token) {
  const maxAge = Number(process.env.SESSION_HOURS || 12) * 60 * 60;
  const secure = process.env.COOKIE_SECURE !== "false" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearSessionCookie() {
  const secure = process.env.COOKIE_SECURE !== "false" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

async function requireUser(req, res) {
  const secret = process.env.SESSION_SECRET || "";
  const token = parseCookies(req)[COOKIE_NAME];
  const user = await getSessionUser(token, secret);
  if (!user) {
    sendJson(res, 401, { ok: false, error: "UNAUTHORIZED" });
    return null;
  }
  return user;
}

function safeStaticPath(urlPath) {
  let decoded = decodeURIComponent(urlPath.split("?")[0]);
  if (decoded === "/") decoded = "/index.html";
  const resolved = path.resolve(APP_DIR, `.${decoded}`);
  if (!resolved.startsWith(APP_DIR)) return null;
  return resolved;
}

function serveStatic(req, res) {
  const filePath = safeStaticPath(req.url);
  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (path.extname(filePath)) {
        sendText(res, 404, "File not found");
        return;
      }
      fs.readFile(path.join(APP_DIR, "index.html"), (indexErr, indexData) => {
        if (indexErr) sendText(res, 404, "File not found");
        else {
          res.writeHead(200, { "Content-Type": mimeTypes[".html"], "Cache-Control": "no-store" });
          res.end(indexData);
        }
      });
      return;
    }
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": type.startsWith("text/html") ? "no-store" : "public, max-age=3600",
    });
    res.end(data);
  });
}

async function handleApi(req, res) {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, { ok: true, name: "心连心智能养老业务运营系统", mode: "production", time: new Date().toISOString() });
      return;
    }
    if (req.method === "POST" && req.url === "/api/auth/login") {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}");
      const account = String(payload.account || "").trim();
      const password = String(payload.password || "");
      const user = await findUserByAccount(account);
      if (!user || user.status !== "启用" || !verifyPassword(password, user.password_hash)) {
        sendJson(res, 401, { ok: false, error: "账号或密码错误" });
        return;
      }
      const token = createSessionToken();
      await createSession(user.id, token, process.env.SESSION_SECRET || "", {
        userAgent: req.headers["user-agent"] || "",
        ip: req.socket.remoteAddress || "",
      });
      res.setHeader("Set-Cookie", sessionCookie(token));
      const { password_hash, ...safeUser } = user;
      sendJson(res, 200, { ok: true, user: safeUser });
      return;
    }
    if (req.method === "POST" && req.url === "/api/auth/logout") {
      const token = parseCookies(req)[COOKIE_NAME];
      await deleteSession(token, process.env.SESSION_SECRET || "");
      res.setHeader("Set-Cookie", clearSessionCookie());
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && req.url === "/api/me") {
      const user = await requireUser(req, res);
      if (!user) return;
      sendJson(res, 200, { ok: true, user });
      return;
    }
    if (req.method === "GET" && req.url === "/api/db") {
      const user = await requireUser(req, res);
      if (!user) return;
      sendJson(res, 200, await readState());
      return;
    }
    if ((req.method === "PUT" || req.method === "POST") && req.url === "/api/db") {
      const user = await requireUser(req, res);
      if (!user) return;
      const payload = JSON.parse(await readBody(req));
      const saved = await writeState(payload);
      sendJson(res, 200, { ok: true, savedAt: new Date().toISOString(), users: saved.users.length });
      return;
    }
    sendJson(res, 404, { ok: false, error: "API not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function start() {
  loadEnv();
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be configured and at least 32 characters");
  }
  const initialState = JSON.parse(fs.readFileSync(INITIAL_DB, "utf8"));
  await initializeDatabase(initialState, process.env.INITIAL_ADMIN_PASSWORD || "123456");

  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  });
  server.listen(PORT, HOST, () => {
    console.log("心连心智能养老业务运营系统生产服务已启动");
    console.log(`Node 内部监听: http://${HOST}:${PORT}/`);
    console.log("公网访问请通过 Nginx HTTPS 反向代理");
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
