import { z } from "zod";
import { createSaleSchema, paginationSchema } from "@rbm/shared";

export const saleSchema = createSaleSchema;
export const voidSaleSchema = z.object({
  reason: z.string().trim().min(3).max(255)
});

export const listSalesQuerySchema = paginationSchema.extend({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["COMPLETED", "VOIDED"]).optional(),
  source: z.enum(["ITEMIZED", "MANUAL"]).optional()
});
