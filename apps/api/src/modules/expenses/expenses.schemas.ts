import { z } from "zod";
import { createExpenseSchema, paginationSchema } from "@rbm/shared";

export const expenseSchema = createExpenseSchema;
export const voidExpenseSchema = z.object({
  reason: z.string().trim().min(3).max(255)
});
export const listExpensesQuerySchema = paginationSchema.extend({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["ACTIVE", "VOIDED"]).optional(),
  categoryId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional()
});
