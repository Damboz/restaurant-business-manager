import { Prisma } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import {
  dateOnlyToDate,
  dateToDateOnly,
  todayInTimeZone
} from "../../lib/business-date.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { summaryForRange } from "../reports/reports.service.js";

type AuditMeta = { ip?: string; userAgent?: string };

async function restaurantTimezone(restaurantId: string): Promise<string> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { timezone: true }
  });
  if (!restaurant) throw new NotFoundError("The restaurant was not found");
  return restaurant.timezone;
}

export async function previewClosing(restaurantId: string, businessDate?: string) {
  const timezone = await restaurantTimezone(restaurantId);
  const date = businessDate ?? todayInTimeZone(timezone);
  const summary = await summaryForRange(restaurantId, date, date);
  const closing = await prisma.dailyClosing.findUnique({
    where: {
      restaurantId_businessDate: {
        restaurantId,
        businessDate: dateOnlyToDate(date)
      }
    }
  });

  return {
    businessDate: date,
    status: closing?.status ?? "OPEN",
    closedAt: closing?.closedAt?.toISOString() ?? null,
    reopenedAt: closing?.reopenedAt?.toISOString() ?? null,
    reopenReason: closing?.reopenReason ?? null,
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
  const date = dateOnlyToDate(businessDate);
  const totals = closingData(summary);

  const closing = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.dailyClosing.findUnique({
      where: { restaurantId_businessDate: { restaurantId, businessDate: date } }
    });

    if (existing?.status === "CLOSED") {
      throw new BadRequestError("This business day is already closed");
    }

    const saved = await transaction.dailyClosing.upsert({
      where: { restaurantId_businessDate: { restaurantId, businessDate: date } },
      create: {
        restaurantId,
        businessDate: date,
        status: "CLOSED",
        ...totals,
        closedByUserId: actorUserId,
        closedAt: new Date()
      },
      update: {
        status: "CLOSED",
        ...totals,
        closedByUserId: actorUserId,
        closedAt: new Date(),
        reopenedByUserId: null,
        reopenedAt: null,
        reopenReason: null
      }
    });

    await recordAudit(transaction, {
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
  const date = dateOnlyToDate(businessDate);

  const closing = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.dailyClosing.findUnique({
      where: { restaurantId_businessDate: { restaurantId, businessDate: date } }
    });
    if (!existing) throw new NotFoundError("This business day has not been closed");
    if (existing.status !== "CLOSED") {
      throw new BadRequestError("This business day is already open");
    }

    const reopened = await transaction.dailyClosing.update({
      where: { id: existing.id },
      data: {
        status: "OPEN",
        reopenedByUserId: actorUserId,
        reopenedAt: new Date(),
        reopenReason: reason
      }
    });

    await recordAudit(transaction, {
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

function serializeClosing(closing: {
  id: string;
  businessDate: Date;
  status: string;
  cashSalesMinor: bigint;
  mobileMoneySalesMinor: bigint;
  bankSalesMinor: bigint;
  otherSalesMinor: bigint;
  manualSalesMinor: bigint;
  totalSalesMinor: bigint;
  cogsMinor: bigint;
  grossProfitMinor: bigint;
  operatingExpensesMinor: bigint;
  netProfitMinor: bigint;
  transactionCount: number;
  closedAt: Date;
  reopenedAt: Date | null;
  reopenReason: string | null;
}) {
  return {
    id: closing.id,
    businessDate: dateToDateOnly(closing.businessDate),
    status: closing.status,
    cashSalesMinor: closing.cashSalesMinor.toString(),
    mobileMoneySalesMinor: closing.mobileMoneySalesMinor.toString(),
    bankSalesMinor: closing.bankSalesMinor.toString(),
    otherSalesMinor: closing.otherSalesMinor.toString(),
    manualSalesMinor: closing.manualSalesMinor.toString(),
    totalSalesMinor: closing.totalSalesMinor.toString(),
    cogsMinor: closing.cogsMinor.toString(),
    grossProfitMinor: closing.grossProfitMinor.toString(),
    operatingExpensesMinor: closing.operatingExpensesMinor.toString(),
    netProfitMinor: closing.netProfitMinor.toString(),
    transactionCount: closing.transactionCount,
    closedAt: closing.closedAt.toISOString(),
    reopenedAt: closing.reopenedAt?.toISOString() ?? null,
    reopenReason: closing.reopenReason
  };
}

async function createClosingNotification(
  restaurantId: string,
  userId: string,
  businessDate: string,
  netProfitMinor: bigint
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        restaurantId,
        userId,
        type: "DAILY_SUMMARY",
        severity: "INFO",
        titleKey: "notifications.dailySummary.title",
        bodyKey: "notifications.dailySummary.body",
        params: {
          date: businessDate,
          netProfitMinor: netProfitMinor.toString()
        },
        dedupeKey: `daily-summary:${businessDate}`
      }
    });
  } catch {
    // A duplicate or notification failure must not reopen a successful close.
  }
}

export async function listClosings(
  restaurantId: string,
  query: {
    page: number;
    pageSize: number;
    startDate?: string;
    endDate?: string;
    status?: "OPEN" | "CLOSED";
  }
) {
  const where: Prisma.DailyClosingWhereInput = {
    restaurantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.startDate || query.endDate
      ? {
          businessDate: {
            ...(query.startDate ? { gte: dateOnlyToDate(query.startDate) } : {}),
            ...(query.endDate ? { lte: dateOnlyToDate(query.endDate) } : {})
          }
        }
      : {})
  };

  const [items, total] = await Promise.all([
    prisma.dailyClosing.findMany({
      where,
      orderBy: { businessDate: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    }),
    prisma.dailyClosing.count({ where })
  ]);

  return {
    items: items.map(serializeClosing),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}
