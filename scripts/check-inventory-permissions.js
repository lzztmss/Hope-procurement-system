const assert = require("assert");
const { createInventoryRoute } = require("../routes/inventory");

async function call(url, role, allowed = true) {
  let response;
  const route = createInventoryRoute({
    readBody: async () => "{}", maxBodyBytes: 1024,
    sendJson: (_res, status, payload) => { response = { status, payload }; },
    requireUser: async () => ({ id: `test-${role}`, role }),
    listInventory: async () => [], adjustInventory: async () => ({}), adjustInventoryBatch: async () => ({}), ensureInventory: async () => ({}),
    receivePurchase: async () => ({ received: true }), confirmDeliveryOutbound: async () => ({ outbound: true }),
    canWorkflow: async (user, action) => allowed && (action === "purchase_receive"
      ? ["admin", "warehouse", "purchase"].includes(user.role)
      : ["admin", "warehouse", "purchase"].includes(user.role)),
  });
  await route.handle({ method: "POST", url, headers: {}, socket: {} }, {});
  return response;
}

(async () => {
  const cases = [
    ["/api/purchases/test/receive", "aftersales", 403],
    ["/api/deliveries/test/outbound", "aftersales", 403],
    ["/api/purchases/test/receive", "warehouse", 200],
    ["/api/deliveries/test/outbound", "warehouse", 200],
    ["/api/purchases/test/receive", "warehouse", 403, false],
  ];
  for (const [url, role, expected, allowed] of cases) assert.strictEqual((await call(url, role, allowed)).status, expected, `${role} ${url}`);
  console.log("权限检查通过：收货/出库均按岗位拦截");
})().catch((error) => { console.error(error); process.exit(1); });
