const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const targets = [
  "server.js",
  "lib/database.js",
  "lib/domain-sync.js",
  "lib/document-repository.js",
  "lib/http.js",
  "lib/inventory-repository.js",
  "lib/inventory-service.js",
  "lib/access-control.js",
  "lib/workflow-permissions.js",
  "scripts/check-access-control.js",
  "lib/security.js",
  "routes/auth.js",
  "routes/documents.js",
  "routes/inventory.js",
  "routes/sales-workflow.js",
  "routes/state.js",
  "app/js/api-client.js",
  "app/js/app.js",
  "app/js/workflow-config.js",
].filter((file) => fs.existsSync(path.join(root, file)));

for (const file of targets) execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "inherit" });
console.log(`检查通过：${targets.length} 个 JavaScript 文件`);
