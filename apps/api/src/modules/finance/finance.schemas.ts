import { z } from "zod";
import {
  dateOnlySchema,
  minorUnitsSchema,
  ownerTransactionSchema,
  paginationSchema
} from "@rbm/shared";

export const createOwnerTransactionSchema = ownerTransactionSchema;
export const voidOwnerTransactionSchema = z.object({
  reason: z.string().trim().min(3).max(255)
});
export const listOwnerTransactionsQuerySchema = paginationSchema.extend({
  type: z.enum(["WITHDRAWAL", "CONTRIBUTION"]).optional(),
  status: z.enum(["ACTIVE", "VOIDED"]).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});
export const openingBalanceSchema = z.object({
  asOfDate: dateOnlySchema,
  cashMinor: minorUnitsSchema.default(0n),
  bankMinor: minorUnitsSchema.default(0n),
  inventoryValueMinor: minorUnitsSchema.default(0n),
  notes: z.string().trim().max(255).optional()
});
