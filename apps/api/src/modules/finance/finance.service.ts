import { Prisma } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import {
  businessDateFrom,
  dateOnlyToDate,
  dateToDateOnly
} from "../../lib/business-date.js";
import { assertDayOpen } from "../../lib/day-lock.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { nextDocumentNumber } from "../../lib/sequence.js";

type AuditMeta = { ip?: string; userAgent?: string };

function serializeOwnerTransaction(transaction: {
  id: string;
  type: string;
  status: string;
  amountMinor: bigint;
  occurredAt: Date;
  businessDate: Date;
  currency: string;
  description: string;
  recordedBy: { fullName: string };
  voidedAt: Date | null;
  voidReason: string | null;
}) {
  return {
    id: transaction.id,
    type: transaction.type,
    status: transaction.status,
    amountMinor: transaction.amountMinor.toString(),
    occurredAt: transaction.occurredAt.toISOString(),
    businessDate: dateToDateOnly(transaction.businessDate),
    currency: transaction.currency,
    description: transaction.description,
    recordedBy: transaction.recordedBy.fullName,
    voidedAt: transaction.voidedAt?.toISOString() ?? null,
    voidReason: transaction.voidReason
  };
}

export async function listOwnerTransactions(
  restaurantId: string,
  query: {
    page: number;
    pageSize: number;
    type?: "WITHDRAWAL" | "CONTRIBUTION";
    status?: "ACTIVE" | "VOIDED";
    startDate?: string;
    endDate?: string;
  }
) {
  const where: Prisma.OwnerTransactionWhereInput = {
    restaurantId,
    ...(query.type ? { type: query.type } : {}),
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
    prisma.ownerTransaction.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { recordedBy: { select: { fullName: true } } }
    }),
    prisma.ownerTransaction.count({ where })
  ]);

  return {
    items: items.map(serializeOwnerTransaction),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function createOwnerTransaction(
  restaurantId: string,
  actorUserId: string,
  input: {
    clientId?: string;
    type: "WITHDRAWAL" | "CONTRIBUTION";
    amountMinor: bigint;
    occurredAt: string;
    description: string;
  },
  meta: AuditMeta
) {
  if (input.clientId) {
    const existing = await prisma.ownerTransaction.findFirst({
      where: { restaurantId, clientId: input.clientId },
      include: { recordedBy: { select: { fullName: true } } }
    });
    if (existing) return serializeOwnerTransaction(existing);
  }

  const occurredAt = new Date(input.occurredAt);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { timezone: true, currency: true }
  });
  const businessDate = businessDateFrom(occurredAt, restaurant.timezone);

  const created = await prisma.$transaction(async (transaction) => {
    await assertDayOpen(transaction, restaurantId, businessDate);

    const number = await nextDocumentNumber(
      transaction,
      restaurantId,
      "OWNER_TRANSACTION",
      businessDate
    );

    const record = await transaction.ownerTransaction.create({
      data: {
        restaurantId,
        type: input.type,
        amountMinor: input.amountMinor,
        occurredAt,
        businessDate,
        currency: restaurant.currency,
        description: `${number} ${input.description}`,
        recordedByUserId: actorUserId,
        clientId: input.clientId
      },
      include: { recordedBy: { select: { fullName: true } } }
    });

    await recordAudit(transaction, {
      restaurantId,
      actorUserId,
      action: `${input.type}_RECORDED`,
      entityType: "OwnerTransaction",
      entityId: record.id,
      after: { amountMinor: input.amountMinor.toString() },
      ...meta
    });

    return record;
  });

  return serializeOwnerTransaction(created);
}

export async function voidOwnerTransaction(
  restaurantId: string,
  actorUserId: string,
  transactionId: string,
  reason: string,
  meta: AuditMeta
) {
  const updated = await prisma.$transaction(async (transaction) => {
    const record = await transaction.ownerTransaction.findFirst({
      where: { id: transactionId, restaurantId }
    });
    if (!record) throw new NotFoundError("The owner transaction was not found");
    if (record.status === "VOIDED") {
      throw new BadRequestError("This owner transaction is already voided");
    }
    await assertDayOpen(transaction, restaurantId, record.businessDate);

    const result = await transaction.ownerTransaction.update({
      where: { id: transactionId },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedByUserId: actorUserId,
        voidReason: reason
      },
      include: { recordedBy: { select: { fullName: true } } }
    });

    await recordAudit(transaction, {
      restaurantId,
      actorUserId,
      action: "OWNER_TRANSACTION_VOIDED",
      entityType: "OwnerTransaction",
      entityId: transactionId,
      before: { status: "ACTIVE" },
      after: { status: "VOIDED", reason },
      ...meta
    });

    return result;
  });

  return serializeOwnerTransaction(updated);
}

export async function listOpeningBalances(restaurantId: string) {
  const balances = await prisma.openingBalance.findMany({
    where: { restaurantId },
    orderBy: { asOfDate: "desc" },
    take: 50
  });

  return balances.map((balance) => ({
    id: balance.id,
    asOfDate: dateToDateOnly(balance.asOfDate),
    cashMinor: balance.cashMinor.toString(),
    bankMinor: balance.bankMinor.toString(),
    inventoryValueMinor: balance.inventoryValueMinor.toString(),
    notes: balance.notes,
    createdAt: balance.createdAt.toISOString()
  }));
}

export async function upsertOpeningBalance(
  restaurantId: string,
  actorUserId: string,
  input: {
    asOfDate: string;
    cashMinor: bigint;
    bankMinor: bigint;
    inventoryValueMinor: bigint;
    notes?: string;
  },
  meta: AuditMeta
) {
  const asOfDate = dateOnlyToDate(input.asOfDate);

  const balance = await prisma.openingBalance.upsert({
    where: { restaurantId_asOfDate: { restaurantId, asOfDate } },
    create: {
      restaurantId,
      asOfDate,
      cashMinor: input.cashMinor,
      bankMinor: input.bankMinor,
      inventoryValueMinor: input.inventoryValueMinor,
      notes: input.notes,
      createdByUserId: actorUserId
    },
    update: {
      cashMinor: input.cashMinor,
      bankMinor: input.bankMinor,
      inventoryValueMinor: input.inventoryValueMinor,
      notes: input.notes
    }
  });

  await recordAudit(prisma, {
    restaurantId,
    actorUserId,
    action: "OPENING_BALANCE_SET",
    entityType: "OpeningBalance",
    entityId: balance.id,
    after: {
      asOfDate: input.asOfDate,
      cashMinor: input.cashMinor.toString(),
      bankMinor: input.bankMinor.toString(),
      inventoryValueMinor: input.inventoryValueMinor.toString()
    },
    ...meta
  });

  return {
    id: balance.id,
    asOfDate: dateToDateOnly(balance.asOfDate),
    cashMinor: balance.cashMinor.toString(),
    bankMinor: balance.bankMinor.toString(),
    inventoryValueMinor: balance.inventoryValueMinor.toString(),
    notes: balance.notes
  };
}
