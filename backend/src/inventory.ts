import { db } from "./db.js";

export interface ProductInventory {
  productName: string;
  category: string;
  sku: string;
  variant: string;
  price: number;
  quantity: number;
  reorderLevel: number;
}

export type StockStatus = "low_stock" | "out_of_stock" | "available";

export interface AddProductInput {
  category: string;
  productName: string;
  description?: string;
  sku: string;
  variantName: string;
  price: number;
  initialQuantity: number;
}

export type OperationResult<T = undefined> =
  | { success: true; message: string; data: T }
  | { success: false; message: string };

interface ProductRow {
  productName: string;
  category: string;
  sku: string;
  variant: string;
  price: number;
  quantity: number;
  reorderLevel: number;
}

const productDetailsQuery = `
  SELECT
    p.product_name AS productName,
    c.category_name AS category,
    pv.sku,
    pv.variant_name AS variant,
    pv.price,
    i.quantity,
    i.reorder_level AS reorderLevel
  FROM Products p
  JOIN Categories c ON c.category_id = p.category_id
  JOIN ProductVariants pv ON pv.product_id = p.product_id
  JOIN Inventory i ON i.variant_id = pv.variant_id
`;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "An unexpected database error occurred.";

export function searchProducts(query: string): ProductInventory[] {
  if (typeof query !== "string") {
    throw new TypeError("Search query must be a string.");
  }

  const searchTerm = `%${query.trim()}%`;
  try {
    return db
      .prepare<[string, string, string], ProductRow>(`
        ${productDetailsQuery}
        WHERE p.product_name LIKE ? COLLATE NOCASE
           OR pv.sku LIKE ? COLLATE NOCASE
           OR c.category_name LIKE ? COLLATE NOCASE
        ORDER BY p.product_name, pv.sku
      `)
      .all(searchTerm, searchTerm, searchTerm);
  } catch (error) {
    throw new Error(`Could not search products: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

export function getStockStatus(status: string): ProductInventory[] {
  const conditions: Record<StockStatus, string> = {
    low_stock: "i.quantity > 0 AND i.quantity <= i.reorder_level",
    out_of_stock: "i.quantity = 0",
    available: "i.quantity > i.reorder_level",
  };

  if (!Object.hasOwn(conditions, status)) {
    throw new RangeError(
      `Unsupported stock status "${status}". Use low_stock, out_of_stock, or available.`,
    );
  }

  try {
    return db
      .prepare<[], ProductRow>(`
        ${productDetailsQuery}
        WHERE ${conditions[status as StockStatus]}
        ORDER BY p.product_name, pv.sku
      `)
      .all();
  } catch (error) {
    throw new Error(`Could not retrieve stock status: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

export function updateStock(
  sku: string,
  quantity: number,
): OperationResult<{ sku: string; quantity: number }> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    return {
      success: false,
      message: "Quantity must be a non-negative integer.",
    };
  }
  if (typeof sku !== "string" || sku.trim().length === 0) {
    return { success: false, message: "SKU must be a non-empty string." };
  }

  try {
    const result = db
      .prepare(`
        UPDATE Inventory
        SET quantity = ?
        WHERE variant_id = (
          SELECT variant_id FROM ProductVariants WHERE sku = ?
        )
      `)
      .run(quantity, sku.trim());

    if (result.changes === 0) {
      return { success: false, message: `No product found for SKU "${sku}".` };
    }

    return {
      success: true,
      message: `Stock for SKU "${sku}" updated successfully.`,
      data: { sku: sku.trim(), quantity },
    };
  } catch (error) {
    return {
      success: false,
      message: `Could not update stock: ${getErrorMessage(error)}`,
    };
  }
}

export function addProduct(
  input: AddProductInput,
): OperationResult<{ sku: string; productId: number; variantId: number }> {
  if (
    !input ||
    typeof input.category !== "string" ||
    input.category.trim().length === 0 ||
    typeof input.productName !== "string" ||
    input.productName.trim().length === 0 ||
    typeof input.sku !== "string" ||
    input.sku.trim().length === 0 ||
    typeof input.variantName !== "string" ||
    input.variantName.trim().length === 0 ||
    (input.description !== undefined && typeof input.description !== "string")
  ) {
    return {
      success: false,
      message: "Category, product name, SKU, and variant name are required.",
    };
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    return { success: false, message: "Price must be a non-negative number." };
  }
  if (!Number.isInteger(input.initialQuantity) || input.initialQuantity < 0) {
    return {
      success: false,
      message: "Initial quantity must be a non-negative integer.",
    };
  }

  const categoryName = input.category.trim();
  const productName = input.productName.trim();
  const sku = input.sku.trim();
  const variantName = input.variantName.trim();

  try {
    return db.transaction((): OperationResult<{
      sku: string;
      productId: number;
      variantId: number;
    }> => {
      const existingSku = db
        .prepare("SELECT 1 FROM ProductVariants WHERE sku = ?")
        .get(sku);
      if (existingSku) {
        return { success: false, message: `SKU "${sku}" already exists.` };
      }

      db.prepare("INSERT OR IGNORE INTO Categories (category_name) VALUES (?)").run(
        categoryName,
      );
      const category = db
        .prepare<[string], { category_id: number }>(
          "SELECT category_id FROM Categories WHERE category_name = ?",
        )
        .get(categoryName);
      if (!category) {
        throw new Error(`Could not create or find category "${categoryName}".`);
      }

      const productResult = db
        .prepare(
          "INSERT INTO Products (category_id, product_name, description) VALUES (?, ?, ?)",
        )
        .run(category.category_id, productName, input.description?.trim() || null);
      const productId = Number(productResult.lastInsertRowid);

      const variantResult = db
        .prepare(
          "INSERT INTO ProductVariants (product_id, sku, variant_name, price) VALUES (?, ?, ?, ?)",
        )
        .run(productId, sku, variantName, input.price);
      const variantId = Number(variantResult.lastInsertRowid);

      db.prepare(
        "INSERT INTO Inventory (variant_id, quantity, reorder_level) VALUES (?, ?, 10)",
      ).run(variantId, input.initialQuantity);

      return {
        success: true,
        message: `Product "${productName}" added successfully.`,
        data: { sku, productId, variantId },
      };
    })();
  } catch (error) {
    return {
      success: false,
      message: `Could not add product: ${getErrorMessage(error)}`,
    };
  }
}
