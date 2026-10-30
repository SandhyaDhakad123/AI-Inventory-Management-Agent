import { db } from "./db.js";

const seedData = [
  {
    category: "Electronics",
    product: "Laptop",
    sku: "LAP-001",
    variant: "16GB RAM",
    price: 55000,
    quantity: 5,
  },
  {
    category: "Electronics",
    product: "Keyboard",
    sku: "KEY-001",
    variant: "Black",
    price: 1200,
    quantity: 30,
  },
  {
    category: "Accessories",
    product: "Wireless Mouse",
    sku: "MOU-101",
    variant: "Black",
    price: 799,
    quantity: 50,
  },
  {
    category: "Furniture",
    product: "Office Chair",
    sku: "CHR-001",
    variant: "Standard",
    price: 4500,
    quantity: 0,
  },
] as const;

const seed = db.transaction(() => {
  const insertCategory = db.prepare(
    "INSERT OR IGNORE INTO Categories (category_name) VALUES (?)",
  );
  const findCategory = db.prepare(
    "SELECT category_id FROM Categories WHERE category_name = ?",
  );
  const insertProduct = db.prepare(
    "INSERT INTO Products (category_id, product_name) VALUES (?, ?)",
  );
  const findProduct = db.prepare(
    "SELECT product_id FROM Products WHERE category_id = ? AND product_name = ?",
  );
  const insertVariant = db.prepare(
    "INSERT INTO ProductVariants (product_id, sku, variant_name, price) VALUES (?, ?, ?, ?)",
  );
  const findVariant = db.prepare(
    "SELECT variant_id, product_id FROM ProductVariants WHERE sku = ?",
  );
  const insertInventory = db.prepare(
    "INSERT OR IGNORE INTO Inventory (variant_id, quantity, reorder_level) VALUES (?, ?, 10)",
  );
  const setReorderLevel = db.prepare(
    "UPDATE Inventory SET reorder_level = 10 WHERE variant_id = ?",
  );

  for (const item of seedData) {
    insertCategory.run(item.category);
    const category = findCategory.get(item.category) as
      | { category_id: number }
      | undefined;
    if (!category) {
      throw new Error(`Could not find category "${item.category}" after inserting it.`);
    }

    let product = findProduct.get(category.category_id, item.product) as
      | { product_id: number }
      | undefined;
    if (!product) {
      insertProduct.run(category.category_id, item.product);
      product = findProduct.get(category.category_id, item.product) as
        | { product_id: number }
        | undefined;
    }
    if (!product) {
      throw new Error(`Could not find product "${item.product}" after inserting it.`);
    }

    let variant = findVariant.get(item.sku) as
      | { variant_id: number; product_id: number }
      | undefined;
    if (!variant) {
      insertVariant.run(product.product_id, item.sku, item.variant, item.price);
      variant = findVariant.get(item.sku) as
        | { variant_id: number; product_id: number }
        | undefined;
    }
    if (!variant || variant.product_id !== product.product_id) {
      throw new Error(`SKU "${item.sku}" is already associated with a different product.`);
    }

    insertInventory.run(variant.variant_id, item.quantity);
    setReorderLevel.run(variant.variant_id);
  }
});

try {
  seed();
  console.log("Sample inventory data seeded successfully.");
} catch (error) {
  console.error("Failed to seed sample inventory data:", error);
  process.exitCode = 1;
} finally {
  db.close();
}
