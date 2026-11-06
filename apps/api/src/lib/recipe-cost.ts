import type { PoolClient } from "pg";
import { decimal, roundTo } from "./decimal.js";

export type RecipeCostLine = {
  inventoryItemId: string;
  inventoryItemName: string;
  unit: string;
  quantityPerYieldUnit: string;
  averageCostMinorPerUnit: string;
  lineCostMinor: bigint;
};

export type RecipeCost = {
  recipeId: string;
  version: number;
  costPerYieldUnitMinor: bigint;
  lines: RecipeCostLine[];
};

export async function getActiveRecipeCost(
  client: PoolClient,
  restaurantId: string,
  productId: string
): Promise<RecipeCost | null> {
  const { rows: recipes } = await client.query<{
    id: string;
    version: number;
    yield_quantity: string;
  }>(
    `SELECT id, version, yield_quantity
     FROM recipes
     WHERE restaurant_id = $1 AND product_id = $2 AND is_active = true
     ORDER BY version DESC
     LIMIT 1`,
    [restaurantId, productId]
  );

  const recipe = recipes[0];

  if (!recipe) {
    return null;
  }

  const { rows: ingredients } = await client.query<{
    inventory_item_id: string;
    quantity: string;
    unit: string;
    name: string;
    average_cost_minor_per_unit: string;
  }>(
    `SELECT ri.inventory_item_id, ri.quantity, ri.unit,
            ii.name, ii.average_cost_minor_per_unit
     FROM recipe_ingredients ri
     JOIN inventory_items ii ON ii.id = ri.inventory_item_id
     WHERE ri.recipe_id = $1`,
    [recipe.id]
  );

  const yieldQuantity = decimal(recipe.yield_quantity);

  if (yieldQuantity.isZero()) {
    return null;
  }

  const lines: RecipeCostLine[] = ingredients.map((ingredient) => {
    const quantityPerYieldUnit = decimal(ingredient.quantity).div(yieldQuantity);
    const lineCostMinor = roundTo(
      quantityPerYieldUnit.mul(ingredient.average_cost_minor_per_unit),
      0
    );

    return {
      inventoryItemId: ingredient.inventory_item_id,
      inventoryItemName: ingredient.name,
      unit: ingredient.unit,
      quantityPerYieldUnit: quantityPerYieldUnit.toFixed(4),
      averageCostMinorPerUnit: decimal(
        ingredient.average_cost_minor_per_unit
      ).toFixed(6),
      lineCostMinor
    };
  });

  return {
    recipeId: recipe.id,
    version: recipe.version,
    costPerYieldUnitMinor: lines.reduce((sum, line) => sum + line.lineCostMinor, 0n),
    lines
  };
}
