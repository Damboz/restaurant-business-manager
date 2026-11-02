import { z } from "zod";
import { paginationSchema } from "@rbm/shared";

const baseContact = {
  name: z.string().trim().min(1).max(150),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(254).optional(),
  notes: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true)
};

export const createSupplierSchema = z.object({
  ...baseContact,
  address: z.string().trim().max(255).optional()
});

export const updateSupplierSchema = createSupplierSchema
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field is required"
  });

export const createCustomerSchema = z.object(baseContact);

export const updateCustomerSchema = createCustomerSchema
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field is required"
  });

export const listContactsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(150).optional(),
  activeOnly: z.coerce.boolean().default(false)
});
