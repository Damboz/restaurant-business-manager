export const PERMISSIONS = [
  { key: "dashboard.view", module: "dashboard" },

  { key: "sales.view", module: "sales" },
  { key: "sales.create", module: "sales" },
  { key: "sales.edit", module: "sales" },
  { key: "sales.void", module: "sales" },
  { key: "sales.manual", module: "sales" },

  { key: "products.view", module: "products" },
  { key: "products.manage", module: "products" },

  { key: "stock.view", module: "stock" },
  { key: "stock.manage", module: "stock" },
  { key: "stock.purchase", module: "stock" },
  { key: "stock.adjust", module: "stock" },

  { key: "expenses.view", module: "expenses" },
  { key: "expenses.create", module: "expenses" },
  { key: "expenses.manage", module: "expenses" },
  { key: "expenses.void", module: "expenses" },

  { key: "suppliers.view", module: "suppliers" },
  { key: "suppliers.manage", module: "suppliers" },

  { key: "customers.view", module: "customers" },
  { key: "customers.manage", module: "customers" },

  { key: "employees.view", module: "employees" },
  { key: "employees.manage", module: "employees" },

  { key: "reports.view", module: "reports" },
  { key: "reports.export", module: "reports" },

  { key: "closings.view", module: "closings" },
  { key: "closings.close", module: "closings" },
  { key: "closings.reopen", module: "closings" },

  { key: "settings.view", module: "settings" },
  { key: "settings.manage", module: "settings" },

  { key: "audit.view", module: "audit" },

  { key: "finance.view", module: "finance" },
  { key: "finance.manage", module: "finance" },

  { key: "notifications.view", module: "notifications" },
  { key: "notifications.manage", module: "notifications" },

  { key: "sync.run", module: "sync" },
  { key: "sync.resolve", module: "sync" }
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ROLE_KEYS = [
  "OWNER",
  "MANAGER",
  "ACCOUNTANT",
  "CASHIER",
  "STOREKEEPER",
  "VIEWER"
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export function hasPermission(
  granted: readonly string[],
  required: PermissionKey
): boolean {
  return granted.includes(required);
}
