import type { PoolClient } from "pg";
import { recordAudit } from "../../lib/audit.js";
import { query, transaction } from "../../lib/db.js";
import { decimal, roundTo } from "../../lib/decimal.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { getActiveRecipeCost } from "../../lib/recipe-cost.js";

type AuditMeta = { ip?: string; userAgent?: string };
type IngredientInput = { inventoryItemId: string; quantity: string; unit: string };

async function validateIngredients(
  client: PoolClient,
  restaurantId: string,
  ingredients: IngredientInput[]
): Promise<void> {
  const ids = ingredients.map((item) => item.inventoryItemId);

  if (new Set(ids).size !== ids.length) {
    throw new BadRequestError("Each inventory item may only appear once");
  }

  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM inventory_items
     WHERE restaurant_id = $1 AND id = ANY($2::uuid[]) AND is_active = true`,
    [restaurantId, ids]
  );

  if (rows.length !== ids.length) {
    throw new NotFoundError("One or more inventory items were not found");
  }
}

type RecipeHeaderRow = {
  id: string;
  product_id: string;
  product_name: string;
  selling_price_minor: string;
  version: number;
  yield_quantity: string;
  is_active: boolean;
  notes: string | null;
};

type RecipeIngredientRow = {
  id: string;
  inventory_item_id: string;
  quantity: string;
  unit: string;
  name: string;
  average_cost_minor_per_unit: string;
};

async function serializeRecipe(recipeId: string) {
  const { rows: recipes } = await query<RecipeHeaderRow>(
    `SELECT r.id, r.product_id, p.name AS product_name, p.selling_price_minor,
            r.version, r.yield_quantity, r.is_active, r.notes
     FROM recipes r
     JOIN products p ON p.id = r.product_id
     WHERE r.id = $1`,
    [recipeId]
  );
  const recipe = recipes[0];

  if (!recipe) {
    throw new NotFoundError("The recipe was not found");
  }

  const { rows: ingredients } = await query<RecipeIngredientRow>(
    `SELECT ri.id, ri.inventory_item_id, ri.quantity, ri.unit,
            ii.name, ii.average_cost_minor_per_unit
     FROM recipe_ingredients ri
     JOIN inventory_items ii ON ii.id = ri.inventory_item_id
     WHERE ri.recipe_id = $1`,
    [recipeId]
  );

  const yieldQuantity = decimal(recipe.yield_quantity);
  const lines = ingredients.map((ingredient) => {
    const perUnit = decimal(ingredient.quantity).div(yieldQuantity);
    const cost = roundTo(
      perUnit.mul(ingredient.average_cost_minor_per_unit),
      0
    );

    return {
      id: ingredient.id,
      inventoryItemId: ingredient.inventory_item_id,
      name: ingredient.name,
      quantity: decimal(ingredient.quantity).toFixed(4),
      unit: ingredient.unit,
      averageCostMinorPerUnit: decimal(
        ingredient.average_cost_minor_per_unit
      ).toFixed(6),
      costMinor: cost.toString(),
      quantityPerYieldUnit: perUnit.toFixed(4)
    };
  });

  const costMinor = lines.reduce((sum, line) => sum + BigInt(line.costMinor), 0n);

  return {
    id: recipe.id,
    productId: recipe.product_id,
    productName: recipe.product_name,
    sellingPriceMinor: recipe.selling_price_minor,
    version: recipe.version,
    yieldQuantity: yieldQuantity.toFixed(4),
    isActive: recipe.is_active,
    notes: recipe.notes,
    costPerYieldUnitMinor: costMinor.toString(),
    grossMarginMinor: (
      BigInt(recipe.selling_price_minor) - costMinor
    ).toString(),
    ingredients: lines
  };
}

export async function listRecipes(restaurantId: string, productId?: string) {
  const params: unknown[] = [restaurantId];
  let where = "WHERE restaurant_id = $1";

  if (productId) {
    params.push(productId);
    where += ` AND product_id = $${params.length}`;
  }

  const { rows } = await query<{ id: string }>(
    `SELECT id FROM recipes ${where} ORDER BY product_id ASC, version DESC`,
    params
  );

  return Promise.all(rows.map((recipe) => serializeRecipe(recipe.id)));
}

export async function getRecipe(restaurantId: string, recipeId: string) {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM recipes WHERE id = $1 AND restaurant_id = $2`,
    [recipeId, restaurantId]
  );

  if (!rows[0]) {
    throw new NotFoundError("The recipe was not found");
  }

  return serializeRecipe(recipeId);
}

export async function createRecipe(
  restaurantId: string,
  actorUserId: string,
  input: {
    productId: string;
    yieldQuantity: string;
    notes?: string;
    ingredients: IngredientInput[];
  },
  meta: AuditMeta
) {
  const recipeId = await transaction(async (client) => {
    const { rows: products } = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE id = $1 AND restaurant_id = $2`,
      [input.productId, restaurantId]
    );

    if (!products[0]) {
      throw new NotFoundError("The product was not found");
    }

    if (decimal(input.yieldQuantity).lte(0)) {
      throw new BadRequestError("Yield quantity must be greater than zero");
    }

    await validateIngredients(client, restaurantId, input.ingredients);

    const { rows: versions } = await client.query<{ max: number | null }>(
      `SELECT MAX(version) AS max FROM recipes WHERE product_id = $1`,
      [input.productId]
    );
    const version = (versions[0]?.max ?? 0) + 1;

    await client.query(
      `UPDATE recipes SET is_active = false, updated_at = NOW()
       WHERE product_id = $1 AND is_active = true`,
      [input.productId]
    );

    const { rows: recipes } = await client.query<{ id: string }>(
      `INSERT INTO recipes
         (id, restaurant_id, product_id, version, yield_quantity, is_active,
          notes, created_by_user_id, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, true, $5, $6, NOW(), NOW())
       RETURNING id`,
      [
        restaurantId,
        input.productId,
        version,
        decimal(input.yieldQuantity).toFixed(4),
        input.notes ?? null,
        actorUserId
      ]
    );
    const recipe = recipes[0]!;

    for (const ingredient of input.ingredients) {
      await client.query(
        `INSERT INTO recipe_ingredients
           (id, recipe_id, inventory_item_id, quantity, unit)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4)`,
        [
          recipe.id,
          ingredient.inventoryItemId,
          decimal(ingredient.quantity).toFixed(4),
          ingredient.unit
        ]
      );
    }

    await client.query(
      `UPDATE products SET is_recipe_based = true, updated_at = NOW() WHERE id = $1`,
      [input.productId]
    );

    await recordAudit(client, {
      restaurantId,
      actorUserId,
      action: "RECIPE_CREATED",
      entityType: "Recipe",
      entityId: recipe.id,
      after: { productId: input.productId, version },
      ...meta
    });

    return recipe.id;
  });

  return serializeRecipe(recipeId);
}

export async function updateRecipe(
  restaurantId: string,
  actorUserId: string,
  recipeId: string,
  input: {
    yieldQuantity?: string;
    notes?: string | null;
    ingredients?: IngredientInput[];
    isActive?: boolean;
  },
  meta: AuditMeta
) {
  await transaction(async (client) => {
    const { rows: recipes } = await client.query<{
      id: string;
      product_id: string;
      is_active: boolean;
    }>(
      `SELECT id, product_id, is_active FROM recipes
       WHERE id = $1 AND restaurant_id = $2`,
      [recipeId, restaurantId]
    );
    const recipe = recipes[0];

    if (!recipe) {
      throw new NotFoundError("The recipe was not found");
    }

    if (input.yieldQuantity !== undefined && decimal(input.yieldQuantity).lte(0)) {
      throw new BadRequestError("Yield quantity must be greater than zero");
    }

    if (input.ingredients) {
      await validateIngredients(client, restaurantId, input.ingredients);
    }

    if (input.isActive) {
      await client.query(
        `UPDATE recipes SET is_active = false, updated_at = NOW()
         WHERE product_id = $1 AND id <> $2`,
        [recipe.product_id, recipeId]
      );
    }

    const assignments: string[] = [];
    const params: unknown[] = [];

    if (input.yieldQuantity !== undefined) {
      params.push(decimal(input.yieldQuantity).toFixed(4));
      assignments.push(`yield_quantity = $${params.length}`);
    }

    if (input.notes !== undefined) {
      params.push(input.notes);
      assignments.push(`notes = $${params.length}`);
    }

    if (input.isActive !== undefined) {
      params.push(input.isActive);
      assignments.push(`is_active = $${params.length}`);
    }

    if (assignments.length > 0) {
      params.push(recipeId);
      await client.query(
        `UPDATE recipes
         SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE id = $${params.length}`,
        params
      );
    }

    if (input.ingredients) {
      await client.query(`DELETE FROM recipe_ingredients WHERE recipe_id = $1`, [
        recipeId
      ]);

      for (const ingredient of input.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients
             (id, recipe_id, inventory_item_id, quantity, unit)
           VALUES
             (gen_random_uuid(), $1, $2, $3, $4)`,
          [
            recipeId,
            ingredient.inventoryItemId,
            decimal(ingredient.quantity).toFixed(4),
            ingredient.unit
          ]
        );
      }
    }

    await recordAudit(client, {
      restaurantId,
      actorUserId,
      action: "RECIPE_UPDATED",
      entityType: "Recipe",
      entityId: recipeId,
      after: { isActive: input.isActive },
      ...meta
    });
  });

  return getRecipe(restaurantId, recipeId);
}

export async function getProductRecipeCost(restaurantId: string, productId: string) {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM products WHERE id = $1 AND restaurant_id = $2`,
    [productId, restaurantId]
  );

  if (!rows[0]) {
    throw new NotFoundError("The product was not found");
  }

  const cost = await transaction((client) =>
    getActiveRecipeCost(client, restaurantId, productId)
  );

  if (!cost) {
    throw new NotFoundError("This product has no active recipe");
  }

  return cost;
}
