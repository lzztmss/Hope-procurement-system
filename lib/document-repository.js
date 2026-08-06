const { query } = require("./database");

const definitions = {
  salesOrders: { table: "sales_orders", order: "code" },
  purchases: { table: "purchase_orders", order: "code" },
  deliveries: { table: "deliveries", order: "code" },
  trainings: { table: "trainings", order: "id" },
  aftersales: { table: "aftersales_cases", order: "id" },
  leads: { table: "leads", order: "id" },
};

function documentItems(record) {
  if (Array.isArray(record?.items) && record.items.length) return record.items;
  if (!record?.inventoryId && !record?.product) return [];
  return [{
    inventoryId: record.inventoryId || "",
    productId: record.productId || "",
    product: record.product || "",
    model: record.model || "",
    quantity: Number(record.quantity || 0),
    unitPrice: Number(record.unitPrice || 0),
  }];
}

// 单据表保存的是业务快照，旧单据可能只留下 inventoryId。所有读取入口统一
// 用库存主数据补齐产品与型号，避免不同角色因是否能打开库存台账而看到 “-”。
function hydrateDocumentRecord(record, state) {
  const inventoryById = new Map((state?.inventory || []).map((item) => [item.id, item]));
  const productsById = new Map((state?.products || []).map((item) => [item.id, item]));
  const items = documentItems(record).map((line) => {
    const inventory = inventoryById.get(line.inventoryId);
    const product = productsById.get(line.productId) || productsById.get(inventory?.productId);
    return {
      ...line,
      inventoryId: line.inventoryId || inventory?.id || "",
      productId: line.productId || inventory?.productId || product?.id || "",
      product: line.product || inventory?.name || product?.name || "",
      model: line.model || inventory?.model || product?.model || "",
    };
  });
  if (!items.length) return { ...record };
  const first = items[0];
  return {
    ...record,
    items,
    inventoryId: first.inventoryId || record.inventoryId || "",
    productId: first.productId || record.productId || "",
    product: first.product || record.product || "",
    model: first.model || record.model || "",
    quantity: items.reduce((total, item) => total + Number(item.quantity || 0), 0),
  };
}

async function listDocuments(kind, state) {
  const definition = definitions[kind];
  if (!definition) throw new Error("未知业务单据类型");
  const result = await query(`SELECT id, data FROM ${definition.table} ORDER BY ${definition.order} DESC NULLS LAST, id DESC`);
  return result.rows.map((row) => hydrateDocumentRecord({ ...(row.data || {}), id: row.id }, state));
}

module.exports = { listDocuments };
