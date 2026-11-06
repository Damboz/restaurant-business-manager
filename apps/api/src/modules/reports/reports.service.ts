import {
  addDays,
  dateToDateOnly,
  rangeDates,
  todayInTimeZone
} from "../../lib/business-date.js";
import { query } from "../../lib/db.js";
import { decimal, roundTo } from "../../lib/decimal.js";
import { NotFoundError } from "../../lib/errors.js";

function splitPaymentKey(key: string): "cash" | "mobile" | "bank" | "other" {
  if (key === "CASH") return "cash";
  if (key === "AIRTEL_MONEY" || key === "TNM_MPAMBA") return "mobile";
  if (key === "BANK_TRANSFER") return "bank";
  return "other";
}

export type ReportSummary = Awaited<ReturnType<typeof summaryForRange>>;

export async function summaryForRange(
  restaurantId: string,
  startDate: string,
  endDate: string
) {
  const { start, endExclusive } = rangeDates(startDate, endDate);
  const startKey = dateToDateOnly(start);
  const endKey = dateToDateOnly(endExclusive);
  const range = [restaurantId, startKey, endKey];

  const [
    { rows: salesRows },
    { rows: cogsRows },
    { rows: expenseRows },
    { rows: operatingRows },
    { rows: paymentRows },
    { rows: categoryRows },
    { rows: productRows },
    { rows: salesByDateRows },
    { rows: expensesByDateRows },
    { rows: ownerRows },
    { rows: inventoryRows }
  ] = await Promise.all([
    query<{ total: string; count: number }>(
      `SELECT COALESCE(SUM(total_minor), 0)::text AS total, COUNT(*)::int AS count
       FROM sales
       WHERE restaurant_id = $1 AND status = 'COMPLETED'
         AND business_date >= $2 AND business_date < $3`,
      range
    ),
    query<{ cogs: string }>(
      `SELECT COALESCE(SUM(si.cost_of_goods_minor), 0)::text AS cogs
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.restaurant_id = $1 AND s.status = 'COMPLETED'
         AND s.business_date >= $2 AND s.business_date < $3
         AND si.cost_of_goods_minor IS NOT NULL`,
      range
    ),
    query<{ total: string; count: number }>(
      `SELECT COALESCE(SUM(total_minor), 0)::text AS total, COUNT(*)::int AS count
       FROM expenses
       WHERE restaurant_id = $1 AND status = 'ACTIVE'
         AND business_date >= $2 AND business_date < $3`,
      range
    ),
    query<{ operating: string }>(
      `SELECT COALESCE(SUM(ei.line_total_minor), 0)::text AS operating
       FROM expense_items ei
       JOIN expenses e ON e.id = ei.expense_id
       JOIN expense_categories ec ON ec.id = ei.expense_category_id
       WHERE e.restaurant_id = $1 AND e.status = 'ACTIVE'
         AND e.business_date >= $2 AND e.business_date < $3
         AND ec.is_operating = true`,
      range
    ),
    query<{ key: string; amount: string }>(
      `SELECT pm.key, COALESCE(SUM(sp.amount_minor), 0)::text AS amount
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id
       JOIN payment_methods pm ON pm.id = sp.payment_method_id
       WHERE s.restaurant_id = $1 AND s.status = 'COMPLETED'
         AND s.business_date >= $2 AND s.business_date < $3
       GROUP BY pm.key`,
      range
    ),
    query<{ id: string; name: string; total: string }>(
      `SELECT ec.id, ec.name, COALESCE(SUM(ei.line_total_minor), 0)::text AS total
       FROM expense_items ei
       JOIN expenses e ON e.id = ei.expense_id
       JOIN expense_categories ec ON ec.id = ei.expense_category_id
       WHERE e.restaurant_id = $1 AND e.status = 'ACTIVE'
         AND e.business_date >= $2 AND e.business_date < $3
       GROUP BY ec.id, ec.name`,
      range
    ),
    query<{
      name: string;
      revenue: string;
      quantity: string;
      sale_count: number;
    }>(
      `SELECT si.product_name AS name,
              COALESCE(SUM(si.line_total_minor), 0)::text AS revenue,
              COALESCE(SUM(si.quantity), 0)::text AS quantity,
              COUNT(*)::int AS sale_count
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.restaurant_id = $1 AND s.status = 'COMPLETED'
         AND s.business_date >= $2 AND s.business_date < $3
       GROUP BY si.product_name
       ORDER BY SUM(si.line_total_minor) DESC
       LIMIT 10`,
      range
    ),
    query<{ business_date: string; total: string; transactions: number }>(
      `SELECT business_date::text AS business_date,
              COALESCE(SUM(total_minor), 0)::text AS total,
              COUNT(*)::int AS transactions
       FROM sales
       WHERE restaurant_id = $1 AND status = 'COMPLETED'
         AND business_date >= $2 AND business_date < $3
       GROUP BY business_date`,
      range
    ),
    query<{ business_date: string; total: string }>(
      `SELECT business_date::text AS business_date,
              COALESCE(SUM(total_minor), 0)::text AS total
       FROM expenses
       WHERE restaurant_id = $1 AND status = 'ACTIVE'
         AND business_date >= $2 AND business_date < $3
       GROUP BY business_date`,
      range
    ),
    query<{ type: string; amount: string }>(
      `SELECT type, COALESCE(SUM(amount_minor), 0)::text AS amount
       FROM owner_transactions
       WHERE restaurant_id = $1 AND status = 'ACTIVE'
         AND business_date >= $2 AND business_date < $3
       GROUP BY type`,
      range
    ),
    query<{
      id: string;
      name: string;
      unit: string;
      current_quantity: string;
      minimum_level: string;
      average_cost_minor_per_unit: string;
    }>(
      `SELECT id, name, unit, current_quantity, minimum_level,
              average_cost_minor_per_unit
       FROM inventory_items
       WHERE restaurant_id = $1 AND is_active = true`,
      [restaurantId]
    )
  ]);

  const paymentBreakdown = { cash: 0n, mobile: 0n, bank: 0n, other: 0n };
  for (const payment of paymentRows) {
    paymentBreakdown[splitPaymentKey(payment.key)] += BigInt(payment.amount);
  }

  const dailyMap = new Map<
    string,
    { date: string; salesMinor: bigint; expensesMinor: bigint; transactions: number }
  >();

  for (const sale of salesByDateRows) {
    const key = dateToDateOnly(sale.business_date);
    const entry =
      dailyMap.get(key) ?? {
        date: key,
        salesMinor: 0n,
        expensesMinor: 0n,
        transactions: 0
      };
    entry.salesMinor += BigInt(sale.total);
    entry.transactions += Number(sale.transactions);
    dailyMap.set(key, entry);
  }

  for (const expense of expensesByDateRows) {
    const key = dateToDateOnly(expense.business_date);
    const entry =
      dailyMap.get(key) ?? {
        date: key,
        salesMinor: 0n,
        expensesMinor: 0n,
        transactions: 0
      };
    entry.expensesMinor += BigInt(expense.total);
    dailyMap.set(key, entry);
  }

  const sales = salesRows[0] ?? { total: "0", count: 0 };
  const expenses = expenseRows[0] ?? { total: "0", count: 0 };

  const totalSales = BigInt(sales.total);
  const cogs = BigInt(cogsRows[0]?.cogs ?? "0");
  const totalExpenses = BigInt(expenses.total);
  const operatingExpenses = BigInt(operatingRows[0]?.operating ?? "0");
  const grossProfit = totalSales - cogs;
  const netProfit = grossProfit - operatingExpenses;

  const inventoryValue = inventoryRows.reduce(
    (sum, item) =>
      sum +
      roundTo(
        decimal(item.current_quantity).mul(item.average_cost_minor_per_unit),
        0
      ),
    0n
  );
  const lowStockItems = inventoryRows.filter((item) =>
    decimal(item.current_quantity).lte(item.minimum_level)
  );

  const ownerTotals = { WITHDRAWAL: 0n, CONTRIBUTION: 0n };
  for (const owner of ownerRows) {
    if (owner.type === "WITHDRAWAL" || owner.type === "CONTRIBUTION") {
      ownerTotals[owner.type] += BigInt(owner.amount);
    }
  }

  return {
    startDate,
    endDate,
    sales: {
      totalMinor: totalSales.toString(),
      transactionCount: Number(sales.count),
      averageTransactionMinor: (
        Number(sales.count) === 0
          ? 0n
          : totalSales / BigInt(Number(sales.count))
      ).toString(),
      byPayment: {
        cashMinor: paymentBreakdown.cash.toString(),
        mobileMoneyMinor: paymentBreakdown.mobile.toString(),
        bankMinor: paymentBreakdown.bank.toString(),
        otherMinor: paymentBreakdown.other.toString()
      }
    },
    expenses: {
      totalMinor: totalExpenses.toString(),
      operatingMinor: operatingExpenses.toString(),
      recordCount: Number(expenses.count),
      byCategory: categoryRows
        .map((item) => ({
          categoryId: item.id,
          categoryName: item.name,
          totalMinor: item.total.toString()
        }))
        .sort((a, b) => Number(BigInt(b.totalMinor) - BigInt(a.totalMinor)))
    },
    cogsMinor: cogs.toString(),
    grossProfitMinor: grossProfit.toString(),
    netProfitMinor: netProfit.toString(),
    topProducts: productRows.map((product) => ({
      name: product.name,
      revenueMinor: product.revenue.toString(),
      quantity: decimal(product.quantity).toString(),
      saleCount: Number(product.sale_count)
    })),
    ownerTransactions: {
      withdrawalsMinor: ownerTotals.WITHDRAWAL.toString(),
      contributionsMinor: ownerTotals.CONTRIBUTION.toString()
    },
    inventory: {
      valueMinor: inventoryValue.toString(),
      lowStockCount: lowStockItems.length,
      lowStockItems: lowStockItems.slice(0, 20).map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        currentQuantity: decimal(item.current_quantity).toFixed(4),
        minimumLevel: decimal(item.minimum_level).toFixed(4)
      }))
    },
    daily: [...dailyMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((entry) => ({
        date: entry.date,
        salesMinor: entry.salesMinor.toString(),
        expensesMinor: entry.expensesMinor.toString(),
        transactions: entry.transactions
      }))
  };
}

export async function getDashboard(restaurantId: string) {
  const { rows: restaurantRows } = await query<{
    timezone: string;
    currency: string;
  }>("SELECT timezone, currency FROM restaurants WHERE id = $1", [restaurantId]);

  const restaurant = restaurantRows[0];
  if (!restaurant) {
    throw new NotFoundError("The restaurant was not found");
  }

  const today = todayInTimeZone(restaurant.timezone);
  const summary = await summaryForRange(restaurantId, today, today);

  const { rows: closingRows } = await query<{
    status: string;
    closed_at: Date | null;
  }>(
    `SELECT status, closed_at FROM daily_closings
     WHERE restaurant_id = $1 AND business_date = $2`,
    [restaurantId, today]
  );
  const closing = closingRows[0];

  const firstOfMonth = `${today.slice(0, 8)}01`;
  const month = await summaryForRange(restaurantId, firstOfMonth, today);

  return {
    today,
    currency: restaurant.currency,
    closing: {
      status: closing?.status ?? "OPEN",
      closedAt: closing?.closed_at ? closing.closed_at.toISOString() : null
    },
    todaySummary: summary,
    monthSummary: {
      startDate: firstOfMonth,
      endDate: today,
      salesMinor: month.sales.totalMinor,
      expensesMinor: month.expenses.totalMinor,
      netProfitMinor: month.netProfitMinor,
      transactionCount: month.sales.transactionCount
    }
  };
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export async function exportCsv(
  restaurantId: string,
  type: "sales" | "expenses" | "inventory",
  startDate: string,
  endDate: string
) {
  const { start, endExclusive } = rangeDates(startDate, endDate);

  if (type === "inventory") {
    const { rows: items } = await query<{
      name: string;
      category_name: string;
      unit: string;
      current_quantity: string;
      minimum_level: string;
      average_cost_minor_per_unit: string;
    }>(
      `SELECT ii.name, ic.name AS category_name, ii.unit,
              ii.current_quantity, ii.minimum_level,
              ii.average_cost_minor_per_unit
       FROM inventory_items ii
       JOIN inventory_categories ic ON ic.id = ii.category_id
       WHERE ii.restaurant_id = $1
       ORDER BY ii.name ASC`,
      [restaurantId]
    );

    const rows = [
      [
        "Name",
        "Category",
        "Unit",
        "Quantity",
        "Minimum",
        "Average cost",
        "Stock value"
      ],
      ...items.map((item) => [
        item.name,
        item.category_name,
        item.unit,
        decimal(item.current_quantity).toFixed(4),
        decimal(item.minimum_level).toFixed(4),
        decimal(item.average_cost_minor_per_unit).toFixed(2),
        roundTo(
          decimal(item.current_quantity).mul(item.average_cost_minor_per_unit),
          0
        ).toString()
      ])
    ];

    return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }

  const startKey = dateToDateOnly(start);
  const endKey = dateToDateOnly(endExclusive);

  if (type === "sales") {
    const { rows: sales } = await query<{
      id: string;
      business_date: string;
      transaction_number: string;
      source: string;
      status: string;
      subtotal_minor: string;
      total_minor: string;
    }>(
      `SELECT id, business_date::text AS business_date, transaction_number,
              source, status, subtotal_minor, total_minor
       FROM sales
       WHERE restaurant_id = $1 AND business_date >= $2 AND business_date < $3
       ORDER BY occurred_at ASC`,
      [restaurantId, startKey, endKey]
    );

    const saleIds = sales.map((sale) => sale.id);
    const [{ rows: items }, { rows: payments }] = await Promise.all([
      query<{ sale_id: string; product_name: string; quantity: string }>(
        `SELECT sale_id, product_name, quantity
         FROM sale_items WHERE sale_id = ANY($1::uuid[])`,
        [saleIds]
      ),
      query<{ sale_id: string; name: string }>(
        `SELECT sp.sale_id, pm.name
         FROM sale_payments sp
         JOIN payment_methods pm ON pm.id = sp.payment_method_id
         WHERE sp.sale_id = ANY($1::uuid[])`,
        [saleIds]
      )
    ]);

    const itemsBySale = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsBySale.get(item.sale_id) ?? [];
      list.push(item);
      itemsBySale.set(item.sale_id, list);
    }
    const paymentsBySale = new Map<string, typeof payments>();
    for (const payment of payments) {
      const list = paymentsBySale.get(payment.sale_id) ?? [];
      list.push(payment);
      paymentsBySale.set(payment.sale_id, list);
    }

    const rows = [
      [
        "Date",
        "Transaction",
        "Source",
        "Status",
        "Items",
        "Payment methods",
        "Subtotal",
        "Total"
      ],
      ...sales.map((sale) => [
        dateToDateOnly(sale.business_date),
        sale.transaction_number,
        sale.source,
        sale.status,
        (itemsBySale.get(sale.id) ?? [])
          .map(
            (item) =>
              `${item.product_name} x${decimal(item.quantity).toFixed(2)}`
          )
          .join("; "),
        (paymentsBySale.get(sale.id) ?? [])
          .map((payment) => payment.name)
          .join("; "),
        sale.subtotal_minor.toString(),
        sale.total_minor.toString()
      ])
    ];

    return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }

  const { rows: expenses } = await query<{
    id: string;
    business_date: string;
    expense_number: string;
    status: string;
    supplier_name: string | null;
    payment_method_name: string;
    total_minor: string;
  }>(
    `SELECT e.id, e.business_date::text AS business_date, e.expense_number,
            e.status, s.name AS supplier_name,
            pm.name AS payment_method_name, e.total_minor
     FROM expenses e
     LEFT JOIN suppliers s ON s.id = e.supplier_id
     JOIN payment_methods pm ON pm.id = e.payment_method_id
     WHERE e.restaurant_id = $1 AND e.business_date >= $2 AND e.business_date < $3
     ORDER BY e.occurred_at ASC`,
    [restaurantId, startKey, endKey]
  );

  const expenseIds = expenses.map((expense) => expense.id);
  const { rows: expenseItems } = await query<{
    expense_id: string;
    category_name: string;
    description: string;
  }>(
    `SELECT ei.expense_id, ec.name AS category_name, ei.description
     FROM expense_items ei
     JOIN expense_categories ec ON ec.id = ei.expense_category_id
     WHERE ei.expense_id = ANY($1::uuid[])`,
    [expenseIds]
  );

  const itemsByExpense = new Map<string, typeof expenseItems>();
  for (const item of expenseItems) {
    const list = itemsByExpense.get(item.expense_id) ?? [];
    list.push(item);
    itemsByExpense.set(item.expense_id, list);
  }

  const rows = [
    ["Date", "Expense", "Status", "Supplier", "Category", "Description", "Payment", "Total"],
    ...expenses.map((expense) => {
      const items = itemsByExpense.get(expense.id) ?? [];
      return [
        dateToDateOnly(expense.business_date),
        expense.expense_number,
        expense.status,
        expense.supplier_name ?? "",
        items.map((item) => item.category_name).join("; "),
        items.map((item) => item.description).join("; "),
        expense.payment_method_name,
        expense.total_minor.toString()
      ];
    })
  ];

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function defaultReportDates(today: string): {
  startDate: string;
  endDate: string;
} {
  const start = addDays(new Date(`${today}T00:00:00.000Z`), -29);
  return { startDate: dateToDateOnly(start), endDate: today };
}
