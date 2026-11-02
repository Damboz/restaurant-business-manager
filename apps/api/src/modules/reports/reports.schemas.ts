import { z } from "zod";
import { dateOnlySchema } from "@rbm/shared";

export const summaryQuerySchema = z.object({
  startDate: dateOnlySchema,
  endDate: dateOnlySchema
});

export const exportQuerySchema = z.object({
  type: z.enum(["sales", "expenses", "inventory"]),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema
});
