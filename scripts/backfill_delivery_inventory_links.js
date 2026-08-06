const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0) continue;
  const key = line.slice(0, index).trim();
  const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = value;
}

const { readState, writeState } = require("../lib/database");

function legacyItems(record) {
  return Array.isArray(record.items) && record.items.length ? record.items : [{
    id: record.inventoryId || record.id,
    inventoryId: record.inventoryId || "",
    productId: record.productId || "",
    product: record.product || "",
    model: record.model || "",
    quantity: Number(record.quantity || 0),
    unitPrice: 0,
  }];
}

async function main() {
  const state = await readState();
  const inventoryById = new Map((state.inventory || []).map((item) => [item.id, item]));
  const productsById = new Map((state.products || []).map((item) => [item.id, item]));
  let repaired = 0;
  let skipped = 0;

  for (const delivery of state.deliveries || []) {
    const lines = legacyItems(delivery);
    const resolved = lines.map((line) => {
      const inventory = inventoryById.get(line.inventoryId || delivery.inventoryId);
      const product = productsById.get(line.productId) || productsById.get(inventory?.productId);
      if (!inventory || !(inventory.model || product?.model)) return null;
      return {
        ...line,
        inventoryId: inventory.id,
        productId: line.productId || inventory.productId || product?.id || "",
        product: line.product || inventory.name || product?.name || "",
        model: line.model || inventory.model || product?.model || "",
        quantity: Number(line.quantity || delivery.quantity || 0),
        unitPrice: Number(line.unitPrice || 0),
      };
    });
    if (resolved.some((line) => !line)) { skipped += 1; continue; }
    const first = resolved[0];
    const before = JSON.stringify({ items: delivery.items, inventoryId: delivery.inventoryId, productId: delivery.productId, product: delivery.product, model: delivery.model, quantity: delivery.quantity });
    delivery.items = resolved;
    delivery.inventoryId = first.inventoryId;
    delivery.productId = first.productId;
    delivery.product = first.product;
    delivery.model = first.model;
    delivery.quantity = resolved.reduce((total, line) => total + Number(line.quantity || 0), 0);
    if (before !== JSON.stringify({ items: delivery.items, inventoryId: delivery.inventoryId, productId: delivery.productId, product: delivery.product, model: delivery.model, quantity: delivery.quantity })) {
      delivery.updatedAt = new Date().toISOString();
      repaired += 1;
    }
  }

  if (repaired) {
    const revision = Number(state.meta?.revision || 0);
    state.meta = { ...(state.meta || {}), revision: revision + 1, updatedAt: new Date().toISOString() };
    await writeState(state, revision);
  }
  console.log(`出库单库存关联回填完成：修复 ${repaired} 条，跳过 ${skipped} 条。`);
}

main().catch((error) => { console.error(error); process.exit(1); });
