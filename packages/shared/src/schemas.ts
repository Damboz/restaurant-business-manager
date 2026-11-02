import { z } from "zod";
import { PAYMENT_METHOD_KEYS, STOCK_MOVEMENT_TYPES } from "./enums.js";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .regex(/[A-Za-z]/, "Password must include at least one letter")
  .regex(/\d/, "Password must include at least one number");

export const phoneSchema = z.string().trim().min(7).max(30);
export const emailSchema = z.string().trim().email().max(254);
export const uuidSchema = z.string().uuid();

/** Money arrives as a non-negative integer string and becomes a bigint. */
export const minorUnitsSchema = z
  .string()
  .regex(/^\d+$/, "Amount must be a non-negative integer in minor units")
  .transform((value) => BigInt(value));

export const signedMinorUnitsSchema = z
  .string()
  .regex(/^-?\d+$/, "Amount must be an integer in minor units")
  .transform((value) => BigInt(value));

/** Quantities allow up to four decimal places. */
export const quantitySchema = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Quantity must be a positive number with up to 4 decimals");

export const signedQuantitySchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, "Quantity must be a signed number with up to 4 decimals");

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const dateRangeSchema = z
  .object({
    startDate: dateOnlySchema,
    endDate: dateOnlySchema
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "startDate must be on or before endDate",
    path: ["endDate"]
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH)
});

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  phone: phoneSchema,
  email: emailSchema.optional(),
  password: passwordSchema,
  restaurantName: z.string().trim().min(2).max(150),
  restaurantPhone: phoneSchema.optional(),
  restaurantAddress: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  language: z.enum(["en", "ny"]).default("en")
});

export const createProductSchema = z.object({
  categoryId: uuidSchema,
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(500).optional(),
  sellingPriceMinor: minorUnitsSchema,
  isRecipeBased: z.boolean().default(false)
});

export const saleItemSchema = z.object({
  productId: uuidSchema.optional(),
  productName: z.string().trim().min(1).max(150),
  quantity: quantitySchema,
  unitPriceMinor: minorUnitsSchema,
  notes: z.string().trim().max(255).optional()
});

export const salePaymentSchema = z.object({
  paymentMethodId: uuidSchema,
  amountMinor: minorUnitsSchema.refine((value) => value > 0n, "Payment must be greater than zero")
});

export const createSaleSchema = z
  .object({
    clientId: uuidSchema.optional(),
    occurredAt: isoDateTimeSchema,
    source: z.enum(["ITEMIZED", "MANUAL"]).default("ITEMIZED"),
    customerId: uuidSchema.optional(),
    notes: z.string().trim().max(500).optional(),
    items: z.array(saleItemSchema).max(100).default([]),
    payments: z.array(salePaymentSchema).min(1).max(10)
  })
  .refine((value) => value.source === "MANUAL" || value.items.length > 0, {
    message: "An itemized sale must contain at least one item",
    path: ["items"]
  });

export const expenseItemSchema = z.object({
  categoryId: uuidSchema,
  description: z.string().trim().min(1).max(200),
  quantity: quantitySchema,
  unit: z.string().trim().min(1).max(20),
  unitPriceMinor: minorUnitsSchema
});

export const createExpenseSchema = z.object({
  clientId: uuidSchema.optional(),
  occurredAt: isoDateTimeSchema,
  supplierId: uuidSchema.optional(),
  paymentMethodId: uuidSchema,
  notes: z.string().trim().max(500).optional(),
  items: z.array(expenseItemSchema).min(1).max(100)
});

export const stockPurchaseItemSchema = z.object({
  inventoryItemId: uuidSchema,
  quantity: quantitySchema,
  unit: z.string().trim().min(1).max(20),
  unitPriceMinor: minorUnitsSchema
});

export const createStockPurchaseSchema = z.object({
  clientId: uuidSchema.optional(),
  occurredAt: isoDateTimeSchema,
  supplierId: uuidSchema.optional(),
  paymentMethodId: uuidSchema,
  notes: z.string().trim().max(500).optional(),
  items: z.array(stockPurchaseItemSchema).min(1).max(100)
});

export const stockAdjustmentSchema = z.object({
  clientId: uuidSchema.optional(),
  inventoryItemId: uuidSchema,
  occurredAt: isoDateTimeSchema,
  type: z.enum(["ADJUSTMENT", "WASTAGE", "RETURN"]).default("ADJUSTMENT"),
  quantityDelta: signedQuantitySchema.refine((value) => value !== "0", "Quantity change is required"),
  reason: z.string().trim().min(1).max(255)
});

export const createInventoryItemSchema = z.object({
  categoryId: uuidSchema,
  name: z.string().trim().min(1).max(150),
  unit: z.string().trim().min(1).max(20),
  minimumLevel: quantitySchema.default("0"),
  defaultSupplierId: uuidSchema.optional()
});

export const ownerTransactionSchema = z.object({
  clientId: uuidSchema.optional(),
  type: z.enum(["WITHDRAWAL", "CONTRIBUTION"]),
  amountMinor: minorUnitsSchema.refine((value) => value > 0n, "Amount must be greater than zero"),
  occurredAt: isoDateTimeSchema,
  description: z.string().trim().min(1).max(255)
});

export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);
export const paymentMethodKeySchema = z.enum(PAYMENT_METHOD_KEYS);

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type CreateStockPurchaseInput = z.infer<typeof createStockPurchaseSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;
export type OwnerTransactionInput = z.infer<typeof ownerTransactionSchema>;
