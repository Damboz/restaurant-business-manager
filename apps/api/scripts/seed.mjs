import "dotenv/config";
import dns from "node:dns";
import net from "node:net";
import pg from "pg";

const { Pool } = pg;

dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

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
];

const rolePermissionMap = {
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
      "sales.view", "sales.create", "sales.edit", "sales.void", "sales.manual",
      "products.view", "products.manage",
      "stock.view", "stock.manage", "stock.purchase", "stock.adjust",
      "expenses.view", "expenses.create", "expenses.manage", "expenses.void",
      "suppliers.view", "suppliers.manage",
      "customers.view", "customers.manage",
      "employees.view", "employees.manage",
      "reports.view", "reports.export",
      "closings.view", "closings.close", "closings.reopen",
      "settings.view", "audit.view", "finance.view",
      "notifications.view", "notifications.manage",
      "sync.run", "sync.resolve"
    ]
  },
  ACCOUNTANT: {
    name: "Accountant",
    description: "Maintains expenses, suppliers, and reports",
    permissions: [
      "dashboard.view", "sales.view",
      "expenses.view", "expenses.create", "expenses.manage", "expenses.void",
      "suppliers.view", "suppliers.manage",
      "stock.view", "reports.view", "reports.export",
      "closings.view", "audit.view", "finance.view", "notifications.view"
    ]
  },
  CASHIER: {
    name: "Cashier",
    description: "Records sales and serves customers",
    permissions: [
      "dashboard.view", "sales.view", "sales.create", "sales.manual",
      "products.view", "customers.view", "customers.manage", "notifications.view"
    ]
  },
  STOREKEEPER: {
    name: "Storekeeper",
    description: "Manages products, stock, and suppliers",
    permissions: [
      "dashboard.view", "products.view", "products.manage",
      "stock.view", "stock.manage", "stock.purchase", "stock.adjust",
      "suppliers.view", "suppliers.manage", "notifications.view"
    ]
  },
  VIEWER: {
    name: "Viewer",
    description: "Read-only access to business records",
    permissions: [
      "dashboard.view", "sales.view", "products.view", "stock.view",
      "expenses.view", "suppliers.view", "customers.view",
      "reports.view", "closings.view", "finance.view"
    ]
  }
};

const paymentMethods = [
  { key: "CASH", name: "Cash", sortOrder: 1 },
  { key: "AIRTEL_MONEY", name: "Airtel Money", sortOrder: 2 },
  { key: "TNM_MPAMBA", name: "TNM Mpamba", sortOrder: 3 },
  { key: "BANK_TRANSFER", name: "Bank transfer", sortOrder: 4 },
  { key: "OTHER", name: "Other", sortOrder: 5 }
];

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
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

const client = await pool.connect();

try {
  await client.query("BEGIN");

  const permissionIds = new Map();

  for (const permission of permissions) {
    const { rows } = await client.query(
      `INSERT INTO permissions (id, key, module, description, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET module = EXCLUDED.module,
             description = EXCLUDED.description
       RETURNING id`,
      [permission.key, permission.module, permission.description]
    );
    permissionIds.set(permission.key, rows[0].id);
  }

  for (const [key, definition] of Object.entries(rolePermissionMap)) {
    const { rows } = await client.query(
      `INSERT INTO roles (id, key, name, description, is_system, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, true, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             is_system = true,
             updated_at = NOW()
       RETURNING id`,
      [key, definition.name, definition.description]
    );
    const roleId = rows[0].id;

    await client.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);

    for (const permissionKey of definition.permissions) {
      const permissionId = permissionIds.get(permissionKey);
      if (!permissionId) {
        throw new Error(`Missing permission seed: ${permissionKey}`);
      }

      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)`,
        [roleId, permissionId]
      );
    }
  }

  for (const method of paymentMethods) {
    const updated = await client.query(
      `UPDATE payment_methods
       SET name = $1, sort_order = $2, is_active = true
       WHERE restaurant_id IS NULL AND key = $3`,
      [method.name, method.sortOrder, method.key]
    );

    if (updated.rowCount === 0) {
      await client.query(
        `INSERT INTO payment_methods
           (id, restaurant_id, key, name, sort_order, is_active, created_at)
         VALUES (gen_random_uuid(), NULL, $1, $2, $3, true, NOW())`,
        [method.key, method.name, method.sortOrder]
      );
    }
  }

  for (const category of expenseCategories) {
    const updated = await client.query(
      `UPDATE expense_categories
       SET name = $1, sort_order = $2, is_operating = true,
           is_system = true, is_active = true
       WHERE restaurant_id IS NULL AND key = $3`,
      [category.name, category.sortOrder, category.key]
    );

    if (updated.rowCount === 0) {
      await client.query(
        `INSERT INTO expense_categories
           (id, restaurant_id, key, name, is_operating, is_system,
            sort_order, is_active, created_at)
         VALUES (gen_random_uuid(), NULL, $1, $2, true, true, $3, true, NOW())`,
        [category.key, category.name, category.sortOrder]
      );
    }
  }

  await client.query("COMMIT");

  console.log(
    `Seeded ${permissions.length} permissions, ${
      Object.keys(rolePermissionMap).length
    } roles, ${paymentMethods.length} payment methods, and ${
      expenseCategories.length
    } expense categories.`
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
