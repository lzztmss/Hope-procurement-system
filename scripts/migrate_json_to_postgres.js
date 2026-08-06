const fs = require("fs");
const path = require("path");
const { initializeDatabase, closePool } = require("../lib/database");
const { createInitialState } = require("../lib/initial-state");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const INITIAL_DB = path.join(ROOT, "data", "initial-db.json");

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sourceState = JSON.parse(fs.readFileSync(INITIAL_DB, "utf8"));
  const state = createInitialState(sourceState, process.env.INITIAL_DATA_MODE);
  await initializeDatabase(state, process.env.INITIAL_ADMIN_PASSWORD || "123456");
  await closePool();
  console.log("PostgreSQL 初始化完成");
}

main().catch(async (error) => {
  console.error(error);
  await closePool().catch(() => {});
  process.exit(1);
});
