export const LANGUAGE_VALUES = ["EN", "NY"] as const;
export type LanguageValue = (typeof LANGUAGE_VALUES)[number];

export const PAYMENT_METHOD_KEYS = [
  "CASH",
  "AIRTEL_MONEY",
  "TNM_MPAMBA",
  "BANK_TRANSFER",
  "OTHER"
] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

export const SALE_STATUSES = ["COMPLETED", "VOIDED"] as const;
export type SaleStatusValue = (typeof SALE_STATUSES)[number];

export const SALE_SOURCES = ["ITEMIZED", "MANUAL"] as const;
export type SaleSourceValue = (typeof SALE_SOURCES)[number];

export const EXPENSE_STATUSES = ["ACTIVE", "VOIDED"] as const;
export type ExpenseStatusValue = (typeof EXPENSE_STATUSES)[number];

export const STOCK_MOVEMENT_TYPES = [
  "OPENING",
  "PURCHASE",
  "CONSUMPTION",
  "ADJUSTMENT",
  "WASTAGE",
  "RETURN"
] as const;
export type StockMovementTypeValue = (typeof STOCK_MOVEMENT_TYPES)[number];

export const OWNER_TRANSACTION_TYPES = ["WITHDRAWAL", "CONTRIBUTION"] as const;
export type OwnerTransactionTypeValue = (typeof OWNER_TRANSACTION_TYPES)[number];

export const CLOSING_STATUSES = ["OPEN", "CLOSED"] as const;
export type ClosingStatusValue = (typeof CLOSING_STATUSES)[number];
