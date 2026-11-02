import { Prisma } from "@prisma/client";
import { decimal } from "./decimal.js";

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
  client: Prisma.TransactionClient,
  restaurantId: string,
  productId: string
): Promise<RecipeCost | null> {
  const recipe = await client.recipe.findFirst({
    where: { restaurantId, productId, isActive: true },
    orderBy: { version: "desc" },
    include: {
      ingredients: {
        include: {
          inventoryItem: {
            select: {
              id: true,
              name: true,
              unit: true,
              averageCostMinorPerUnit: true
            }
          }
        }
      }
    }
  });

  if (!recipe) return null;

  const yieldQuantity = decimal(recipe.yieldQuantity);
  const lines: RecipeCostLine[] = recipe.ingredients.map((ingredient) => {
    const quantityPerYieldUnit = decimal(ingredient.quantity).div(yieldQuantity);
    const lineCostMinor = BigInt(
      quantityPerYieldUnit
        .mul(ingredient.inventoryItem.averageCostMinorPerUnit)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(0)
    );

    return {
      inventoryItemId: ingredient.inventoryItemId,
      inventoryItemName: ingredient.inventoryItem.name,
      unit: ingredient.unit,
      quantityPerYieldUnit: quantityPerYieldUnit.toFixed(4),
      averageCostMinorPerUnit:
        ingredient.inventoryItem.averageCostMinorPerUnit.toFixed(6),
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
