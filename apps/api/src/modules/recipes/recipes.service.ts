import { Prisma } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import { decimal } from "../../lib/decimal.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { getActiveRecipeCost } from "../../lib/recipe-cost.js";

type AuditMeta = { ip?: string; userAgent?: string };
type IngredientInput = { inventoryItemId: string; quantity: string; unit: string };

async function validateIngredients(
  transaction: Prisma.TransactionClient,
  restaurantId: string,
  ingredients: IngredientInput[]
): Promise<void> {
  const ids = ingredients.map((item) => item.inventoryItemId);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestError("Each inventory item may only appear once");
  }

  const found = await transaction.inventoryItem.findMany({
    where: { restaurantId, id: { in: ids }, isActive: true },
    select: { id: true }
  });

  if (found.length !== ids.length) {
    throw new NotFoundError("One or more inventory items were not found");
  }
}

async function serializeRecipe(recipeId: string) {
  const recipe = await prisma.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    include: {
      product: { select: { id: true, name: true, sellingPriceMinor: true } },
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

  const lines = recipe.ingredients.map((ingredient) => {
    const perUnit = decimal(ingredient.quantity).div(recipe.yieldQuantity);
    const cost = BigInt(
      perUnit
        .mul(ingredient.inventoryItem.averageCostMinorPerUnit)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(0)
    );

    return {
      id: ingredient.id,
      inventoryItemId: ingredient.inventoryItemId,
      name: ingredient.inventoryItem.name,
      quantity: ingredient.quantity.toFixed(4),
      unit: ingredient.unit,
      averageCostMinorPerUnit:
        ingredient.inventoryItem.averageCostMinorPerUnit.toFixed(6),
      costMinor: cost.toString(),
      quantityPerYieldUnit: perUnit.toFixed(4)
    };
  });

  const costMinor = lines.reduce((sum, line) => sum + BigInt(line.costMinor), 0n);

  return {
    id: recipe.id,
    productId: recipe.productId,
    productName: recipe.product.name,
    sellingPriceMinor: recipe.product.sellingPriceMinor.toString(),
    version: recipe.version,
    yieldQuantity: recipe.yieldQuantity.toFixed(4),
    isActive: recipe.isActive,
    notes: recipe.notes,
    costPerYieldUnitMinor: costMinor.toString(),
    grossMarginMinor: (recipe.product.sellingPriceMinor - costMinor).toString(),
    ingredients: lines
  };
}

export async function listRecipes(restaurantId: string, productId?: string) {
  const recipes = await prisma.recipe.findMany({
    where: { restaurantId, ...(productId ? { productId } : {}) },
    orderBy: [{ productId: "asc" }, { version: "desc" }],
    select: { id: true }
  });

  return Promise.all(recipes.map((recipe) => serializeRecipe(recipe.id)));
}

export async function getRecipe(restaurantId: string, recipeId: string) {
  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, restaurantId },
    select: { id: true }
  });
  if (!recipe) throw new NotFoundError("The recipe was not found");
  return serializeRecipe(recipe.id);
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
  const recipeId = await prisma.$transaction(async (transaction) => {
    const product = await transaction.product.findFirst({
      where: { id: input.productId, restaurantId },
      select: { id: true }
    });
    if (!product) throw new NotFoundError("The product was not found");
    if (decimal(input.yieldQuantity).lte(0)) {
      throw new BadRequestError("Yield quantity must be greater than zero");
    }
    await validateIngredients(transaction, restaurantId, input.ingredients);

    const latest = await transaction.recipe.aggregate({
      where: { productId: input.productId },
      _max: { version: true }
    });

    await transaction.recipe.updateMany({
      where: { productId: input.productId, isActive: true },
      data: { isActive: false }
    });

    const recipe = await transaction.recipe.create({
      data: {
        restaurantId,
        productId: input.productId,
        version: (latest._max.version ?? 0) + 1,
        yieldQuantity: decimal(input.yieldQuantity),
        notes: input.notes,
        createdByUserId: actorUserId,
        ingredients: {
          create: input.ingredients.map((ingredient) => ({
            inventoryItemId: ingredient.inventoryItemId,
            quantity: decimal(ingredient.quantity),
            unit: ingredient.unit
          }))
        }
      },
      select: { id: true }
    });

    await transaction.product.update({
      where: { id: input.productId },
      data: { isRecipeBased: true }
    });

    await recordAudit(transaction, {
      restaurantId,
      actorUserId,
      action: "RECIPE_CREATED",
      entityType: "Recipe",
      entityId: recipe.id,
      after: { productId: input.productId, version: recipe.id },
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
  await prisma.$transaction(async (transaction) => {
    const recipe = await transaction.recipe.findFirst({
      where: { id: recipeId, restaurantId },
      select: { id: true, productId: true, isActive: true }
    });
    if (!recipe) throw new NotFoundError("The recipe was not found");

    if (input.yieldQuantity !== undefined && decimal(input.yieldQuantity).lte(0)) {
      throw new BadRequestError("Yield quantity must be greater than zero");
    }
    if (input.ingredients) {
      await validateIngredients(transaction, restaurantId, input.ingredients);
    }

    if (input.isActive) {
      await transaction.recipe.updateMany({
        where: { productId: recipe.productId, id: { not: recipeId } },
        data: { isActive: false }
      });
    }

    await transaction.recipe.update({
      where: { id: recipeId },
      data: {
        yieldQuantity:
          input.yieldQuantity === undefined ? undefined : decimal(input.yieldQuantity),
        notes: input.notes,
        isActive: input.isActive,
        ...(input.ingredients
          ? {
              ingredients: {
                deleteMany: {},
                create: input.ingredients.map((ingredient) => ({
                  inventoryItemId: ingredient.inventoryItemId,
                  quantity: decimal(ingredient.quantity),
                  unit: ingredient.unit
                }))
              }
            }
          : {})
      }
    });

    await recordAudit(transaction, {
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
  const product = await prisma.product.findFirst({
    where: { id: productId, restaurantId },
    select: { id: true }
  });
  if (!product) throw new NotFoundError("The product was not found");

  const cost = await prisma.$transaction((transaction) =>
    getActiveRecipeCost(transaction, restaurantId, productId)
  );

  if (!cost) throw new NotFoundError("This product has no active recipe");
  return cost;
}
