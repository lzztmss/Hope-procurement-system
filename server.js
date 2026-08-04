const http = require("http");
const fs = require("fs");
const path = require("path");
const { createSessionToken, verifyPassword } = require("./lib/security");
const { adjustInventory, adjustInventoryBatch, ensureInventory, receivePurchase, confirmDeliveryOutbound } = require("./lib/inventory-service");
const { sendJson, sendText, readBody, parseCookies } = require("./lib/http");
const { listInventory } = require("./lib/inventory-repository");
const { listDocuments } = require("./lib/document-repository");
const { createAuthRoute } = require("./routes/auth");
const { createInventoryRoute } = require("./routes/inventory");
const { createDocumentRoute } = require("./routes/documents");
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
loadEnv();
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


function sessionCookie(token) {
  const maxAge = Number(process.env.SESSION_HOURS || 12) * 60 * 60;
  const secure = process.env.COOKIE_SECURE !== "false" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearSessionCookie() {
  const secure = process.env.COOKIE_SECURE !== "false" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

const authRoute = createAuthRoute({
  readBody,
  maxBodyBytes: MAX_BODY_BYTES,
  parseCookies,
  sendJson,
  cookieName: COOKIE_NAME,
  sessionCookie,
  clearSessionCookie,
  findUserByAccount,
  createSession,
  getSessionUser,
  deleteSession,
  createSessionToken,
  verifyPassword,
  sessionSecret: () => process.env.SESSION_SECRET || "",
});

function byId(records) {
  return new Map((records || []).filter((record) => record?.id).map((record) => [record.id, record]));
}

function productHasReferences(state, product) {
  const sameProduct = (record) => record?.productId === product.id
    || (record?.product === product.name && String(record?.model || "") === String(product.model || ""));
  if ((state.inventory || []).some((item) => item.productId === product.id || (item.name === product.name && String(item.model || "") === String(product.model || "")))) return true;
  return ["leads", "salesOrders", "purchases", "trainings", "aftersales"].some((collection) => (state[collection] || []).some(sameProduct));
}

function inventoryHasReferences(state, item) {
  if (Number(item.stock || 0) || Number(item.locked || 0) || Number(item.inTransit || 0)) return true;
  if ((state.inventoryLogs || []).some((log) => log.itemId === item.id)) return true;
  return ["deliveries", "aftersales"].some((collection) => (state[collection] || []).some((record) => record.inventoryId === item.id));
}

function assertSensitiveStateWrite(user, currentState, incomingState) {
  const isAdmin = user?.role === "admin";
  const forceDelete = incomingState.meta?.forceDelete;
  const forceModule = forceDelete?.moduleId;
  const forcedIds = new Set(forceDelete?.ids || []);
  if (forceDelete && !isAdmin) throw new Error("只有系统管理员可以强制删除记录");
  if (forceDelete && (!forceModule || !Array.isArray(forceDelete.ids) || !forceDelete.ids.length)) throw new Error("强制删除请求无效");
  const forceAllows = (moduleId, id) => forceModule === moduleId && forcedIds.has(id);
  const currentProducts = byId(currentState.products);
  const incomingProducts = byId(incomingState.products);
  const currentInventory = byId(currentState.inventory);
  const incomingInventory = byId(incomingState.inventory);

  for (const [id, product] of currentProducts) {
    const next = incomingProducts.get(id);
    if (!next) {
      if (!isAdmin) throw new Error("只有系统管理员可以删除产品/型号");
      if (!forceAllows("products", id) && productHasReferences(currentState, product)) throw new Error("该产品已关联库存或业务单据，不能删除");
    } else if (String(product.sku || "") !== String(next.sku || "") && !isAdmin) {
      throw new Error("只有系统管理员可以修改已建立产品的 SKU/货号");
    }
  }
  for (const [id, item] of currentInventory) {
    const next = incomingInventory.get(id);
    if (!next) {
      if (!isAdmin) throw new Error("只有系统管理员可以删除库存");
      if (!forceAllows("inventory", id) && inventoryHasReferences(currentState, item)) throw new Error("该库存已有数量或业务流水，不能删除");
    } else if (String(item.sku || "") !== String(next.sku || "") && !isAdmin) {
      throw new Error("只有系统管理员可以修改已建立库存的 SKU/货号");
    }
  }
  for (const collection of ["users", "leads", "salesOrders", "purchases", "deliveries", "trainings", "aftersales", "suppliers", "notices"]) {
    const currentRecords = byId(currentState[collection]);
    const incomingRecords = byId(incomingState[collection]);
    for (const [id] of currentRecords) {
      if (!incomingRecords.has(id) && !isAdmin) throw new Error("只有系统管理员可以删除业务记录");
    }
  }
  const enabledAdmins = (incomingState.users || []).filter((item) => item.role === "admin" && item.status === "启用");
  if (!enabledAdmins.length) throw new Error("系统至少需要保留一名启用的系统管理员");
}

async function requireUser(req, res) {
  const user = await authRoute.currentUser(req);
  if (!user) {
    sendJson(res, 401, { ok: false, error: "UNAUTHORIZED" });
    return null;
  }
  return user;
}

const inventoryRoute = createInventoryRoute({
  readBody,
  maxBodyBytes: MAX_BODY_BYTES,
  sendJson,
  requireUser,
  listInventory,
  adjustInventory,
  adjustInventoryBatch,
  ensureInventory,
  receivePurchase,
  confirmDeliveryOutbound,
});

const documentRoute = createDocumentRoute({ sendJson, requireUser, listDocuments });

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
    // 页面、脚本和样式必须及时更新；否则浏览器会继续运行旧版流程代码。
    const noStore = [".html", ".js", ".css"].includes(path.extname(filePath).toLowerCase());
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": noStore ? "no-store" : "public, max-age=3600",
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
    if (await authRoute.handle(req, res)) return;
    if (await inventoryRoute.handle(req, res)) return;
    if (await documentRoute.handle(req, res)) return;
    if (req.method === "GET" && req.url === "/api/db") {
      const user = await requireUser(req, res);
      if (!user) return;
      sendJson(res, 200, await readState());
      return;
    }
    if ((req.method === "PUT" || req.method === "POST") && req.url === "/api/db") {
      const user = await requireUser(req, res);
      if (!user) return;
      const payload = JSON.parse(await readBody(req, MAX_BODY_BYTES));
      const currentState = await readState();
      const currentRevision = Number(currentState.meta?.revision || 0);
      const incomingRevision = Number(payload.meta?.revision || 0);
      // 整份业务数据会一起保存。拒绝旧页面的写入，避免覆盖其他页面刚保存的内容。
      if (currentRevision && incomingRevision !== currentRevision) {
        sendJson(res, 409, {
          ok: false,
          error: "DATA_OUTDATED",
          message: "数据已在其他页面更新，请刷新后再操作。",
          revision: currentRevision,
        });
        return;
      }
      assertSensitiveStateWrite(user, currentState, payload);
      payload.meta = { ...(payload.meta || {}), revision: currentRevision + 1 };
      delete payload.meta.forceDelete;
      const saved = await writeState(payload);
      sendJson(res, 200, { ok: true, savedAt: new Date().toISOString(), users: saved.users.length, revision: saved.meta?.revision });
      return;
    }
    sendJson(res, 404, { ok: false, error: "API not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function start() {
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
