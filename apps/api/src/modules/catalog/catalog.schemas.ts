import { z } from "zod";
import {
  createProductSchema,
  minorUnitsSchema,
  paginationSchema,
  uuidSchema
} from "@rbm/shared";

export const productCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true)
});

export const updateProductCategorySchema = productCategorySchema
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field is required"
  });

export const productSchema = createProductSchema.extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
});

export const updateProductSchema = z
  .object({
    categoryId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    sellingPriceMinor: minorUnitsSchema.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    isRecipeBased: z.boolean().optional()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field is required"
  });

export const listProductsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(150).optional(),
  categoryId: uuidSchema.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional()
});
