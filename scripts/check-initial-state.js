const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createInitialState } = require("../lib/initial-state");

const source = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "initial-db.json"), "utf8"));
const clean = createInitialState(source, "clean-test");

assert.strictEqual(clean.users.length, source.users.length, "干净测试库必须保留基础账号");
assert.strictEqual(clean.products.length, source.products.length, "干净测试库必须保留产品字典");
assert.strictEqual(clean.suppliers.length, source.suppliers.length, "干净测试库必须保留供应商");
assert.strictEqual(clean.inventory.length, source.inventory.length, "干净测试库必须保留期初库存");
for (const collection of ["leads", "salesOrders", "purchases", "deliveries", "trainings", "aftersales", "notices", "inventoryLogs", "auditLogs"]) {
  assert.deepStrictEqual(clean[collection], [], `${collection} 必须为空`);
}
assert.ok(clean.inventory.every((item) => item.locked === 0 && item.inTransit === 0 && item.eta === ""), "期初库存不能保留历史占用或在途");
assert.ok((source.inventory || []).some((item) => item.locked || item.inTransit), "测试样本应覆盖历史库存清理");

console.log("初始数据模式检查通过");
