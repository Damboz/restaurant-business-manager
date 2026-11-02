import { z } from "zod";
import { quantitySchema, uuidSchema } from "@rbm/shared";

export const recipeIngredientSchema = z.object({
  inventoryItemId: uuidSchema,
  quantity: quantitySchema,
  unit: z.string().trim().min(1).max(20)
});

export const createRecipeSchema = z.object({
  productId: uuidSchema,
  yieldQuantity: quantitySchema.default("1"),
  notes: z.string().trim().max(500).optional(),
  ingredients: z.array(recipeIngredientSchema).min(1).max(100)
});

export const updateRecipeSchema = z.object({
  yieldQuantity: quantitySchema.optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  ingredients: z.array(recipeIngredientSchema).min(1).max(100).optional(),
  isActive: z.boolean().optional()
});
