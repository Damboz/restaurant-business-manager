import { lineTotalMinor } from "@rbm/shared";
import { recordAudit } from "../../lib/audit.js";
import {
  businessDateFrom,
  dateOnlyToDate,
  dateToDateOnly
} from "../../lib/business-date.js";
import { assertDayOpen } from "../../lib/day-lock.js";
import { query, transaction } from "../../lib/db.js";
import { refreshClosedDaySnapshot } from "../closings/closings.service.js";
import { decimal } from "../../lib/decimal.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { nextDocumentNumber } from "../../lib/sequence.js";

type AuditMeta = { ip?: string; userAgent?: string };

type ExpenseRow = {
  id: string;
  expense_number: string;
  status: "ACTIVE" | "VOIDED";
  occurred_at: Date;
  business_date: string;
  currency: string;
  total_minor: string;
  notes: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  payment_method_id: string;
  payment_method_key: string;
  payment_method_name: string;
  recorded_by_user_id: string;
  recorded_by_name: string;
  voided_at: Date | null;
  void_reason: string | null;
};

type ExpenseItemRow = {
  id: string;
  expense_id: string;
  expense_category_id: string;
  category_name: string;
  category_key: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price_minor: string;
  line_total_minor: string;
};

const EXPENSE_SELECT = `
  SELECT e.id, e.expense_number, e.status, e.occurred_at, e.business_date,
         e.currency, e.total_minor, e.notes,
         e.supplier_id, s.name AS supplier_name,
         e.payment_method_id, pm.key AS payment_method_key,
         pm.name AS payment_method_name,
         e.recorded_by_user_id, u.full_name AS recorded_by_name,
         e.voided_at, e.void_reason
  FROM expenses e
  LEFT JOIN suppliers s ON s.id = e.supplier_id
  JOIN payment_methods pm ON pm.id = e.payment_method_id
  JOIN users u ON u.id = e.recorded_by_user_id
`;

function serializeExpense(expense: ExpenseRow, items: ExpenseItemRow[]) {
  return {
    id: expense.id,
    expenseNumber: expense.expense_number,
    status: expense.status,
    occurredAt: expense.occurred_at.toISOString(),
    businessDate: dateToDateOnly(expense.business_date),
    currency: expense.currency,
    totalMinor: expense.total_minor.toString(),
    notes: expense.notes,
    supplier: expense.supplier_id
      ? { id: expense.supplier_id, name: expense.supplier_name }
      : null,
    paymentMethod: {
      id: expense.payment_method_id,
      key: expense.payment_method_key,
      name: expense.payment_method_name
    },
    recordedBy: {
      id: expense.recorded_by_user_id,
      fullName: expense.recorded_by_name
    },
    voidedAt: expense.voided_at ? expense.voided_at.toISOString() : null,
    voidReason: expense.void_reason,
    items: items.map((item) => ({
      id: item.id,
      categoryId: item.expense_category_id,
      categoryName: item.category_name,
      categoryKey: item.category_key,
      description: item.description,
      quantity: decimal(item.quantity).toFixed(4),
      unit: item.unit,
      unitPriceMinor: item.unit_price_minor.toString(),
      lineTotalMinor: item.line_total_minor.toString()
    }))
  };
}

async function hydrateExpenses(expenses: ExpenseRow[]) {
  if (expenses.length === 0) {
    return [];
  }

  const ids = expenses.map((expense) => expense.id);
  const { rows: items } = await query<ExpenseItemRow>(
    `SELECT ei.id, ei.expense_id, ei.expense_category_id,
            ec.name AS category_name, ec.key AS category_key,
            ei.description, ei.quantity, ei.unit,
            ei.unit_price_minor, ei.line_total_minor
     FROM expense_items ei
     JOIN expense_categories ec ON ec.id = ei.expense_category_id
     WHERE ei.expense_id = ANY($1::uuid[])`,
    [ids]
  );

  const itemsByExpense = new Map<string, ExpenseItemRow[]>();
  for (const item of items) {
    const list = itemsByExpense.get(item.expense_id) ?? [];
    list.push(item);
    itemsByExpense.set(item.expense_id, list);
  }

  return expenses.map((expense) =>
    serializeExpense(expense, itemsByExpense.get(expense.id) ?? [])
  );
}

async function loadExpense(restaurantId: string, expenseId: string) {
  const { rows } = await query<ExpenseRow>(
    `${EXPENSE_SELECT} WHERE e.id = $1 AND e.restaurant_id = $2`,
    [expenseId, restaurantId]
  );

  if (!rows[0]) {
    throw new NotFoundError("The expense was not found");
  }

  const [serialized] = await hydrateExpenses(rows);
  return serialized;
}

export async function listExpenses(
  restaurantId: string,
  filters: {
    page: number;
    pageSize: number;
    startDate?: string;
    endDate?: string;
    status?: "ACTIVE" | "VOIDED";
    categoryId?: string;
    supplierId?: string;
  }
) {
  const conditions = ["e.restaurant_id = $1"];
  const params: unknown[] = [restaurantId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`e.status = $${params.length}`);
  }
  if (filters.supplierId) {
    params.push(filters.supplierId);
    conditions.push(`e.supplier_id = $${params.length}`);
  }
  if (filters.categoryId) {
    params.push(filters.categoryId);
    conditions.push(
      `EXISTS (SELECT 1 FROM expense_items ei WHERE ei.expense_id = e.id AND ei.expense_category_id = $${params.length})`
    );
  }
  if (filters.startDate) {
    params.push(dateToDateOnly(dateOnlyToDate(filters.startDate)));
    conditions.push(`e.business_date >= $${params.length}`);
  }
  if (filters.endDate) {
    params.push(dateToDateOnly(dateOnlyToDate(filters.endDate)));
    conditions.push(`e.business_date <= $${params.length}`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const offset = (filters.page - 1) * filters.pageSize;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    query<ExpenseRow>(
      `${EXPENSE_SELECT} ${where} ORDER BY e.occurred_at DESC LIMIT $${
        params.length + 1
      } OFFSET $${params.length + 2}`,
      [...params, filters.pageSize, offset]
    ),
    query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM expenses e ${where}`,
      params
    )
  ]);

  return {
    items: await hydrateExpenses(rows),
    total: Number(countRows[0]?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize
  };
}

export async function getExpense(restaurantId: string, expenseId: string) {
  return loadExpense(restaurantId, expenseId);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
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
  if (input.clientId) {
    const { rows } = await query<ExpenseRow>(
      `${EXPENSE_SELECT} WHERE e.restaurant_id = $1 AND e.client_id = $2`,
      [restaurantId, input.clientId]
    );
    if (rows[0]) {
      const [serialized] = await hydrateExpenses(rows);
      return serialized;
    }
  }

  const occurredAt = new Date(input.occurredAt);
  const { rows: restaurantRows } = await query<{
    timezone: string;
    currency: string;
  }>("SELECT timezone, currency FROM restaurants WHERE id = $1", [restaurantId]);

  const restaurant = restaurantRows[0];
  if (!restaurant) {
    throw new NotFoundError("The restaurant was not found");
  }

  const businessDate = dateToDateOnly(
    businessDateFrom(occurredAt, restaurant.timezone)
  );

  let expenseId: string;

  try {
    expenseId = await transaction(async (client) => {
      await assertDayOpen(client, restaurantId, businessDate);

      const { rows: methods } = await client.query<{ id: string }>(
        `SELECT id FROM payment_methods
         WHERE id = $1 AND is_active = true
           AND (restaurant_id = $2 OR restaurant_id IS NULL)`,
        [input.paymentMethodId, restaurantId]
      );
      if (!methods[0]) {
        throw new NotFoundError("The payment method was not found");
      }

      if (input.supplierId) {
        const { rows: suppliers } = await client.query<{ id: string }>(
          "SELECT id FROM suppliers WHERE id = $1 AND restaurant_id = $2",
          [input.supplierId, restaurantId]
        );
        if (!suppliers[0]) {
          throw new NotFoundError("The supplier was not found");
        }
      }

      const categoryIds = [
        ...new Set(input.items.map((item) => item.categoryId))
      ];
      const { rows: categories } = await client.query<{ id: string }>(
        `SELECT id FROM expense_categories
         WHERE id = ANY($1::uuid[]) AND is_active = true
           AND (restaurant_id = $2 OR restaurant_id IS NULL)`,
        [categoryIds, restaurantId]
      );
      if (categories.length !== categoryIds.length) {
        throw new NotFoundError("An expense category was not found");
      }

      const lines = input.items.map((item) => ({
        ...item,
        lineTotalMinor: lineTotalMinor(item.quantity, item.unitPriceMinor)
      }));
      const total = lines.reduce((sum, item) => sum + item.lineTotalMinor, 0n);
      if (total <= 0n) {
        throw new BadRequestError("The expense total must be greater than zero");
      }

      const expenseNumber = await nextDocumentNumber(
        client,
        restaurantId,
        "EXPENSE",
        businessDate
      );

      const { rows: expenseRows } = await client.query<{ id: string }>(
        `INSERT INTO expenses
           (id, restaurant_id, expense_number, status, occurred_at, business_date,
            currency, supplier_id, payment_method_id, total_minor, notes,
            recorded_by_user_id, client_id, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, 'ACTIVE', $3, $4,
            $5, $6, $7, $8, $9,
            $10, $11, NOW(), NOW())
         RETURNING id`,
        [
          restaurantId,
          expenseNumber,
          occurredAt,
          businessDate,
          restaurant.currency,
          input.supplierId ?? null,
          input.paymentMethodId,
          total.toString(),
          input.notes ?? null,
          actorUserId,
          input.clientId ?? null
        ]
      );

      const expense = expenseRows[0];
      if (!expense) {
        throw new ConflictError("The expense could not be recorded");
      }

      for (const line of lines) {
        await client.query(
          `INSERT INTO expense_items
             (id, expense_id, expense_category_id, description, quantity,
              unit, unit_price_minor, line_total_minor)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
          [
            expense.id,
            line.categoryId,
            line.description,
            decimal(line.quantity).toFixed(4),
            line.unit,
            line.unitPriceMinor.toString(),
            line.lineTotalMinor.toString()
          ]
        );
      }

      await recordAudit(client, {
        restaurantId,
        actorUserId,
        action: "EXPENSE_CREATED",
        entityType: "Expense",
        entityId: expense.id,
        after: { expenseNumber, totalMinor: total.toString() },
        ...meta
      });

      return expense.id;
    });
  } catch (error) {
    if (input.clientId && isUniqueViolation(error)) {
      const { rows } = await query<ExpenseRow>(
        `${EXPENSE_SELECT} WHERE e.restaurant_id = $1 AND e.client_id = $2`,
        [restaurantId, input.clientId]
      );
      if (rows[0]) {
        const [serialized] = await hydrateExpenses(rows);
        return serialized;
      }
      throw new ConflictError("The expense was already recorded");
    }
    throw error;
  }

  return loadExpense(restaurantId, expenseId);
}

export async function voidExpense(
  restaurantId: string,
  actorUserId: string,
  expenseId: string,
  reason: string,
  meta: AuditMeta
) {
  let voidedBusinessDate: string | null = null;

  await transaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      status: string;
      total_minor: string;
      business_date: string;
    }>(
      `SELECT id, status, total_minor, business_date
       FROM expenses WHERE id = $1 AND restaurant_id = $2`,
      [expenseId, restaurantId]
    );

    const expense = rows[0];
    if (!expense) {
      throw new NotFoundError("The expense was not found");
    }
    if (expense.status === "VOIDED") {
      throw new BadRequestError("This expense is already voided");
    }

    voidedBusinessDate = expense.business_date;

    await client.query(
      `UPDATE expenses
       SET status = 'VOIDED', voided_at = NOW(), voided_by_user_id = $1,
           void_reason = $2, updated_at = NOW()
       WHERE id = $3`,
      [actorUserId, reason, expenseId]
    );

    await recordAudit(client, {
      restaurantId,
      actorUserId,
      action: "EXPENSE_VOIDED",
      entityType: "Expense",
      entityId: expenseId,
      before: { status: "ACTIVE", totalMinor: expense.total_minor.toString() },
      after: { status: "VOIDED", reason },
      ...meta
    });
  });

  if (voidedBusinessDate) {
    await refreshClosedDaySnapshot(restaurantId, voidedBusinessDate);
  }

  return loadExpense(restaurantId, expenseId);
}

export async function listExpenseCategories(restaurantId: string) {
  const { rows } = await query<{
    id: string;
    key: string | null;
    name: string;
    is_operating: boolean;
    is_system: boolean;
  }>(
    `SELECT id, key, name, is_operating, is_system
     FROM expense_categories
     WHERE is_active = true AND (restaurant_id = $1 OR restaurant_id IS NULL)
     ORDER BY sort_order ASC, name ASC`,
    [restaurantId]
  );

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    isOperating: row.is_operating,
    isSystem: row.is_system
  }));
}
