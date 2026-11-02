import { pool, query, transaction } from "../../lib/db.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { toBigInt, decimal as decDecimal, roundTo } from "../../lib/decimal.js";
import { nextDocumentNumber } from "../../lib/sequence.js";
import { lineTotalMinor } from "@rbm/shared";

type AuditMeta = { ip?: string; userAgent?: string };

// SQL Queries (parameterized to prevent SQL injection)
const EXPENSES_BY_RESTAURANT = `
  SELECT e.*, c.name as category_name, c.key as category_key,
         sm.name as supplier_name, pm.name as payment_method_name
  FROM expenses e
  LEFT JOIN expense_categories c ON e.expense_category_id = c.id
  LEFT JOIN suppliers sm ON e.supplier_id = sm.id
  LEFT JOIN payment_methods pm ON e.payment_method_id = pm.id
  WHERE e.restaurant_id = $1
`;

const EXPENSE_BY_ID = `
  SELECT * FROM expenses WHERE id = $1
`;

const CREATE_EXPENSE = `
  INSERT INTO expenses (restaurant_id, expense_number, occurred_at, business_date,
                       currency, supplier_id, payment_method_id, total_minor, notes,
                       recorded_by_user_id, client_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  RETURNING *
`;

const GET_PAYMENT_METHOD = `
  SELECT id, key, name FROM payment_method WHERE id = $1 AND (restaurant_id IS NULL OR restaurant_id = $2)
`;

const GET_EXPENSE_CATEGORY_BY_ID = `
  SELECT id, key, name, is_operating FROM expense_category WHERE id = $1 AND (restaurant_id IS NULL OR restaurant_id = $2)
`;

const GET_ALL_EXPENSE_CATEGORIES = `
  SELECT id, key, name, is_operating, is_system FROM expense_category WHERE is_active = true AND (restaurant_id IS NULL OR restaurant_id = $1)
  ORDER BY sort_order, name
`;

function serializeExpense(expense: any) {
  return {
    id: expense.id,
    expenseNumber: expense.expense_number,
    status: expense.status,
    occurredAt: expense.occurredAt?.toISOString() || new Date().toISOString(),
    businessDate: expense.business_date?.toString() || new Date().toISOString().split('T')[0],
    currency: expense.currency || "MWK",
    totalMinor: toBigInt(expense.total_minor),
    notes: expense.notes,
    supplier: expense.supplier,
    paymentMethod: expense.payment_method,
    recordedBy: expense.recorded_by_user_id,
    voidedAt: expense.voidedAt?.toISOString() || null,
    voidReason: expense.void_reason,
    items: (expense.items || []).map((item: any) => ({
      id: item.id,
      categoryId: item.expense_category_id,
      categoryName: item.category?.name || "",
      categoryKey: item.category?.key || "",
      description: item.description,
      quantity: item.quantity.toFixed(4),
      unit: item.unit,
      unitPriceMinor: toBigInt(item.unit_price_minor),
      lineTotalMinor: toBigInt(item.line_total_minor)
    }))
  };
}

export async function listExpenses(
  restaurantId: string,
  query: {
    page: number;
    pageSize: number;
    startDate?: string;
    endDate?: string;
    status?: "ACTIVE" | "VOIDED";
    categoryId?: string;
    supplierId?: string;
  }
) {
  const params: any[] = [restaurantId];
  let whereClause = "WHERE e.restaurant_id = $1";
  let paramIndex = 2;

  if (query.status) {
    whereClause += ` AND e.status = $${paramIndex}`;
    params.push(query.status);
    paramIndex++;
  }

  if (query.categoryId) {
    whereClause += ` AND e.expense_category_id = $${paramIndex}`;
    params.push(query.categoryId);
    paramIndex++;
  }

  if (query.supplierId) {
    whereClause += ` AND e.supplier_id = $${paramIndex}`;
    params.push(query.supplierId);
    paramIndex++;
  }

  if (query.startDate || query.endDate) {
    whereClause += ` AND e.occurred_at >= $${paramIndex}`;
    params.push(query.startDate || "1900-01-01");
    paramIndex++;
    if (query.endDate) {
      whereClause += ` AND e.occurred_at <= $${paramIndex}`;
      params.push(query.endDate);
      paramIndex++;
    }
  }

  // Count total
  const [{ count }] = await pool.query(
    `SELECT COUNT(*)::int as total FROM expenses ${whereClause}`,
    params
  );
  const total = count || 0;

  // Add pagination params
  params.push(query.pageSize, (query.page - 1) * query.pageSize);

  // Fetch page
  const { rows } = await pool.query(
    `SELECT * FROM expenses ${whereClause} ORDER BY occurred_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    items: rows.map(serializeExpense),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getExpense(restaurantId: string, expenseId: string) {
  const { rows } = await pool.query(EXPENSE_BY_ID, [expenseId]);

  if (rows.length === 0) throw new NotFoundError("The expense was not found");
  return serializeExpense(rows[0]);
}

export async function createExpense(
  restaurantId: string,
  actorUserId: string,
  input: {
    clientId?: string;
    occurredAt: string;
    supplierId?: string;
    paymentMethodId: string;
    notes?: string;
    items: Array<{
      categoryId: string;
      description: string;
      quantity: string;
      unit: string;
      unitPriceMinor: bigint;
    }>;
  },
  meta: AuditMeta
) {
  const result = await transaction(async (client) => {
    // 1. Validate restaurant
    const { rows: restaurant } = await client.query(
      `SELECT id, currency FROM restaurants WHERE id = $1`,
      [restaurantId]
    );
    if (restaurant.length === 0) throw new NotFoundError("Restaurant not found");

    // 2. Validate payment method
    const { rows: method } = await client.query(
      GET_PAYMENT_METHOD,
      [input.paymentMethodId, restaurantId]
    );
    if (method.length === 0) throw new NotFoundError("Payment method not found");

    // 3. Validate categories
    const categoryIds = [...new Set(input.items.map((item) => item.categoryId))];
    const { rows: categories } = await client.query(
      `SELECT id, key, name, is_operating FROM expense_category WHERE id = ANY($1::int[]) AND is_active = true`,
      [categoryIds]
    );
    const validCategoryIds = new Set(categories.map((c: any) => c.id));
    const allCategoriesValid = categoryIds.every(id => validCategoryIds.has(id));
    if (!allCategoriesValid) throw new NotFoundError("An expense category was not found");

    // 4. Calculate totals
    const lines = input.items.map((item) => ({
      ...item,
      lineTotalMinor: lineTotalMinor(item.quantity, item.unitPriceMinor)
    }));
    const total = lines.reduce((sum, item) => sum + toBigInt(item.lineTotalMinor), 0n);
    if (total <= 0n) throw new BadRequestError("The expense total must be greater than zero");

    // 5. Generate expense number
    const expenseNumber = await nextDocumentNumber(client, restaurantId, "EXPENSE");

    // 6. Insert expense
    const { rows: expense } = await client.query(CREATE_EXPENSE, [
      restaurantId,
      expenseNumber,
      new Date(input.occurredAt),
      /* business date */ new Date(),
      "MWK",
      input.supplierId,
      input.paymentMethodId,
      total,
      input.notes,
      actorUserId,
      input.clientId
    ]);

    // 7. Insert expense items
    for (const item of lines) {
      await client.query(
        `INSERT INTO expense_items (expense_id, expense_category_id, description, quantity, unit, unit_price_minor, line_total_minor)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          expense.id,
          item.categoryId,
          item.description,
          item.quantity,
          item.unit,
          toBigInt(item.unitPriceMinor),
          toBigInt(item.lineTotalMinor)
        ]
      );
    }

    // 8. Record audit
    await client.query(
      `INSERT INTO audit_log (restaurant_id, actor_user_id, action, entity_type, entity_id, before, after, ip, user_agent, created_at)
       VALUES ($1, $2, 'EXPENSE_CREATED', 'Expense', $3, $4, $5, $6, $7, NOW())`,
      [restaurantId, actorUserId, expense.id,
        JSON.stringify({ expenseNumber, totalMinor: total.toString() }),
        null,
        JSON.stringify({ expenseNumber, totalMinor: total.toString() }),
        meta.ip, meta.userAgent]
    );

    return { success: true, expense: { id: expense.id, ...expense, items: lines } };
  });

  return result;
}

export async function voidExpense(
  restaurantId: string,
  actorUserId: string,
  expenseId: string,
  reason: string,
  meta: AuditMeta
) {
  const result = await transaction(async (client) => {
    const { rows: expense } = await pool.query(EXPENSE_BY_ID, [expenseId]);
    if (expense.length === 0) throw new NotFoundError("The expense was not found");
    if (expense[0].status === "VOIDED") throw new BadRequestError("This expense is already voided");

    await client.query(
      `UPDATE expenses SET status = 'VOIDED', voided_at = NOW(), void_reason = $1 WHERE id = $2`,
      [reason, expenseId]
    );

    await client.query(
      `INSERT INTO audit_log (restaurant_id, actor_user_id, action, entity_type, entity_id, before, after, ip, user_agent, created_at)
       VALUES ($1, $2, 'EXPENSE_VOIDED', 'Expense', $3, $4, $5, $6, $7, NOW())`,
      [restaurantId, actorUserId, expense.id,
        JSON.stringify({ status: "ACTIVE", totalMinor: toBigInt(expense[0].total_minor).toString() }),
        JSON.stringify({ status: "VOIDED", reason }),
        meta.ip, meta.userAgent]
    );

    return getExpense(restaurantId, expenseId);
  });

  return result;
}