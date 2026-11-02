import { Prisma } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import { businessDateFrom, dateOnlyToDate, dateToDateOnly } from "../../lib/business-date.js";
import { assertDayOpen } from "../../lib/day-lock.js";
import { decimal } from "../../lib/decimal.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { nextDocumentNumber } from "../../lib/sequence.js";
import { lineTotalMinor } from "@rbm/shared";

type AuditMeta = { ip?: string; userAgent?: string };

const expenseInclude = {
  items: { include: { category: { select: { id: true, name: true, key: true } } } },
  supplier: { select: { id: true, name: true } },
  paymentMethod: { select: { id: true, key: true, name: true } },
  recordedBy: { select: { id: true, fullName: true } }
} satisfies Prisma.ExpenseInclude;

type ExpenseRecord = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

function serializeExpense(expense: ExpenseRecord) {
  return {
    id: expense.id,
    expenseNumber: expense.expenseNumber,
    status: expense.status,
    occurredAt: expense.occurredAt.toISOString(),
    businessDate: dateToDateOnly(expense.businessDate),
    currency: expense.currency,
    totalMinor: expense.totalMinor.toString(),
    notes: expense.notes,
    supplier: expense.supplier,
    paymentMethod: expense.paymentMethod,
    recordedBy: expense.recordedBy,
    voidedAt: expense.voidedAt?.toISOString() ?? null,
    voidReason: expense.voidReason,
    items: expense.items.map((item) => ({
      id: item.id,
      categoryId: item.expenseCategoryId,
      categoryName: item.category.name,
      categoryKey: item.category.key,
      description: item.description,
      quantity: item.quantity.toFixed(4),
      unit: item.unit,
      unitPriceMinor: item.unitPriceMinor.toString(),
      lineTotalMinor: item.lineTotalMinor.toString()
    }))
  };
}

async function loadExpense(restaurantId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, restaurantId },
    include: expenseInclude
  });
  if (!expense) throw new NotFoundError("The expense was not found");
  return serializeExpense(expense);
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
  const where: Prisma.ExpenseWhereInput = {
    restaurantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.categoryId ? { items: { some: { expenseCategoryId: query.categoryId } } } : {}),
    ...(query.startDate || query.endDate
      ? {
          businessDate: {
            ...(query.startDate ? { gte: dateOnlyToDate(query.startDate) } : {}),
            ...(query.endDate ? { lte: dateOnlyToDate(query.endDate) } : {})
          }
        }
      : {})
  };

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: expenseInclude
    }),
    prisma.expense.count({ where })
  ]);

  return {
    items: expenses.map(serializeExpense),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getExpense(restaurantId: string, expenseId: string) {
  return loadExpense(restaurantId, expenseId);
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
    const existing = await prisma.expense.findFirst({
      where: { restaurantId, clientId: input.clientId },
      include: expenseInclude
    });
    if (existing) return serializeExpense(existing);
  }

  const occurredAt = new Date(input.occurredAt);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { timezone: true, currency: true }
  });
  const businessDate = businessDateFrom(occurredAt, restaurant.timezone);

  const expenseId = await prisma.$transaction(
    async (transaction) => {
      await assertDayOpen(transaction, restaurantId, businessDate);

      const method = await transaction.paymentMethod.findFirst({
        where: {
          id: input.paymentMethodId,
          isActive: true,
          OR: [{ restaurantId }, { restaurantId: null }]
        },
        select: { id: true }
      });
      if (!method) throw new NotFoundError("The payment method was not found");

      if (input.supplierId) {
        const supplier = await transaction.supplier.findFirst({
          where: { id: input.supplierId, restaurantId },
          select: { id: true }
        });
        if (!supplier) throw new NotFoundError("The supplier was not found");
      }

      const categoryIds = [...new Set(input.items.map((item) => item.categoryId))];
      const categories = await transaction.expenseCategory.findMany({
        where: {
          id: { in: categoryIds },
          isActive: true,
          OR: [{ restaurantId }, { restaurantId: null }]
        },
        select: { id: true }
      });
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
        transaction,
        restaurantId,
        "EXPENSE",
        businessDate
      );

      const expense = await transaction.expense.create({
        data: {
          restaurantId,
          expenseNumber,
          occurredAt,
          businessDate,
          currency: restaurant.currency,
          supplierId: input.supplierId,
          paymentMethodId: input.paymentMethodId,
          totalMinor: total,
          notes: input.notes,
          recordedByUserId: actorUserId,
          clientId: input.clientId,
          items: {
            create: lines.map((item) => ({
              expenseCategoryId: item.categoryId,
              description: item.description,
              quantity: decimal(item.quantity),
              unit: item.unit,
              unitPriceMinor: item.unitPriceMinor,
              lineTotalMinor: item.lineTotalMinor
            }))
          }
        },
        select: { id: true }
      });

      await recordAudit(transaction, {
        restaurantId,
        actorUserId,
        action: "EXPENSE_CREATED",
        entityType: "Expense",
        entityId: expense.id,
        after: { expenseNumber, totalMinor: total.toString() },
        ...meta
      });

      return expense.id;
    },
    { maxWait: 10_000, timeout: 20_000 }
  );

  return loadExpense(restaurantId, expenseId);
}

export async function voidExpense(
  restaurantId: string,
  actorUserId: string,
  expenseId: string,
  reason: string,
  meta: AuditMeta
) {
  await prisma.$transaction(async (transaction) => {
    const expense = await transaction.expense.findFirst({
      where: { id: expenseId, restaurantId }
    });
    if (!expense) throw new NotFoundError("The expense was not found");
    if (expense.status === "VOIDED") {
      throw new BadRequestError("This expense is already voided");
    }

    await assertDayOpen(transaction, restaurantId, expense.businessDate);

    await transaction.expense.update({
      where: { id: expenseId },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedByUserId: actorUserId,
        voidReason: reason
      }
    });

    await recordAudit(transaction, {
      restaurantId,
      actorUserId,
      action: "EXPENSE_VOIDED",
      entityType: "Expense",
      entityId: expenseId,
      before: { status: "ACTIVE", totalMinor: expense.totalMinor.toString() },
      after: { status: "VOIDED", reason },
      ...meta
    });
  });

  return loadExpense(restaurantId, expenseId);
}

export async function listExpenseCategories(restaurantId: string) {
  return prisma.expenseCategory.findMany({
    where: {
      isActive: true,
      OR: [{ restaurantId }, { restaurantId: null }]
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, key: true, name: true, isOperating: true, isSystem: true }
  });
}
