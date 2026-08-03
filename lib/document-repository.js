const { query } = require("./database");

const definitions = {
  salesOrders: { table: "sales_orders", order: "code" },
  purchases: { table: "purchase_orders", order: "code" },
  deliveries: { table: "deliveries", order: "code" },
  trainings: { table: "trainings", order: "id" },
  aftersales: { table: "aftersales_cases", order: "id" },
  leads: { table: "leads", order: "id" },
};

async function listDocuments(kind) {
  const definition = definitions[kind];
  if (!definition) throw new Error("未知业务单据类型");
  const result = await query(`SELECT id, data FROM ${definition.table} ORDER BY ${definition.order} DESC NULLS LAST, id DESC`);
  return result.rows.map((row) => ({ ...(row.data || {}), id: row.id }));
}

module.exports = { listDocuments };
