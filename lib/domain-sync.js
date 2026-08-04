const TABLES = [
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, sku TEXT, name TEXT NOT NULL, model TEXT, category TEXT,
    data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY, product_id TEXT, sku TEXT, stock NUMERIC NOT NULL DEFAULT 0,
    locked NUMERIC NOT NULL DEFAULT 0, in_transit NUMERIC NOT NULL DEFAULT 0,
    data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY, inventory_id TEXT, action TEXT, quantity NUMERIC,
    before_stock NUMERIC, after_stock NUMERIC, source_id TEXT, source_module TEXT,
    operator_id TEXT, occurred_at TIMESTAMPTZ, data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sales_orders (
    id TEXT PRIMARY KEY, code TEXT, customer TEXT, status TEXT, lead_id TEXT,
    owner_id TEXT, data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sales_order_items (
    sales_order_id TEXT NOT NULL REFERENCES sales_orders(id), item_id TEXT NOT NULL,
    product_id TEXT, inventory_id TEXT, quantity NUMERIC, unit_price NUMERIC,
    data JSONB NOT NULL, PRIMARY KEY (sales_order_id, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY, code TEXT, supplier_id TEXT, status TEXT, sales_order_id TEXT,
    owner_id TEXT, data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_order_items (
    purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id), item_id TEXT NOT NULL,
    product_id TEXT, inventory_id TEXT, quantity NUMERIC, unit_price NUMERIC,
    data JSONB NOT NULL, PRIMARY KEY (purchase_order_id, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS deliveries (
    id TEXT PRIMARY KEY, code TEXT, status TEXT, sales_order_id TEXT, inventory_id TEXT,
    owner_id TEXT, data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS delivery_items (
    delivery_id TEXT NOT NULL REFERENCES deliveries(id), item_id TEXT NOT NULL,
    product_id TEXT, inventory_id TEXT, quantity NUMERIC,
    data JSONB NOT NULL, PRIMARY KEY (delivery_id, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY, status TEXT, owner_id TEXT, data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS trainings (
    id TEXT PRIMARY KEY, status TEXT, sales_order_id TEXT, delivery_id TEXT,
    data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS aftersales_cases (
    id TEXT PRIMARY KEY, status TEXT, sales_order_id TEXT, delivery_id TEXT,
    inventory_id TEXT, data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS notices (
    id TEXT PRIMARY KEY, data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, module_id TEXT, record_id TEXT, action TEXT, actor_id TEXT,
    occurred_at TIMESTAMPTZ, data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory(product_id)",
  "CREATE INDEX IF NOT EXISTS idx_inventory_movements_inventory_id ON inventory_movements(inventory_id)",
  "CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status)",
  "CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status)",
  "CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status)",
];

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const array = (value) => Array.isArray(value) ? value : [];

async function upsert(client, sql, values) {
  await client.query(sql, values);
}

async function syncItems(client, table, parentColumn, parentId, items, includePrice = false) {
  for (const [index, item] of array(items).entries()) {
    const itemId = item.id || `${parentId}-line-${index + 1}`;
    const values = [parentId, itemId, item.productId || null, item.inventoryId || null, number(item.quantity), JSON.stringify(item)];
    const columns = `${parentColumn}, item_id, product_id, inventory_id, quantity${includePrice ? ", unit_price" : ""}, data`;
    if (includePrice) values.splice(5, 0, number(item.unitPrice));
    const updates = `product_id = EXCLUDED.product_id, inventory_id = EXCLUDED.inventory_id, quantity = EXCLUDED.quantity${includePrice ? ", unit_price = EXCLUDED.unit_price" : ""}, data = EXCLUDED.data`;
    const placeholders = values.map((_, position) => `$${position + 1}`).join(", ");
    await upsert(client, `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) ON CONFLICT (${parentColumn}, item_id) DO UPDATE SET ${updates}`, values);
  }
}

async function syncDomainState(poolOrClient, state) {
  const ownsClient = typeof poolOrClient.connect === "function";
  const client = ownsClient ? await poolOrClient.connect() : poolOrClient;
  try {
    if (ownsClient) await client.query("BEGIN");
    for (const statement of TABLES) await client.query(statement);

    for (const product of array(state.products)) {
      await upsert(client, `INSERT INTO products (id, sku, name, model, category, data, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, now()) ON CONFLICT (id) DO UPDATE SET
        sku = EXCLUDED.sku, name = EXCLUDED.name, model = EXCLUDED.model, category = EXCLUDED.category, data = EXCLUDED.data, synced_at = now()`,
      [product.id, product.sku || null, product.name || "未命名产品", product.model || null, product.category || null, JSON.stringify(product)]);
    }
    for (const supplier of array(state.suppliers)) {
      await upsert(client, `INSERT INTO suppliers (id, name, data, synced_at) VALUES ($1, $2, $3::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, synced_at = now()`, [supplier.id, supplier.name || "未命名供应商", JSON.stringify(supplier)]);
    }
    for (const item of array(state.inventory)) {
      await upsert(client, `INSERT INTO inventory (id, product_id, sku, stock, locked, in_transit, data, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now()) ON CONFLICT (id) DO UPDATE SET
        product_id = EXCLUDED.product_id, sku = EXCLUDED.sku, stock = EXCLUDED.stock, locked = EXCLUDED.locked, in_transit = EXCLUDED.in_transit, data = EXCLUDED.data, synced_at = now()`,
      [item.id, item.productId || null, item.sku || null, number(item.stock), number(item.locked), number(item.inTransit), JSON.stringify(item)]);
    }
    for (const log of array(state.inventoryLogs)) {
      await upsert(client, `INSERT INTO inventory_movements (id, inventory_id, action, quantity, before_stock, after_stock, source_id, source_module, operator_id, occurred_at, data, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, synced_at = now()`,
      [log.id, log.itemId || null, log.action || null, number(log.quantity), number(log.beforeStock), number(log.afterStock), log.sourceId || null, log.sourceModule || null, log.operatorId || null, log.createdAt || null, JSON.stringify(log)]);
    }

    const documentTypes = [
      ["salesOrders", "sales_orders", "sales_order_items", "sales_order_id", true],
      ["purchases", "purchase_orders", "purchase_order_items", "purchase_order_id", true],
      ["deliveries", "deliveries", "delivery_items", "delivery_id", false],
    ];
    for (const [key, table, itemTable, parentColumn, includePrice] of documentTypes) {
      for (const record of array(state[key])) {
        const common = table === "sales_orders"
          ? [record.id, record.code || null, record.customer || null, record.status || null, record.leadId || null, record.owner || record.ownerId || null, JSON.stringify(record)]
          : table === "purchase_orders"
            ? [record.id, record.code || null, record.supplierId || null, record.status || null, record.sourceSalesOrderId || record.salesOrderId || null, record.owner || record.ownerId || null, JSON.stringify(record)]
            : [record.id, record.code || null, record.status || null, record.sourceSalesOrderId || record.salesOrderId || null, record.inventoryId || null, record.owner || record.ownerId || null, JSON.stringify(record)];
        const columns = table === "sales_orders" ? "id, code, customer, status, lead_id, owner_id, data" : table === "purchase_orders" ? "id, code, supplier_id, status, sales_order_id, owner_id, data" : "id, code, status, sales_order_id, inventory_id, owner_id, data";
        await upsert(client, `INSERT INTO ${table} (${columns}, synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now()) ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,status=EXCLUDED.status,data=EXCLUDED.data,synced_at=now()`, common);
        await syncItems(client, itemTable, parentColumn, record.id, record.items, includePrice);
      }
    }

    const simple = [
      ["leads", "leads", (record) => [record.id, record.status || null, record.owner || record.ownerId || null, JSON.stringify(record)]],
      ["trainings", "trainings", (record) => [record.id, record.status || null, record.salesOrderId || null, record.deliveryId || null, JSON.stringify(record)]],
      ["aftersales", "aftersales_cases", (record) => [record.id, record.status || null, record.salesOrderId || null, record.deliveryId || null, record.inventoryId || null, JSON.stringify(record)]],
      ["notices", "notices", (record) => [record.id, JSON.stringify(record)]],
      ["auditLogs", "audit_logs", (record) => [record.id, record.moduleId || null, record.recordId || null, record.action || null, record.operatorId || record.userId || null, record.createdAt || null, JSON.stringify(record)]],
    ];
    for (const [key, table, mapper] of simple) for (const record of array(state[key])) {
      const values = mapper(record);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      const columnMap = {
        leads: "id,status,owner_id,data", trainings: "id,status,sales_order_id,delivery_id,data",
        aftersales_cases: "id,status,sales_order_id,delivery_id,inventory_id,data", notices: "id,data",
        audit_logs: "id,module_id,record_id,action,actor_id,occurred_at,data",
      };
      await upsert(client, `INSERT INTO ${table} (${columnMap[table]}, synced_at) VALUES (${placeholders}, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, synced_at = now()`, values);
    }
    if (ownsClient) await client.query("COMMIT");
  } catch (error) {
    if (ownsClient) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
}

module.exports = { syncDomainState };
