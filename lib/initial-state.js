const CLEAN_TEST_MODE = "clean-test";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMode(value) {
  return String(value || "sample").trim().toLowerCase();
}

function createInitialState(sourceState, mode) {
  const source = clone(sourceState || {});
  if (normalizeMode(mode) !== CLEAN_TEST_MODE) return source;

  const inventory = (source.inventory || []).map((item) => ({
    ...item,
    // 期初库存不是历史业务占用：新流程从可用库存开始计算。
    locked: 0,
    inTransit: 0,
    eta: "",
  }));

  return {
    meta: {
      ...(source.meta || {}),
      initialDataMode: CLEAN_TEST_MODE,
      initializedAt: new Date().toISOString(),
    },
    users: source.users || [],
    products: source.products || [],
    suppliers: source.suppliers || [],
    inventory,
    leads: [],
    salesOrders: [],
    purchases: [],
    deliveries: [],
    trainings: [],
    aftersales: [],
    notices: [],
    inventoryLogs: [],
    auditLogs: [],
  };
}

module.exports = {
  CLEAN_TEST_MODE,
  createInitialState,
};
