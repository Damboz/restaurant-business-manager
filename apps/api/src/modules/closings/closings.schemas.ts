import { z } from "zod";
import { dateOnlySchema, paginationSchema } from "@rbm/shared";

export const businessDateQuerySchema = z.object({
  businessDate: dateOnlySchema.optional()
});

export const closeDaySchema = z.object({
  businessDate: dateOnlySchema
});

export const reopenDaySchema = z.object({
  businessDate: dateOnlySchema,
  reason: z.string().trim().min(3).max(255)
});

export const listClosingsQuerySchema = paginationSchema.extend({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["OPEN", "CLOSED"]).optional()
});
