const pg = require("pg");
const { hashPassword, hashSessionToken } = require("./security");
const { syncDomainState } = require("./domain-sync");

const STATE_ID = "main";
let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required");
    }
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_SIZE || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      scope TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await query("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);");
  await query("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);");
}

function sanitizeUser(user) {
  const { password, password_hash, ...safe } = user || {};
  return safe;
}

function sanitizeStateForClient(state, users) {
  const next = { ...(state || {}) };
  next.users = (users || next.users || []).map(sanitizeUser);
  return next;
}

async function listUsers() {
  const result = await query(
    "SELECT id, phone, name, department, role, status, scope FROM users ORDER BY created_at, name"
  );
  return result.rows;
}

async function initializeDatabase(initialState, defaultPassword = "123456") {
  await ensureSchema();
  const stateCount = await query("SELECT COUNT(*)::int AS count FROM app_state WHERE id = $1", [STATE_ID]);
  const userCount = await query("SELECT COUNT(*)::int AS count FROM users");

  if (userCount.rows[0].count === 0) {
    for (const user of initialState.users || []) {
      await query(
        `INSERT INTO users (id, phone, name, department, role, status, scope, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          user.id,
          user.phone,
          user.name,
          user.department,
          user.role,
          user.status,
          user.scope,
          hashPassword(user.password || defaultPassword),
        ]
      );
    }
  }

  if (stateCount.rows[0].count === 0) {
    const users = await listUsers();
    const safeState = sanitizeStateForClient(initialState, users);
    await query("INSERT INTO app_state (id, data) VALUES ($1, $2::jsonb)", [STATE_ID, JSON.stringify(safeState)]);
  }

  const stateResult = await query("SELECT data FROM app_state WHERE id = $1", [STATE_ID]);
  const users = await listUsers();
  await syncDomainState(getPool(), sanitizeStateForClient(stateResult.rows[0].data, users));
}

async function readState() {
  await ensureSchema();
  const result = await query("SELECT data FROM app_state WHERE id = $1", [STATE_ID]);
  if (!result.rows.length) {
    throw new Error("Database is not initialized");
  }
  const users = await listUsers();
  return sanitizeStateForClient(result.rows[0].data, users);
}

async function writeUsers(users) {
  if (!Array.isArray(users)) return;
  const incomingIds = [];
  for (const user of users) {
    if (!user.id || !user.phone || !user.name) continue;
    incomingIds.push(user.id);
    const existing = await query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
    const passwordHash = user.password
      ? hashPassword(user.password)
      : existing.rows[0]?.password_hash || hashPassword("123456");
    await query(
      `INSERT INTO users (id, phone, name, department, role, status, scope, password_hash, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (id) DO UPDATE SET
         phone = EXCLUDED.phone,
         name = EXCLUDED.name,
         department = EXCLUDED.department,
         role = EXCLUDED.role,
         status = EXCLUDED.status,
         scope = EXCLUDED.scope,
         password_hash = EXCLUDED.password_hash,
         updated_at = now()`,
      [
        user.id,
        user.phone,
        user.name,
        user.department || "业务部",
        user.role || "sales",
        user.status || "启用",
        user.scope || "本人",
        passwordHash,
      ]
    );
  }
  if (incomingIds.length) {
    await query("DELETE FROM users WHERE NOT (id = ANY($1::text[]))", [incomingIds]);
  }
}

async function writeState(state) {
  await ensureSchema();
  await writeUsers(state.users || []);
  const users = await listUsers();
  const safeState = sanitizeStateForClient(state, users);
  await query(
    `INSERT INTO app_state (id, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [STATE_ID, JSON.stringify(safeState)]
  );
  await syncDomainState(getPool(), safeState);
  return safeState;
}

async function findUserByAccount(account) {
  const result = await query(
    "SELECT id, phone, name, department, role, status, scope, password_hash FROM users WHERE phone = $1 OR name = $1 LIMIT 1",
    [account]
  );
  return result.rows[0] || null;
}

async function createSession(userId, token, secret, meta = {}) {
  const tokenHash = hashSessionToken(token, secret);
  const hours = Number(process.env.SESSION_HOURS || 12);
  await query(
    `INSERT INTO sessions (token_hash, user_id, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)`,
    [tokenHash, userId, meta.userAgent || "", meta.ip || "", hours]
  );
}

async function getSessionUser(token, secret) {
  if (!token) return null;
  const tokenHash = hashSessionToken(token, secret);
  const result = await query(
    `SELECT u.id, u.phone, u.name, u.department, u.role, u.status, u.scope
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = '启用'
     LIMIT 1`,
    [tokenHash]
  );
  if (!result.rows.length) return null;
  await query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [tokenHash]);
  return result.rows[0];
}

async function deleteSession(token, secret) {
  if (!token) return;
  await query("DELETE FROM sessions WHERE token_hash = $1", [hashSessionToken(token, secret)]);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  query,
  ensureSchema,
  initializeDatabase,
  readState,
  writeState,
  findUserByAccount,
  createSession,
  getSessionUser,
  deleteSession,
  sanitizeStateForClient,
  closePool,
};
