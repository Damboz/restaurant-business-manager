import { z } from "zod";
import {
  createInventoryItemSchema,
  createStockPurchaseSchema,
  paginationSchema,
  quantitySchema,
  stockAdjustmentSchema,
  uuidSchema
} from "@rbm/shared";

export const inventoryCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true)
});

export const updateInventoryCategorySchema = inventoryCategorySchema
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field is required"
  });

export const inventoryItemSchema = createInventoryItemSchema.extend({
  openingQuantity: quantitySchema.optional(),
  openingUnitCostMinor: z
    .string()
    .regex(/^\d+$/)
    .transform((value) => BigInt(value))
    .optional()
});

export const updateInventoryItemSchema = z
  .object({
    categoryId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(150).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    minimumLevel: quantitySchema.optional(),
    defaultSupplierId: uuidSchema.nullable().optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field is required"
  });

export const listInventoryQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(150).optional(),
  categoryId: uuidSchema.optional(),
  lowStock: z.coerce.boolean().default(false),
  activeOnly: z.coerce.boolean().default(true)
});

export const stockPurchaseSchema = createStockPurchaseSchema.superRefine(
  (value, context) => {
    const ids = value.items.map((item) => item.inventoryItemId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each inventory item may only appear once"
      });
    }
  }
);

export const listMovementsQuerySchema = paginationSchema.extend({
  inventoryItemId: uuidSchema.optional(),
  type: z
    .enum(["OPENING", "PURCHASE", "CONSUMPTION", "ADJUSTMENT", "WASTAGE", "RETURN"])
    .optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

export { stockAdjustmentSchema };
