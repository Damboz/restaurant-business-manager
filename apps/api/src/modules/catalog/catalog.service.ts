import { recordAudit } from "../../lib/audit.js";
import { query, transaction } from "../../lib/db.js";
import { bigintToJson } from "../../lib/decimal.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

type AuditMeta = { ip?: string; userAgent?: string };

function isUnique(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

type ProductCategoryRow = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  product_count: number;
  created_at: Date;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category_id: string;
  category_name: string;
  selling_price_minor: string;
  currency: string;
  status: "ACTIVE" | "INACTIVE";
  is_recipe_based: boolean;
  recipe_id: string | null;
  recipe_version: number | null;
  recipe_yield_quantity: string | null;
  created_at: Date;
  updated_at: Date;
};

type ProductPriceRow = {
  old_price_minor: string;
  new_price_minor: string;
  changed_at: Date;
};

function serializeProductCategory(category: ProductCategoryRow) {
  return {
    id: category.id,
    name: category.name,
    sortOrder: category.sort_order,
    isActive: category.is_active,
    productCount: category.product_count,
    createdAt: category.created_at.toISOString()
  };
}

function serializeProductSummary(product: ProductRow) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.category_id,
    categoryName: product.category_name,
    sellingPriceMinor: bigintToJson(product.selling_price_minor),
    currency: product.currency,
    status: product.status,
    isRecipeBased: product.is_recipe_based,
    activeRecipe:
      product.recipe_id && product.recipe_version !== null
        ? {
            id: product.recipe_id,
            version: product.recipe_version,
            yieldQuantity: product.recipe_yield_quantity ?? "1"
          }
        : null,
    createdAt: product.created_at.toISOString(),
    updatedAt: product.updated_at.toISOString()
  };
}

export async function listProductCategories(restaurantId: string) {
  const { rows } = await query<ProductCategoryRow>(
    `SELECT pc.id, pc.name, pc.sort_order, pc.is_active, pc.created_at,
            COUNT(p.id)::int AS product_count
     FROM product_categories pc
     LEFT JOIN products p ON p.category_id = pc.id
     WHERE pc.restaurant_id = $1
     GROUP BY pc.id
     ORDER BY pc.sort_order ASC, pc.name ASC`,
    [restaurantId]
  );

  return rows.map(serializeProductCategory);
}

export async function createProductCategory(
  restaurantId: string,
  actorUserId: string,
  input: { name: string; sortOrder: number; isActive: boolean },
  meta: AuditMeta
) {
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO product_categories
         (id, restaurant_id, name, sort_order, is_active, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       RETURNING id`,
      [restaurantId, input.name, input.sortOrder, input.isActive]
    );
    const category = rows[0]!;

    await recordAudit(null, {
      restaurantId,
      actorUserId,
      action: "PRODUCT_CATEGORY_CREATED",
      entityType: "ProductCategory",
      entityId: category.id,
      after: input,
      ...meta
    });

    return { id: category.id };
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("A product category with this name already exists");
    }
    throw error;
  }
}

const CATEGORY_COLUMNS: Record<string, string> = {
  name: "name",
  sortOrder: "sort_order",
  isActive: "is_active"
};

export async function updateProductCategory(
  restaurantId: string,
  actorUserId: string,
  categoryId: string,
  input: Record<string, unknown>,
  meta: AuditMeta
) {
  const { rows: existingRows } = await query<ProductCategoryRow>(
    `SELECT id, name, sort_order, is_active, created_at
     FROM product_categories
     WHERE id = $1 AND restaurant_id = $2`,
    [categoryId, restaurantId]
  );
  const existing = existingRows[0];

  if (!existing) {
    throw new NotFoundError("The product category was not found");
  }

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(CATEGORY_COLUMNS)) {
    if (input[key] !== undefined) {
      params.push(input[key]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (assignments.length > 0) {
    params.push(categoryId);
    params.push(restaurantId);

    try {
      await query(
        `UPDATE product_categories
         SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE id = $${params.length - 1} AND restaurant_id = $${params.length}`,
        params
      );
    } catch (error) {
      if (isUnique(error)) {
        throw new ConflictError("A product category with this name already exists");
      }
      throw error;
    }
  }

  await recordAudit(null, {
    restaurantId,
    actorUserId,
    action: "PRODUCT_CATEGORY_UPDATED",
    entityType: "ProductCategory",
    entityId: categoryId,
    before: { name: existing.name, isActive: existing.is_active },
    after: input,
    ...meta
  });

  const categories = await listProductCategories(restaurantId);

  return categories.find((item) => item.id === categoryId)!;
}

export async function listProducts(
  restaurantId: string,
  queryInput: {
    page: number;
    pageSize: number;
    search?: string;
    categoryId?: string;
    status?: "ACTIVE" | "INACTIVE";
  }
) {
  const params: unknown[] = [restaurantId];
  let where = "WHERE p.restaurant_id = $1";

  if (queryInput.categoryId) {
    params.push(queryInput.categoryId);
    where += ` AND p.category_id = $${params.length}`;
  }

  if (queryInput.status) {
    params.push(queryInput.status);
    where += ` AND p.status = $${params.length}`;
  }

  if (queryInput.search) {
    params.push(`%${queryInput.search}%`);
    where += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
  }

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const offset = (queryInput.page - 1) * queryInput.pageSize;

  const [productsResult, countResult] = await Promise.all([
    query<ProductRow>(
      `SELECT p.id, p.name, p.description, p.category_id,
              pc.name AS category_name, p.selling_price_minor, p.currency,
              p.status, p.is_recipe_based, p.created_at, p.updated_at,
              r.id AS recipe_id, r.version AS recipe_version,
              r.yield_quantity AS recipe_yield_quantity
       FROM products p
       JOIN product_categories pc ON pc.id = p.category_id
       LEFT JOIN LATERAL (
         SELECT id, version, yield_quantity
         FROM recipes
         WHERE product_id = p.id AND is_active = true
         LIMIT 1
       ) r ON true
       ${where}
       ORDER BY p.status ASC, p.name ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, queryInput.pageSize, offset]
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM products p ${where}`,
      params
    )
  ]);

  return {
    items: productsResult.rows.map(serializeProductSummary),
    total: countResult.rows[0]?.count ?? 0,
    page: queryInput.page,
    pageSize: queryInput.pageSize
  };
}

export async function getProduct(restaurantId: string, productId: string) {
  const { rows } = await query<ProductRow>(
    `SELECT p.id, p.name, p.description, p.category_id,
            pc.name AS category_name, p.selling_price_minor, p.currency,
            p.status, p.is_recipe_based, p.created_at, p.updated_at,
            NULL::uuid AS recipe_id, NULL::integer AS recipe_version,
            NULL::text AS recipe_yield_quantity
     FROM products p
     JOIN product_categories pc ON pc.id = p.category_id
     WHERE p.id = $1 AND p.restaurant_id = $2`,
    [productId, restaurantId]
  );
  const product = rows[0];

  if (!product) {
    throw new NotFoundError("The product was not found");
  }

  const { rows: priceHistory } = await query<ProductPriceRow>(
    `SELECT old_price_minor, new_price_minor, changed_at
     FROM product_price_history
     WHERE product_id = $1
     ORDER BY changed_at DESC
     LIMIT 20`,
    [productId]
  );

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.category_id,
    categoryName: product.category_name,
    sellingPriceMinor: bigintToJson(product.selling_price_minor),
    currency: product.currency,
    status: product.status,
    isRecipeBased: product.is_recipe_based,
    priceHistory: priceHistory.map((entry) => ({
      oldPriceMinor: bigintToJson(entry.old_price_minor),
      newPriceMinor: bigintToJson(entry.new_price_minor),
      changedAt: entry.changed_at.toISOString()
    }))
  };
}

export async function createProduct(
  restaurantId: string,
  actorUserId: string,
  input: {
    categoryId: string;
    name: string;
    description?: string;
    sellingPriceMinor: bigint;
    isRecipeBased: boolean;
    status: "ACTIVE" | "INACTIVE";
  },
  meta: AuditMeta
) {
  const { rows: categories } = await query<{ id: string }>(
    `SELECT id FROM product_categories WHERE id = $1 AND restaurant_id = $2`,
    [input.categoryId, restaurantId]
  );

  if (!categories[0]) {
    throw new NotFoundError("The product category was not found");
  }

  let productId: string;

  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO products
         (id, restaurant_id, category_id, name, description, selling_price_minor,
          is_recipe_based, status, created_by_user_id, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [
        restaurantId,
        input.categoryId,
        input.name,
        input.description ?? null,
        input.sellingPriceMinor.toString(),
        input.isRecipeBased,
        input.status,
        actorUserId
      ]
    );
    productId = rows[0]!.id;
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("A product with this name already exists");
    }
    throw error;
  }

  await recordAudit(null, {
    restaurantId,
    actorUserId,
    action: "PRODUCT_CREATED",
    entityType: "Product",
    entityId: productId,
    after: { name: input.name, sellingPriceMinor: input.sellingPriceMinor.toString() },
    ...meta
  });

  return getProduct(restaurantId, productId);
}

const PRODUCT_COLUMNS: Record<string, string> = {
  categoryId: "category_id",
  name: "name",
  description: "description",
  sellingPriceMinor: "selling_price_minor",
  status: "status",
  isRecipeBased: "is_recipe_based"
};

export async function updateProduct(
  restaurantId: string,
  actorUserId: string,
  productId: string,
  input: {
    categoryId?: string;
    name?: string;
    description?: string | null;
    sellingPriceMinor?: bigint;
    status?: "ACTIVE" | "INACTIVE";
    isRecipeBased?: boolean;
  },
  meta: AuditMeta
) {
  const { rows: existingRows } = await query<{
    id: string;
    name: string;
    selling_price_minor: string;
    status: "ACTIVE" | "INACTIVE";
  }>(
    `SELECT id, name, selling_price_minor, status
     FROM products
     WHERE id = $1 AND restaurant_id = $2`,
    [productId, restaurantId]
  );
  const existing = existingRows[0];

  if (!existing) {
    throw new NotFoundError("The product was not found");
  }

  if (input.categoryId) {
    const { rows: categories } = await query<{ id: string }>(
      `SELECT id FROM product_categories WHERE id = $1 AND restaurant_id = $2`,
      [input.categoryId, restaurantId]
    );

    if (!categories[0]) {
      throw new NotFoundError("The product category was not found");
    }
  }

  if (input.isRecipeBased === false) {
    await query(
      `UPDATE recipes SET is_active = false, updated_at = NOW()
       WHERE product_id = $1 AND is_active = true`,
      [productId]
    );
  }

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(PRODUCT_COLUMNS)) {
    const value = input[key as keyof typeof input];

    if (value !== undefined) {
      params.push(
        typeof value === "bigint" ? value.toString() : value
      );
      assignments.push(`${column} = $${params.length}`);
    }
  }

  try {
    await transaction(async (client) => {
      if (
        input.sellingPriceMinor !== undefined &&
        BigInt(input.sellingPriceMinor) !== BigInt(existing.selling_price_minor)
      ) {
        await client.query(
          `INSERT INTO product_price_history
             (id, product_id, old_price_minor, new_price_minor, changed_by_user_id, changed_at)
           VALUES
             (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
          [
            productId,
            existing.selling_price_minor,
            input.sellingPriceMinor!.toString(),
            actorUserId
          ]
        );
      }

      if (assignments.length > 0) {
        const updateParams = [...params, productId, restaurantId];
        await client.query(
          `UPDATE products
           SET ${assignments.join(", ")}, updated_at = NOW()
           WHERE id = $${updateParams.length - 1} AND restaurant_id = $${updateParams.length}`,
          updateParams
        );
      }
    });
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("A product with this name already exists");
    }
    throw error;
  }

  await recordAudit(null, {
    restaurantId,
    actorUserId,
    action: "PRODUCT_UPDATED",
    entityType: "Product",
    entityId: productId,
    before: {
      name: existing.name,
      sellingPriceMinor: existing.selling_price_minor,
      status: existing.status
    },
    after: {
      ...input,
      sellingPriceMinor: input.sellingPriceMinor?.toString()
    },
    ...meta
  });

  return getProduct(restaurantId, productId);
}
