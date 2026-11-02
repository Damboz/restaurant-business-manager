import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const permissions = [
  { key: "dashboard.view", module: "dashboard", description: "View the restaurant dashboard" },

  { key: "sales.view", module: "sales", description: "View sales and daily totals" },
  { key: "sales.create", module: "sales", description: "Record itemized or manual daily sales" },
  { key: "sales.edit", module: "sales", description: "Correct a recorded sale" },
  { key: "sales.void", module: "sales", description: "Void a sale with an audit trail" },
  { key: "sales.manual", module: "sales", description: "Record a manual daily sales total" },

  { key: "products.view", module: "products", description: "View menu products and prices" },
  { key: "products.manage", module: "products", description: "Create and edit products" },

  { key: "stock.view", module: "stock", description: "View stock levels and movements" },
  { key: "stock.manage", module: "stock", description: "Create inventory items and record consumption" },
  { key: "stock.purchase", module: "stock", description: "Record stock purchases" },
  { key: "stock.adjust", module: "stock", description: "Record stock adjustments, wastage, and returns" },

  { key: "expenses.view", module: "expenses", description: "View operating expenses" },
  { key: "expenses.create", module: "expenses", description: "Record operating expenses" },
  { key: "expenses.manage", module: "expenses", description: "Edit operating expenses" },
  { key: "expenses.void", module: "expenses", description: "Void operating expenses with an audit trail" },

  { key: "suppliers.view", module: "suppliers", description: "View suppliers" },
  { key: "suppliers.manage", module: "suppliers", description: "Create and edit suppliers" },

  { key: "customers.view", module: "customers", description: "View customers" },
  { key: "customers.manage", module: "customers", description: "Create and edit customers" },

  { key: "employees.view", module: "employees", description: "View employees and roles" },
  { key: "employees.manage", module: "employees", description: "Invite, edit, suspend, and remove employees" },

  { key: "reports.view", module: "reports", description: "View financial and operational reports" },
  { key: "reports.export", module: "reports", description: "Export reports as PDF or Excel" },

  { key: "closings.view", module: "closings", description: "View daily closing summaries" },
  { key: "closings.close", module: "closings", description: "Confirm and lock a business day" },
  { key: "closings.reopen", module: "closings", description: "Reopen a closed business day" },

  { key: "settings.view", module: "settings", description: "View restaurant settings" },
  { key: "settings.manage", module: "settings", description: "Change restaurant settings" },

  { key: "audit.view", module: "audit", description: "View the audit log" },

  { key: "finance.view", module: "finance", description: "View opening balances and owner transactions" },
  { key: "finance.manage", module: "finance", description: "Record owner withdrawals, contributions, and opening balances" },

  { key: "notifications.view", module: "notifications", description: "View notifications" },
  { key: "notifications.manage", module: "notifications", description: "Configure notification preferences" },

  { key: "sync.run", module: "sync", description: "Run and retry synchronization" },
  { key: "sync.resolve", module: "sync", description: "Resolve synchronization conflicts" }
] as const;

type PermissionKey = (typeof permissions)[number]["key"];

const rolePermissionMap: Record<
  string,
  { name: string; description: string; permissions: readonly PermissionKey[] }
> = {
  OWNER: {
    name: "Owner",
    description: "Full access to every restaurant function",
    permissions: permissions.map((permission) => permission.key)
  },
  MANAGER: {
    name: "Manager",
    description: "Runs day-to-day operations and staff",
    permissions: [
      "dashboard.view",
      "sales.view",
      "sales.create",
      "sales.edit",
      "sales.void",
      "sales.manual",
      "products.view",
      "products.manage",
      "stock.view",
      "stock.manage",
      "stock.purchase",
      "stock.adjust",
      "expenses.view",
      "expenses.create",
      "expenses.manage",
      "expenses.void",
      "suppliers.view",
      "suppliers.manage",
      "customers.view",
      "customers.manage",
      "employees.view",
      "employees.manage",
      "reports.view",
      "reports.export",
      "closings.view",
      "closings.close",
      "closings.reopen",
      "settings.view",
      "audit.view",
      "finance.view",
      "notifications.view",
      "notifications.manage",
      "sync.run",
      "sync.resolve"
    ]
  },
  ACCOUNTANT: {
    name: "Accountant",
    description: "Maintains expenses, suppliers, and reports",
    permissions: [
      "dashboard.view",
      "sales.view",
      "expenses.view",
      "expenses.create",
      "expenses.manage",
      "expenses.void",
      "suppliers.view",
      "suppliers.manage",
      "stock.view",
      "reports.view",
      "reports.export",
      "closings.view",
      "audit.view",
      "finance.view",
      "notifications.view"
    ]
  },
  CASHIER: {
    name: "Cashier",
    description: "Records sales and serves customers",
    permissions: [
      "dashboard.view",
      "sales.view",
      "sales.create",
      "sales.manual",
      "products.view",
      "customers.view",
      "customers.manage",
      "notifications.view"
    ]
  },
  STOREKEEPER: {
    name: "Storekeeper",
    description: "Manages products, stock, and suppliers",
    permissions: [
      "dashboard.view",
      "products.view",
      "products.manage",
      "stock.view",
      "stock.manage",
      "stock.purchase",
      "stock.adjust",
      "suppliers.view",
      "suppliers.manage",
      "notifications.view"
    ]
  },
  VIEWER: {
    name: "Viewer",
    description: "Read-only access to business records",
    permissions: [
      "dashboard.view",
      "sales.view",
      "products.view",
      "stock.view",
      "expenses.view",
      "suppliers.view",
      "customers.view",
      "reports.view",
      "closings.view",
      "finance.view"
    ]
  }
};

const paymentMethods = [
  { key: "CASH", name: "Cash", sortOrder: 1 },
  { key: "AIRTEL_MONEY", name: "Airtel Money", sortOrder: 2 },
  { key: "TNM_MPAMBA", name: "TNM Mpamba", sortOrder: 3 },
  { key: "BANK_TRANSFER", name: "Bank transfer", sortOrder: 4 },
  { key: "OTHER", name: "Other", sortOrder: 5 }
] as const;

const expenseCategories = [
  { key: "FOOD_INGREDIENTS", name: "Food ingredients", sortOrder: 1 },
  { key: "COOKING_MATERIALS", name: "Cooking materials", sortOrder: 2 },
  { key: "FUEL_ENERGY", name: "Fuel and energy", sortOrder: 3 },
  { key: "SALARIES", name: "Salaries and wages", sortOrder: 4 },
  { key: "RENT", name: "Rent", sortOrder: 5 },
  { key: "WATER_ELECTRICITY", name: "Water and electricity", sortOrder: 6 },
  { key: "TRANSPORT", name: "Transport", sortOrder: 7 },
  { key: "MAINTENANCE", name: "Maintenance", sortOrder: 8 },
  { key: "CLEANING", name: "Cleaning materials", sortOrder: 9 },
  { key: "OTHER", name: "Other expenses", sortOrder: 10 }
] as const;

async function seedPermissions(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const permission of permissions) {
    const record = await prisma.permission.upsert({
      where: { key: permission.key },
      update: {
        module: permission.module,
        description: permission.description
      },
      create: permission
    });

    ids.set(record.key, record.id);
  }

  return ids;
}

async function seedRoles(permissionIds: Map<string, string>): Promise<void> {
  for (const [key, definition] of Object.entries(rolePermissionMap)) {
    const role = await prisma.role.upsert({
      where: { key },
      update: {
        name: definition.name,
        description: definition.description,
        isSystem: true
      },
      create: {
        key,
        name: definition.name,
        description: definition.description,
        isSystem: true
      }
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    await prisma.rolePermission.createMany({
      data: definition.permissions.map((permissionKey) => {
        const permissionId = permissionIds.get(permissionKey);

        if (!permissionId) {
          throw new Error(`Missing permission seed: ${permissionKey}`);
        }

        return { roleId: role.id, permissionId };
      })
    });
  }
}

async function seedPaymentMethods(): Promise<void> {
  for (const method of paymentMethods) {
    const existing = await prisma.paymentMethod.findFirst({
      where: { restaurantId: null, key: method.key }
    });

    if (existing) {
      await prisma.paymentMethod.update({
        where: { id: existing.id },
        data: { name: method.name, sortOrder: method.sortOrder, isActive: true }
      });
    } else {
      await prisma.paymentMethod.create({
        data: { ...method, isActive: true }
      });
    }
  }
}

async function seedExpenseCategories(): Promise<void> {
  for (const category of expenseCategories) {
    const existing = await prisma.expenseCategory.findFirst({
      where: { restaurantId: null, key: category.key }
    });

    if (existing) {
      await prisma.expenseCategory.update({
        where: { id: existing.id },
        data: {
          name: category.name,
          sortOrder: category.sortOrder,
          isOperating: true,
          isSystem: true,
          isActive: true
        }
      });
    } else {
      await prisma.expenseCategory.create({
        data: {
          ...category,
          isOperating: true,
          isSystem: true,
          isActive: true
        }
      });
    }
  }
}

async function main(): Promise<void> {
  const permissionIds = await seedPermissions();
  await seedRoles(permissionIds);
  await seedPaymentMethods();
  await seedExpenseCategories();

  console.log(
    `Seeded ${permissions.length} permissions, ${Object.keys(rolePermissionMap).length} roles, ` +
      `${paymentMethods.length} payment methods, and ${expenseCategories.length} expense categories.`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
