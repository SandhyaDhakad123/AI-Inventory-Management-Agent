
import Database from "better-sqlite3";

// Create SQLite database
export const db: InstanceType<typeof Database> = new Database("inventory.db");

// Enable foreign keys
db.pragma("foreign_keys = ON");

// Create database tables
db.exec(`

  CREATE TABLE IF NOT EXISTS Categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS Products (
    product_id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    description TEXT,

    FOREIGN KEY (category_id)
    REFERENCES Categories(category_id)
  );

  CREATE TABLE IF NOT EXISTS ProductVariants (
    variant_id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    variant_name TEXT NOT NULL,
    price REAL NOT NULL CHECK(price >= 0),

    FOREIGN KEY (product_id)
    REFERENCES Products(product_id)
  );

  CREATE TABLE IF NOT EXISTS Inventory (
    inventory_id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL UNIQUE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    reorder_level INTEGER NOT NULL DEFAULT 10,

    FOREIGN KEY (variant_id)
    REFERENCES ProductVariants(variant_id)
  );

`);

console.log("Database and tables created successfully!");
