const assert = require("assert");
const { filterStateForUser, assertStateWriteAccess, mergeStateForUser } = require("../lib/access-control");

const state = {
  users: [
    { id: "u-sales", name: "销售", department: "业务部", role: "sales", status: "启用", scope: "本人", modulePermissions: { dashboard: ["view"], leads: ["view", "create", "edit"] } },
    { id: "u-other", name: "其他销售", department: "业务部", role: "sales", status: "启用", scope: "本人" },
  ],
  leads: [
    { id: "lead-own", owner: "u-sales", createdBy: "u-sales", customer: "本人客户" },
    { id: "lead-other", owner: "u-other", createdBy: "u-other", customer: "他人客户" },
  ],
  salesOrders: [], purchases: [], inventory: [{ id: "stock-1", stock: 10 }], deliveries: [],
  trainings: [], aftersales: [], products: [{ id: "product-1", sku: "SKU-1" }], suppliers: [], notices: [], inventoryLogs: [],
  productCategories: ["手表"],
};
const user = state.users[0];
const filtered = filterStateForUser(state, user);

assert.deepStrictEqual(filtered.leads.map((item) => item.id), ["lead-own"]);
assert.deepStrictEqual(filtered.purchases, []);
assert.deepStrictEqual(filtered.inventory, []);
assert.deepStrictEqual(filtered.users.find((item) => item.id === "u-sales")?.modulePermissions, state.users[0].modulePermissions);
assert.strictEqual(filtered.users.find((item) => item.id === "u-other")?.modulePermissions, undefined);

const permitted = structuredClone(filtered);
permitted.leads.push({ id: "lead-new", owner: "u-sales", createdBy: "u-sales", customer: "新客户" });
assert.doesNotThrow(() => assertStateWriteAccess(user, state, permitted));
const merged = mergeStateForUser(state, permitted, user);
assert(merged.leads.some((item) => item.id === "lead-other"), "合并时必须保留不可见记录");
assert(merged.leads.some((item) => item.id === "lead-new"), "合并时必须写入本人新增记录");

const forbidden = structuredClone(filtered);
forbidden.purchases.push({ id: "purchase-denied", owner: "u-sales", createdBy: "u-sales" });
assert.throws(() => assertStateWriteAccess(user, state, forbidden), /无权在“purchases”写入记录/);

const categoryForbidden = structuredClone(filtered);
categoryForbidden.productCategories.push("血压计");
assert.throws(() => assertStateWriteAccess(user, state, categoryForbidden), /只有系统管理员可以维护产品类别/);

console.log("访问控制检查通过：读取裁剪、本人新建、不可见数据保留、类别维护和越权写入拦截均正常");
