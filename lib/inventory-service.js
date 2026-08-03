const { getPool } = require("./database");

function number(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) throw new Error("库存变动数量必须为非零数字");
  return parsed;
}

async function adjustInventoryBatch({ adjustments, operatorId, sourceId = null, sourceModule = null }) {
  if (!Array.isArray(adjustments) || !adjustments.length) throw new Error("至少需要一条库存变动");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const change of adjustments) {
      if (!change.inventoryId) throw new Error("缺少库存记录");
      const quantity = number(change.delta);
      const locked = await client.query("SELECT id, stock, data FROM inventory WHERE id = $1 FOR UPDATE", [change.inventoryId]);
      if (!locked.rows.length) throw new Error("库存记录不存在");
      const row = locked.rows[0];
      const beforeStock = Number(row.stock);
      const afterStock = beforeStock + quantity;
      if (afterStock < 0) throw new Error("库存不足，无法完成出库");
      const action = change.action || (quantity > 0 ? "入库" : "出库");
      const movementId = `im-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await client.query("UPDATE inventory SET stock = $2, data = $3::jsonb, synced_at = now() WHERE id = $1", [change.inventoryId, afterStock, JSON.stringify({ ...row.data, stock: afterStock })]);
      await client.query(`INSERT INTO inventory_movements (id, inventory_id, action, quantity, before_stock, after_stock, source_id, source_module, operator_id, occurred_at, data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10::jsonb)`, [movementId, change.inventoryId, action, Math.abs(quantity), beforeStock, afterStock, sourceId, sourceModule, operatorId, JSON.stringify({ id: movementId, itemId: change.inventoryId, action, quantity: Math.abs(quantity), beforeStock, afterStock, sourceId, sourceModule, operatorId, remark: change.remark || "", createdAt: new Date().toISOString() })]);
      results.push({ movementId, inventoryId: change.inventoryId, action, quantity: Math.abs(quantity), beforeStock, afterStock, remark: change.remark || "" });
    }
    await client.query("COMMIT");
    return results;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function adjustInventory(change) {
  const results = await adjustInventoryBatch({ adjustments: [change], operatorId: change.operatorId, sourceId: change.sourceId, sourceModule: change.sourceModule });
  return results[0];
}

module.exports = { adjustInventory, adjustInventoryBatch };
