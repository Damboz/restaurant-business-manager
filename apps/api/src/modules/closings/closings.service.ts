import { recordAudit } from "../../lib/audit.js";
import {
  dateOnlyToDate,
  dateToDateOnly,
  todayInTimeZone
} from "../../lib/business-date.js";
import { query, transaction } from "../../lib/db.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { summaryForRange } from "../reports/reports.service.js";

type AuditMeta = { ip?: string; userAgent?: string };

type ClosingRow = {
  id: string;
  business_date: string;
  status: string;
  cash_sales_minor: string;
  mobile_money_sales_minor: string;
  bank_sales_minor: string;
  other_sales_minor: string;
  manual_sales_minor: string;
  total_sales_minor: string;
  cogs_minor: string;
  gross_profit_minor: string;
  operating_expenses_minor: string;
  net_profit_minor: string;
  transaction_count: number;
  closed_at: Date;
  reopened_at: Date | null;
  reopen_reason: string | null;
};

async function restaurantTimezone(restaurantId: string): Promise<string> {
  const { rows } = await query<{ timezone: string }>(
    "SELECT timezone FROM restaurants WHERE id = $1",
    [restaurantId]
  );
  if (!rows[0]) {
    throw new NotFoundError("The restaurant was not found");
  }
  return rows[0].timezone;
}

export async function previewClosing(restaurantId: string, businessDate?: string) {
  const timezone = await restaurantTimezone(restaurantId);
  const date = businessDate ?? todayInTimeZone(timezone);
  const summary = await summaryForRange(restaurantId, date, date);

  const { rows } = await query<{
    status: string;
    closed_at: Date | null;
    reopened_at: Date | null;
    reopen_reason: string | null;
  }>(
    `SELECT status, closed_at, reopened_at, reopen_reason
     FROM daily_closings
     WHERE restaurant_id = $1 AND business_date = $2`,
    [restaurantId, dateToDateOnly(dateOnlyToDate(date))]
  );
  const closing = rows[0];

  return {
    businessDate: date,
    status: closing?.status ?? "OPEN",
    closedAt: closing?.closed_at ? closing.closed_at.toISOString() : null,
    reopenedAt: closing?.reopened_at ? closing.reopened_at.toISOString() : null,
    reopenReason: closing?.reopen_reason ?? null,
    summary
  };
}

function closingData(summary: Awaited<ReturnType<typeof summaryForRange>>) {
  const daily = summary.daily[0];
  const manualSales = 0n;
  return {
    cashSalesMinor: BigInt(summary.sales.byPayment.cashMinor),
    mobileMoneySalesMinor: BigInt(summary.sales.byPayment.mobileMoneyMinor),
    bankSalesMinor: BigInt(summary.sales.byPayment.bankMinor),
    otherSalesMinor: BigInt(summary.sales.byPayment.otherMinor),
    manualSalesMinor: manualSales,
    totalSalesMinor: BigInt(summary.sales.totalMinor),
    cogsMinor: BigInt(summary.cogsMinor),
    grossProfitMinor: BigInt(summary.grossProfitMinor),
    operatingExpensesMinor: BigInt(summary.expenses.operatingMinor),
    netProfitMinor: BigInt(summary.netProfitMinor),
    transactionCount: daily?.transactions ?? summary.sales.transactionCount
  };
}

export async function closeDay(
  restaurantId: string,
  actorUserId: string,
  businessDate: string,
  meta: AuditMeta
) {
  const summary = await summaryForRange(restaurantId, businessDate, businessDate);
  const date = dateToDateOnly(dateOnlyToDate(businessDate));
  const totals = closingData(summary);

  const closing = await transaction(async (client) => {
    const { rows: existingRows } = await client.query<{ status: string }>(
      `SELECT status FROM daily_closings
       WHERE restaurant_id = $1 AND business_date = $2`,
      [restaurantId, date]
    );

    if (existingRows[0]?.status === "CLOSED") {
      throw new BadRequestError("This business day is already closed");
    }

    const { rows } = await client.query<ClosingRow>(
      `INSERT INTO daily_closings
         (id, restaurant_id, business_date, status, cash_sales_minor,
          mobile_money_sales_minor, bank_sales_minor, other_sales_minor,
          manual_sales_minor, total_sales_minor, cogs_minor, gross_profit_minor,
          operating_expenses_minor, net_profit_minor, transaction_count,
          closed_by_user_id, closed_at, reopened_by_user_id, reopened_at,
          reopen_reason, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'CLOSED', $3,
          $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13,
          $14, NOW(), NULL, NULL,
          NULL, NOW(), NOW())
       ON CONFLICT (restaurant_id, business_date) DO UPDATE
         SET status = 'CLOSED',
             cash_sales_minor = EXCLUDED.cash_sales_minor,
             mobile_money_sales_minor = EXCLUDED.mobile_money_sales_minor,
             bank_sales_minor = EXCLUDED.bank_sales_minor,
             other_sales_minor = EXCLUDED.other_sales_minor,
             manual_sales_minor = EXCLUDED.manual_sales_minor,
             total_sales_minor = EXCLUDED.total_sales_minor,
             cogs_minor = EXCLUDED.cogs_minor,
             gross_profit_minor = EXCLUDED.gross_profit_minor,
             operating_expenses_minor = EXCLUDED.operating_expenses_minor,
             net_profit_minor = EXCLUDED.net_profit_minor,
             transaction_count = EXCLUDED.transaction_count,
             closed_by_user_id = EXCLUDED.closed_by_user_id,
             closed_at = NOW(),
             reopened_by_user_id = NULL,
             reopened_at = NULL,
             reopen_reason = NULL,
             updated_at = NOW()
       RETURNING *`,
      [
        restaurantId,
        date,
        totals.cashSalesMinor.toString(),
        totals.mobileMoneySalesMinor.toString(),
        totals.bankSalesMinor.toString(),
        totals.otherSalesMinor.toString(),
        totals.manualSalesMinor.toString(),
        totals.totalSalesMinor.toString(),
        totals.cogsMinor.toString(),
        totals.grossProfitMinor.toString(),
        totals.operatingExpensesMinor.toString(),
        totals.netProfitMinor.toString(),
        totals.transactionCount,
        actorUserId
      ]
    );

    const saved = rows[0];
    if (!saved) {
      throw new BadRequestError("The business day could not be closed");
    }

    await recordAudit(client, {
      restaurantId,
      actorUserId,
      action: "DAY_CLOSED",
      entityType: "DailyClosing",
      entityId: saved.id,
      after: {
        businessDate,
        totalSalesMinor: totals.totalSalesMinor.toString(),
        netProfitMinor: totals.netProfitMinor.toString()
      },
      ...meta
    });

    return saved;
  });

  await createClosingNotification(
    restaurantId,
    actorUserId,
    businessDate,
    totals.netProfitMinor
  );

  return serializeClosing(closing);
}

export async function reopenDay(
  restaurantId: string,
  actorUserId: string,
  businessDate: string,
  reason: string,
  meta: AuditMeta
) {
  const date = dateToDateOnly(dateOnlyToDate(businessDate));

  const closing = await transaction(async (client) => {
    const { rows: existingRows } = await client.query<{
      id: string;
      status: string;
    }>(
      `SELECT id, status FROM daily_closings
       WHERE restaurant_id = $1 AND business_date = $2`,
      [restaurantId, date]
    );

    const existing = existingRows[0];
    if (!existing) {
      throw new NotFoundError("This business day has not been closed");
    }
    if (existing.status !== "CLOSED") {
      throw new BadRequestError("This business day is already open");
    }

    const { rows } = await client.query<ClosingRow>(
      `UPDATE daily_closings
       SET status = 'OPEN', reopened_by_user_id = $1, reopened_at = NOW(),
           reopen_reason = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [actorUserId, reason, existing.id]
    );

    const reopened = rows[0];
    if (!reopened) {
      throw new NotFoundError("This business day has not been closed");
    }

    await recordAudit(client, {
      restaurantId,
      actorUserId,
      action: "DAY_REOPENED",
      entityType: "DailyClosing",
      entityId: existing.id,
      before: { status: "CLOSED" },
      after: { status: "OPEN", reason },
      ...meta
    });

    return reopened;
  });

  return serializeClosing(closing);
}

function serializeClosing(closing: ClosingRow) {
  return {
    id: closing.id,
    businessDate: dateToDateOnly(closing.business_date),
    status: closing.status,
    cashSalesMinor: closing.cash_sales_minor.toString(),
    mobileMoneySalesMinor: closing.mobile_money_sales_minor.toString(),
    bankSalesMinor: closing.bank_sales_minor.toString(),
    otherSalesMinor: closing.other_sales_minor.toString(),
    manualSalesMinor: closing.manual_sales_minor.toString(),
    totalSalesMinor: closing.total_sales_minor.toString(),
    cogsMinor: closing.cogs_minor.toString(),
    grossProfitMinor: closing.gross_profit_minor.toString(),
    operatingExpensesMinor: closing.operating_expenses_minor.toString(),
    netProfitMinor: closing.net_profit_minor.toString(),
    transactionCount: Number(closing.transaction_count),
    closedAt: closing.closed_at.toISOString(),
    reopenedAt: closing.reopened_at ? closing.reopened_at.toISOString() : null,
    reopenReason: closing.reopen_reason
  };
}

async function createClosingNotification(
  restaurantId: string,
  userId: string,
  businessDate: string,
  netProfitMinor: bigint
): Promise<void> {
  try {
    await query(
      `INSERT INTO notifications
         (id, restaurant_id, user_id, type, severity, title_key, body_key,
          params, dedupe_key, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'DAILY_SUMMARY', 'INFO',
          'notifications.dailySummary.title',
          'notifications.dailySummary.body',
          $3::jsonb, $4, NOW())
       ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [
        restaurantId,
        userId,
        JSON.stringify({
          date: businessDate,
          netProfitMinor: netProfitMinor.toString()
        }),
        `daily-summary:${businessDate}`
      ]
    );
  } catch {
    // A duplicate or notification failure must not reopen a successful close.
  }
}

export async function listClosings(
  restaurantId: string,
  filters: {
    page: number;
    pageSize: number;
    startDate?: string;
    endDate?: string;
    status?: "OPEN" | "CLOSED";
  }
) {
  const conditions = ["restaurant_id = $1"];
  const params: unknown[] = [restaurantId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.startDate) {
    params.push(dateToDateOnly(dateOnlyToDate(filters.startDate)));
    conditions.push(`business_date >= $${params.length}`);
  }
  if (filters.endDate) {
    params.push(dateToDateOnly(dateOnlyToDate(filters.endDate)));
    conditions.push(`business_date <= $${params.length}`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const offset = (filters.page - 1) * filters.pageSize;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    query<ClosingRow>(
      `SELECT * FROM daily_closings ${where}
       ORDER BY business_date DESC LIMIT $${params.length + 1} OFFSET $${
        params.length + 2
      }`,
      [...params, filters.pageSize, offset]
    ),
    query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM daily_closings ${where}`,
      params
    )
  ]);

  return {
    items: rows.map(serializeClosing),
    total: Number(countRows[0]?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize
  };
}
