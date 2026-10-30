import { db } from "./db.js";

try {
  const products = db
    .prepare(`
      SELECT
        c.category_name AS category,
        p.product_name AS product,
        pv.sku,
        pv.variant_name AS variant,
        pv.price,
        i.quantity,
        i.reorder_level
      FROM Products p
      JOIN Categories c ON c.category_id = p.category_id
      JOIN ProductVariants pv ON pv.product_id = p.product_id
      JOIN Inventory i ON i.variant_id = pv.variant_id
      ORDER BY c.category_name, p.product_name, pv.sku
    `)
    .all();

  console.log("Products and inventory:");
  console.table(products);
} catch (error) {
  console.error("Failed to verify database contents:", error);
  process.exitCode = 1;
} finally {
  db.close();
}