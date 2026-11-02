import { prisma } from "../../lib/prisma.js";
import {
  addDays,
  dateToDateOnly,
  rangeDates,
  todayInTimeZone
} from "../../lib/business-date.js";
import { roundTo } from "../../lib/decimal.js";

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
  const dateFilter = { gte: start, lt: endExclusive };
  const completedSale = { restaurantId, status: "COMPLETED" as const, businessDate: dateFilter };
  const activeExpense = { restaurantId, status: "ACTIVE" as const, businessDate: dateFilter };

  const [
    salesAggregate,
    cogsAggregate,
    expenseAggregate,
    operatingAggregate,
    payments,
    expenseByCategory,
    topProducts,
    salesByDate,
    expensesByDate,
    ownerTransactions,
    inventoryItems
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: completedSale,
      _sum: { totalMinor: true, subtotalMinor: true },
      _count: { _all: true }
    }),
    prisma.saleItem.aggregate({
      where: {
        sale: completedSale,
        costOfGoodsMinor: { not: null }
      },
      _sum: { costOfGoodsMinor: true }
    }),
    prisma.expense.aggregate({
      where: activeExpense,
      _sum: { totalMinor: true },
      _count: { _all: true }
    }),
    prisma.expenseItem.aggregate({
      where: {
        expense: activeExpense,
        category: { isOperating: true }
      },
      _sum: { lineTotalMinor: true }
    }),
    prisma.salePayment.groupBy({
      by: ["paymentMethodId"],
      where: { sale: completedSale },
      _sum: { amountMinor: true }
    }),
    prisma.expenseItem.groupBy({
      by: ["expenseCategoryId"],
      where: { expense: activeExpense },
      _sum: { lineTotalMinor: true }
    }),
    prisma.saleItem.groupBy({
      by: ["productName"],
      where: { sale: completedSale },
      _sum: { lineTotalMinor: true, quantity: true },
      _count: { _all: true },
      orderBy: { _sum: { lineTotalMinor: "desc" } },
      take: 10
    }),
    prisma.sale.findMany({
      where: completedSale,
      select: { businessDate: true, totalMinor: true, source: true }
    }),
    prisma.expense.findMany({
      where: activeExpense,
      select: { businessDate: true, totalMinor: true }
    }),
    prisma.ownerTransaction.findMany({
      where: {
        restaurantId,
        status: "ACTIVE",
        businessDate: dateFilter
      },
      select: { type: true, amountMinor: true }
    }),
    prisma.inventoryItem.findMany({
      where: { restaurantId, isActive: true },
      select: {
        id: true,
        name: true,
        unit: true,
        currentQuantity: true,
        minimumLevel: true,
        averageCostMinorPerUnit: true
      }
    })
  ]);

  const methodIds = payments.map((payment) => payment.paymentMethodId);
  const methods = await prisma.paymentMethod.findMany({
    where: { id: { in: methodIds } },
    select: { id: true, key: true, name: true }
  });
  const methodMap = new Map(methods.map((method) => [method.id, method]));

  const paymentBreakdown = { cash: 0n, mobile: 0n, bank: 0n, other: 0n };
  for (const payment of payments) {
    const method = methodMap.get(payment.paymentMethodId);
    if (!method) continue;
    paymentBreakdown[splitPaymentKey(method.key)] += payment._sum.amountMinor ?? 0n;
  }

  const categoryIds = expenseByCategory.map((item) => item.expenseCategoryId);
  const categories = await prisma.expenseCategory.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true }
  });
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));

  const dailyMap = new Map<
    string,
    { date: string; salesMinor: bigint; expensesMinor: bigint; transactions: number }
  >();
  for (const sale of salesByDate) {
    const key = dateToDateOnly(sale.businessDate);
    const entry =
      dailyMap.get(key) ?? { date: key, salesMinor: 0n, expensesMinor: 0n, transactions: 0 };
    entry.salesMinor += sale.totalMinor;
    entry.transactions += 1;
    dailyMap.set(key, entry);
  }
  for (const expense of expensesByDate) {
    const key = dateToDateOnly(expense.businessDate);
    const entry =
      dailyMap.get(key) ?? { date: key, salesMinor: 0n, expensesMinor: 0n, transactions: 0 };
    entry.expensesMinor += expense.totalMinor;
    dailyMap.set(key, entry);
  }

  const totalSales = salesAggregate._sum.totalMinor ?? 0n;
  const cogs = cogsAggregate._sum.costOfGoodsMinor ?? 0n;
  const totalExpenses = expenseAggregate._sum.totalMinor ?? 0n;
  const operatingExpenses = operatingAggregate._sum.lineTotalMinor ?? 0n;
  const grossProfit = totalSales - cogs;
  const netProfit = grossProfit - operatingExpenses;

  const inventoryValue = inventoryItems.reduce(
    (sum, item) =>
      sum + roundTo(item.currentQuantity.mul(item.averageCostMinorPerUnit), 0),
    0n
  );
  const lowStockItems = inventoryItems.filter((item) =>
    item.currentQuantity.lte(item.minimumLevel)
  );

  return {
    startDate,
    endDate,
    sales: {
      totalMinor: totalSales.toString(),
      transactionCount: salesAggregate._count._all,
      averageTransactionMinor: (
        salesAggregate._count._all === 0
          ? 0n
          : totalSales / BigInt(salesAggregate._count._all)
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
      recordCount: expenseAggregate._count._all,
      byCategory: expenseByCategory
        .map((item) => ({
          categoryId: item.expenseCategoryId,
          categoryName: categoryMap.get(item.expenseCategoryId) ?? "Unknown",
          totalMinor: (item._sum.lineTotalMinor ?? 0n).toString()
        }))
        .sort((a, b) => Number(BigInt(b.totalMinor) - BigInt(a.totalMinor)))
    },
    cogsMinor: cogs.toString(),
    grossProfitMinor: grossProfit.toString(),
    netProfitMinor: netProfit.toString(),
    topProducts: topProducts.map((product) => ({
      name: product.productName,
      revenueMinor: (product._sum.lineTotalMinor ?? 0n).toString(),
      quantity: (product._sum.quantity ?? 0).toString(),
      saleCount: product._count._all
    })),
    ownerTransactions: {
      withdrawalsMinor: ownerTransactions
        .filter((item) => item.type === "WITHDRAWAL")
        .reduce((sum, item) => sum + item.amountMinor, 0n)
        .toString(),
      contributionsMinor: ownerTransactions
        .filter((item) => item.type === "CONTRIBUTION")
        .reduce((sum, item) => sum + item.amountMinor, 0n)
        .toString()
    },
    inventory: {
      valueMinor: inventoryValue.toString(),
      lowStockCount: lowStockItems.length,
      lowStockItems: lowStockItems.slice(0, 20).map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        currentQuantity: item.currentQuantity.toFixed(4),
        minimumLevel: item.minimumLevel.toFixed(4)
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
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { timezone: true, currency: true }
  });
  const today = todayInTimeZone(restaurant.timezone);
  const summary = await summaryForRange(restaurantId, today, today);
  const closing = await prisma.dailyClosing.findUnique({
    where: {
      restaurantId_businessDate: {
        restaurantId,
        businessDate: new Date(`${today}T00:00:00.000Z`)
      }
    },
    select: { status: true, closedAt: true }
  });

  const firstOfMonth = `${today.slice(0, 8)}01`;
  const month = await summaryForRange(restaurantId, firstOfMonth, today);

  return {
    today,
    currency: restaurant.currency,
    closing: {
      status: closing?.status ?? "OPEN",
      closedAt: closing?.closedAt?.toISOString() ?? null
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
    const items = await prisma.inventoryItem.findMany({
      where: { restaurantId },
      orderBy: { name: "asc" },
      include: { category: { select: { name: true } } }
    });
    const rows = [
      ["Name", "Category", "Unit", "Quantity", "Minimum", "Average cost", "Stock value"],
      ...items.map((item) => [
        item.name,
        item.category.name,
        item.unit,
        item.currentQuantity.toFixed(4),
        item.minimumLevel.toFixed(4),
        item.averageCostMinorPerUnit.toFixed(2),
        roundTo(item.currentQuantity.mul(item.averageCostMinorPerUnit), 0).toString()
      ])
    ];
    return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }

  const dateFilter = { gte: start, lt: endExclusive };

  if (type === "sales") {
    const sales = await prisma.sale.findMany({
      where: { restaurantId, businessDate: dateFilter },
      orderBy: [{ occurredAt: "asc" }],
      include: {
        items: { select: { productName: true, quantity: true, lineTotalMinor: true } },
        payments: { include: { paymentMethod: { select: { name: true } } } }
      }
    });
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
        dateToDateOnly(sale.businessDate),
        sale.transactionNumber,
        sale.source,
        sale.status,
        sale.items.map((item) => `${item.productName} x${item.quantity.toFixed(2)}`).join("; "),
        sale.payments.map((payment) => payment.paymentMethod.name).join("; "),
        sale.subtotalMinor.toString(),
        sale.totalMinor.toString()
      ])
    ];
    return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }

  const expenses = await prisma.expense.findMany({
    where: { restaurantId, businessDate: dateFilter },
    orderBy: [{ occurredAt: "asc" }],
    include: {
      supplier: { select: { name: true } },
      paymentMethod: { select: { name: true } },
      items: { include: { category: { select: { name: true } } } }
    }
  });
  const rows = [
    ["Date", "Expense", "Status", "Supplier", "Category", "Description", "Payment", "Total"],
    ...expenses.map((expense) => [
      dateToDateOnly(expense.businessDate),
      expense.expenseNumber,
      expense.status,
      expense.supplier?.name ?? "",
      expense.items.map((item) => item.category.name).join("; "),
      expense.items.map((item) => item.description).join("; "),
      expense.paymentMethod.name,
      expense.totalMinor.toString()
    ])
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function defaultReportDates(today: string): { startDate: string; endDate: string } {
  const start = addDays(new Date(`${today}T00:00:00.000Z`), -29);
  return { startDate: dateToDateOnly(start), endDate: today };
}
