import { api } from "./client";

type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

function queryString(params: Record<string, string | number | boolean | undefined>) {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== ""
  );
  return entries.length
    ? `?${entries
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join("&")}`
    : "";
}

export type ProductCategory = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  sellingPriceMinor: string;
  currency: string;
  status: "ACTIVE" | "INACTIVE";
  isRecipeBased: boolean;
  activeRecipe: { id: string; version: number; yieldQuantity: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryCategory = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type InventoryItem = {
  id: string;
  name: string;
  unit: string;
  categoryId: string;
  categoryName: string;
  currentQuantity: string;
  minimumLevel: string;
  averageCostMinorPerUnit: string;
  stockValueMinor: string;
  lowStock: boolean;
  isActive: boolean;
  defaultSupplier: { id: string; name: string } | null;
  lastRestockedAt: string | null;
  updatedAt: string;
};

export type StockMovement = {
  id: string;
  type: string;
  itemName: string;
  unit: string;
  quantityDelta: string;
  quantityAfter: string;
  unitCostMinor: string;
  valueMinor: string;
  reason: string | null;
  referenceType: string;
  referenceId: string | null;
  businessDate: string;
  occurredAt: string;
  recordedBy: string;
};

export type StockPurchase = {
  id: string;
  purchaseNumber: string;
  status: "RECEIVED" | "VOIDED";
  supplierName: string | null;
  paymentMethodName: string;
  totalMinor: string;
  itemCount?: number;
  recordedBy: string;
  occurredAt: string;
  businessDate: string;
  notes: string | null;
  items?: Array<{
    id: string;
    inventoryItemId: string;
    name: string;
    quantity: string;
    unit: string;
    unitPriceMinor: string;
    lineTotalMinor: string;
  }>;
};

export type Recipe = {
  id: string;
  productId: string;
  productName: string;
  sellingPriceMinor: string;
  version: number;
  yieldQuantity: string;
  isActive: boolean;
  notes: string | null;
  costPerYieldUnitMinor: string;
  grossMarginMinor: string;
  ingredients: Array<{
    id: string;
    inventoryItemId: string;
    name: string;
    quantity: string;
    unit: string;
    averageCostMinorPerUnit: string;
    costMinor: string;
    quantityPerYieldUnit: string;
  }>;
};

export type Sale = {
  id: string;
  transactionNumber: string;
  source: "ITEMIZED" | "MANUAL";
  status: "COMPLETED" | "VOIDED";
  occurredAt: string;
  businessDate: string;
  currency: string;
  subtotalMinor: string;
  totalMinor: string;
  notes: string | null;
  customer: { id: string; name: string } | null;
  recordedBy: { id: string; fullName: string };
  voidedAt: string | null;
  voidReason: string | null;
  items: Array<{
    id: string;
    productId: string | null;
    productName: string;
    quantity: string;
    unitPriceMinor: string;
    lineTotalMinor: string;
    costOfGoodsMinor: string | null;
    notes: string | null;
  }>;
  payments: Array<{
    id: string;
    paymentMethodId: string;
    paymentMethodKey: string;
    paymentMethodName: string;
    amountMinor: string;
  }>;
};

export type Expense = {
  id: string;
  expenseNumber: string;
  status: "ACTIVE" | "VOIDED";
  occurredAt: string;
  businessDate: string;
  currency: string;
  totalMinor: string;
  notes: string | null;
  supplier: { id: string; name: string } | null;
  paymentMethod: { id: string; key: string; name: string };
  recordedBy: { id: string; fullName: string };
  voidedAt: string | null;
  voidReason: string | null;
  items: Array<{
    id: string;
    categoryId: string;
    categoryName: string;
    categoryKey: string | null;
    description: string;
    quantity: string;
    unit: string;
    unitPriceMinor: string;
    lineTotalMinor: string;
  }>;
};

export type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
};

export type ReportSummary = {
  startDate: string;
  endDate: string;
  sales: {
    totalMinor: string;
    transactionCount: number;
    averageTransactionMinor: string;
    byPayment: {
      cashMinor: string;
      mobileMoneyMinor: string;
      bankMinor: string;
      otherMinor: string;
    };
  };
  expenses: {
    totalMinor: string;
    operatingMinor: string;
    recordCount: number;
    byCategory: Array<{
      categoryId: string;
      categoryName: string;
      totalMinor: string;
    }>;
  };
  cogsMinor: string;
  grossProfitMinor: string;
  netProfitMinor: string;
  topProducts: Array<{
    name: string;
    revenueMinor: string;
    quantity: string;
    saleCount: number;
  }>;
  ownerTransactions: {
    withdrawalsMinor: string;
    contributionsMinor: string;
  };
  inventory: {
    valueMinor: string;
    lowStockCount: number;
    lowStockItems: Array<{
      id: string;
      name: string;
      unit: string;
      currentQuantity: string;
      minimumLevel: string;
    }>;
  };
  daily: Array<{
    date: string;
    salesMinor: string;
    expensesMinor: string;
    transactions: number;
  }>;
};

export type DashboardData = {
  today: string;
  currency: string;
  closing: { status: "OPEN" | "CLOSED"; closedAt: string | null };
  todaySummary: ReportSummary;
  monthSummary: {
    startDate: string;
    endDate: string;
    salesMinor: string;
    expensesMinor: string;
    netProfitMinor: string;
    transactionCount: number;
  };
};

export type Closing = {
  id: string;
  businessDate: string;
  status: "OPEN" | "CLOSED";
  cashSalesMinor: string;
  mobileMoneySalesMinor: string;
  bankSalesMinor: string;
  otherSalesMinor: string;
  manualSalesMinor: string;
  totalSalesMinor: string;
  cogsMinor: string;
  grossProfitMinor: string;
  operatingExpensesMinor: string;
  netProfitMinor: string;
  transactionCount: number;
  closedAt: string;
  reopenedAt: string | null;
  reopenReason: string | null;
};

export type ClosingPreview = {
  businessDate: string;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  summary: ReportSummary;
};

export type NotificationItem = {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  titleKey: string;
  bodyKey: string;
  params: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

export type SettingsData = {
  restaurant: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    addressLine: string | null;
    city: string | null;
    country: string;
    currency: string;
    timezone: string;
    logoUrl: string | null;
    openingDate: string | null;
    operatingHours: Record<string, unknown> | null;
    status: string;
  };
  paymentMethods: Array<{
    id: string;
    key: string;
    name: string;
    isActive: boolean;
    restaurantId: string | null;
  }>;
  expenseCategories: Array<{
    id: string;
    key: string | null;
    name: string;
    isOperating: boolean;
    isSystem: boolean;
  }>;
};

export type OwnerTransaction = {
  id: string;
  type: "WITHDRAWAL" | "CONTRIBUTION";
  status: "ACTIVE" | "VOIDED";
  amountMinor: string;
  occurredAt: string;
  businessDate: string;
  currency: string;
  description: string;
  recordedBy: string;
  voidedAt: string | null;
  voidReason: string | null;
};

const base = (restaurantId: string, path: string) =>
  `/restaurants/${restaurantId}${path}`;

export async function listProductCategories(restaurantId: string) {
  const result = await api.get<{ categories: ProductCategory[] }>(
    base(restaurantId, "/product-categories"),
    { restaurantId }
  );
  return result.categories;
}

export async function createProductCategory(
  restaurantId: string,
  input: { name: string; sortOrder?: number }
) {
  const result = await api.post<{ category: ProductCategory }>(
    base(restaurantId, "/product-categories"),
    input,
    { restaurantId }
  );
  return result.category;
}

export async function listProducts(
  restaurantId: string,
  params: { search?: string; categoryId?: string; status?: string } = {}
) {
  return api.get<Page<Product>>(base(restaurantId, `/products${queryString(params)}`), {
    restaurantId
  });
}

export async function getProduct(restaurantId: string, productId: string) {
  const result = await api.get<{ product: Product }>(
    base(restaurantId, `/products/${productId}`),
    { restaurantId }
  );
  return result.product;
}

export async function createProduct(
  restaurantId: string,
  input: {
    categoryId: string;
    name: string;
    description?: string;
    sellingPriceMinor: string;
    isRecipeBased?: boolean;
  }
) {
  const result = await api.post<{ product: Product }>(
    base(restaurantId, "/products"),
    input,
    { restaurantId }
  );
  return result.product;
}

export async function updateProduct(
  restaurantId: string,
  productId: string,
  input: Partial<{
    categoryId: string;
    name: string;
    description: string | null;
    sellingPriceMinor: string;
    status: "ACTIVE" | "INACTIVE";
    isRecipeBased: boolean;
  }>
) {
  const result = await api.patch<{ product: Product }>(
    base(restaurantId, `/products/${productId}`),
    input,
    { restaurantId }
  );
  return result.product;
}

export async function listInventoryCategories(restaurantId: string) {
  const result = await api.get<{ categories: InventoryCategory[] }>(
    base(restaurantId, "/inventory-categories"),
    { restaurantId }
  );
  return result.categories;
}

export async function createInventoryCategory(
  restaurantId: string,
  input: { name: string; sortOrder?: number }
) {
  const result = await api.post<{ category: InventoryCategory }>(
    base(restaurantId, "/inventory-categories"),
    input,
    { restaurantId }
  );
  return result.category;
}

export async function listInventoryItems(
  restaurantId: string,
  params: { search?: string; lowStock?: boolean; categoryId?: string } = {}
) {
  return api.get<Page<InventoryItem>>(
    base(restaurantId, `/inventory${queryString(params)}`),
    { restaurantId }
  );
}

export async function createInventoryItem(
  restaurantId: string,
  input: {
    categoryId: string;
    name: string;
    unit: string;
    minimumLevel?: string;
    defaultSupplierId?: string;
    openingQuantity?: string;
    openingUnitCostMinor?: string;
  }
) {
  const result = await api.post<{ item: InventoryItem }>(
    base(restaurantId, "/inventory"),
    input,
    { restaurantId }
  );
  return result.item;
}

export async function updateInventoryItem(
  restaurantId: string,
  itemId: string,
  input: Partial<{
    categoryId: string;
    name: string;
    unit: string;
    minimumLevel: string;
    isActive: boolean;
  }>
) {
  const result = await api.patch<{ item: InventoryItem }>(
    base(restaurantId, `/inventory/${itemId}`),
    input,
    { restaurantId }
  );
  return result.item;
}

export async function listStockMovements(
  restaurantId: string,
  params: { inventoryItemId?: string; type?: string; startDate?: string; endDate?: string } = {}
) {
  return api.get<Page<StockMovement>>(
    base(restaurantId, `/stock-movements${queryString(params)}`),
    { restaurantId }
  );
}

export async function listStockPurchases(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {}
) {
  return api.get<Page<StockPurchase>>(
    base(restaurantId, `/stock-purchases${queryString(params)}`),
    { restaurantId }
  );
}

export async function createStockPurchase(
  restaurantId: string,
  input: {
    occurredAt: string;
    supplierId?: string;
    paymentMethodId: string;
    notes?: string;
    items: Array<{
      inventoryItemId: string;
      quantity: string;
      unit: string;
      unitPriceMinor: string;
    }>;
  }
) {
  const result = await api.post<{ purchase: StockPurchase }>(
    base(restaurantId, "/stock-purchases"),
    input,
    { restaurantId }
  );
  return result.purchase;
}

export async function createStockAdjustment(
  restaurantId: string,
  input: {
    inventoryItemId: string;
    occurredAt: string;
    type: "ADJUSTMENT" | "WASTAGE" | "RETURN";
    quantityDelta: string;
    reason: string;
  }
) {
  const result = await api.post<{ movement: StockMovement }>(
    base(restaurantId, "/stock-adjustments"),
    input,
    { restaurantId }
  );
  return result.movement;
}

export async function listRecipes(restaurantId: string, productId?: string) {
  const result = await api.get<{ recipes: Recipe[] }>(
    base(restaurantId, `/recipes${queryString({ productId })}`),
    { restaurantId }
  );
  return result.recipes;
}

export async function createRecipe(
  restaurantId: string,
  input: {
    productId: string;
    yieldQuantity: string;
    notes?: string;
    ingredients: Array<{ inventoryItemId: string; quantity: string; unit: string }>;
  }
) {
  const result = await api.post<{ recipe: Recipe }>(
    base(restaurantId, "/recipes"),
    input,
    { restaurantId }
  );
  return result.recipe;
}

export async function listSales(
  restaurantId: string,
  params: {
    startDate?: string;
    endDate?: string;
    status?: string;
    source?: string;
  } = {}
) {
  return api.get<Page<Sale>>(base(restaurantId, `/sales${queryString(params)}`), {
    restaurantId
  });
}

export async function getSale(restaurantId: string, saleId: string) {
  const result = await api.get<{ sale: Sale }>(
    base(restaurantId, `/sales/${saleId}`),
    { restaurantId }
  );
  return result.sale;
}

export async function createSale(
  restaurantId: string,
  input: {
    occurredAt: string;
    source: "ITEMIZED" | "MANUAL";
    customerId?: string;
    notes?: string;
    items: Array<{
      productId?: string;
      productName: string;
      quantity: string;
      unitPriceMinor: string;
    }>;
    payments: Array<{ paymentMethodId: string; amountMinor: string }>;
  }
) {
  const result = await api.post<{ sale: Sale }>(base(restaurantId, "/sales"), input, {
    restaurantId
  });
  return result.sale;
}

export async function voidSale(
  restaurantId: string,
  saleId: string,
  reason: string
) {
  const result = await api.post<{ sale: Sale }>(
    base(restaurantId, `/sales/${saleId}/void`),
    { reason },
    { restaurantId }
  );
  return result.sale;
}

export async function listExpenses(
  restaurantId: string,
  params: {
    startDate?: string;
    endDate?: string;
    status?: string;
    categoryId?: string;
  } = {}
) {
  return api.get<Page<Expense>>(
    base(restaurantId, `/expenses${queryString(params)}`),
    { restaurantId }
  );
}

export async function listExpenseCategories(restaurantId: string) {
  const result = await api.get<{
    categories: SettingsData["expenseCategories"];
  }>(base(restaurantId, "/expenses/categories"), { restaurantId });
  return result.categories;
}

export async function createExpense(
  restaurantId: string,
  input: {
    occurredAt: string;
    supplierId?: string;
    paymentMethodId: string;
    notes?: string;
    items: Array<{
      categoryId: string;
      description: string;
      quantity: string;
      unit: string;
      unitPriceMinor: string;
    }>;
  }
) {
  const result = await api.post<{ expense: Expense }>(
    base(restaurantId, "/expenses"),
    input,
    { restaurantId }
  );
  return result.expense;
}

export async function voidExpense(
  restaurantId: string,
  expenseId: string,
  reason: string
) {
  const result = await api.post<{ expense: Expense }>(
    base(restaurantId, `/expenses/${expenseId}/void`),
    { reason },
    { restaurantId }
  );
  return result.expense;
}

export async function listSuppliers(
  restaurantId: string,
  params: { search?: string; activeOnly?: boolean } = {}
) {
  return api.get<Page<Supplier>>(
    base(restaurantId, `/suppliers${queryString(params)}`),
    { restaurantId }
  );
}

export async function createSupplier(
  restaurantId: string,
  input: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    notes?: string;
  }
) {
  const result = await api.post<{ supplier: Supplier }>(
    base(restaurantId, "/suppliers"),
    input,
    { restaurantId }
  );
  return result.supplier;
}

export async function updateSupplier(
  restaurantId: string,
  supplierId: string,
  input: Partial<{
    name: string;
    phone: string;
    email: string;
    address: string;
    notes: string;
    isActive: boolean;
  }>
) {
  const result = await api.patch<{ supplier: Supplier }>(
    base(restaurantId, `/suppliers/${supplierId}`),
    input,
    { restaurantId }
  );
  return result.supplier;
}

export async function getDashboard(restaurantId: string) {
  return api.get<DashboardData>(base(restaurantId, "/reports/dashboard"), {
    restaurantId
  });
}

export async function getReportSummary(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {}
) {
  return api.get<ReportSummary>(
    base(restaurantId, `/reports/summary${queryString(params)}`),
    { restaurantId }
  );
}

export async function getClosingPreview(
  restaurantId: string,
  businessDate?: string
) {
  return api.get<ClosingPreview>(
    base(restaurantId, `/closings/preview${queryString({ businessDate })}`),
    { restaurantId }
  );
}

export async function listClosings(
  restaurantId: string,
  params: { startDate?: string; endDate?: string; status?: string } = {}
) {
  return api.get<Page<Closing>>(
    base(restaurantId, `/closings${queryString(params)}`),
    { restaurantId }
  );
}

export async function closeDay(restaurantId: string, businessDate: string) {
  const result = await api.post<{ closing: Closing }>(
    base(restaurantId, "/closings/close"),
    { businessDate },
    { restaurantId }
  );
  return result.closing;
}

export async function reopenDay(
  restaurantId: string,
  businessDate: string,
  reason: string
) {
  const result = await api.post<{ closing: Closing }>(
    base(restaurantId, "/closings/reopen"),
    { businessDate, reason },
    { restaurantId }
  );
  return result.closing;
}

export async function listNotifications(
  restaurantId: string,
  params: { unreadOnly?: boolean } = {}
) {
  return api.get<
    Page<NotificationItem> & { unread: number }
  >(base(restaurantId, `/notifications${queryString(params)}`), { restaurantId });
}

export async function markNotificationRead(
  restaurantId: string,
  notificationId: string
) {
  return api.post<{ id: string; readAt: string | null }>(
    base(restaurantId, `/notifications/${notificationId}/read`),
    undefined,
    { restaurantId }
  );
}

export async function markAllNotificationsRead(restaurantId: string) {
  return api.post<{ updated: number }>(
    base(restaurantId, "/notifications/read-all"),
    undefined,
    { restaurantId }
  );
}

export async function getSettings(restaurantId: string) {
  return api.get<SettingsData>(base(restaurantId, "/settings"), { restaurantId });
}

export async function updateSettings(
  restaurantId: string,
  input: Partial<{
    name: string;
    phone: string | null;
    email: string | null;
    addressLine: string | null;
    city: string | null;
    logoUrl: string | null;
    openingDate: string | null;
  }>
) {
  return api.patch<SettingsData>(base(restaurantId, "/settings"), input, {
    restaurantId
  });
}

export async function listOwnerTransactions(
  restaurantId: string,
  params: { type?: string; startDate?: string; endDate?: string } = {}
) {
  return api.get<Page<OwnerTransaction>>(
    base(restaurantId, `/finance/owner-transactions${queryString(params)}`),
    { restaurantId }
  );
}

export async function createOwnerTransaction(
  restaurantId: string,
  input: {
    type: "WITHDRAWAL" | "CONTRIBUTION";
    amountMinor: string;
    occurredAt: string;
    description: string;
  }
) {
  const result = await api.post<{ transaction: OwnerTransaction }>(
    base(restaurantId, "/finance/owner-transactions"),
    input,
    { restaurantId }
  );
  return result.transaction;
}
