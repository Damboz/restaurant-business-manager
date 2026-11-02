import { z } from "zod";
import { dateOnlySchema } from "@rbm/shared";

export const updateSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    addressLine: z.string().trim().max(255).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    logoUrl: z.string().trim().url().max(500).nullable().optional(),
    openingDate: dateOnlySchema.nullable().optional(),
    operatingHours: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field is required"
  });
