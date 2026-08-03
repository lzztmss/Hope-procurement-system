const { query } = require("./database");

async function listInventory() {
  const result = await query(`SELECT id, product_id, sku, stock, locked, in_transit, data
    FROM inventory ORDER BY COALESCE(data->>'name', ''), COALESCE(data->>'model', ''), id`);
  return result.rows.map((row) => ({
    ...(row.data || {}),
    id: row.id,
    productId: row.product_id || "",
    sku: row.sku || "",
    stock: Number(row.stock),
    locked: Number(row.locked),
    inTransit: Number(row.in_transit),
  }));
}

async function getInventory(id) {
  const result = await query("SELECT id, product_id, sku, stock, locked, in_transit, data FROM inventory WHERE id = $1", [id]);
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return { ...(row.data || {}), id: row.id, productId: row.product_id || "", sku: row.sku || "", stock: Number(row.stock), locked: Number(row.locked), inTransit: Number(row.in_transit) };
}

module.exports = { listInventory, getInventory };
