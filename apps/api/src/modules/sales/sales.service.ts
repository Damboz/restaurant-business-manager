import { Prisma } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import { businessDateFrom, dateOnlyToDate, dateToDateOnly } from "../../lib/business-date.js";
import { assertDayOpen } from "../../lib/day-lock.js";
import { decimal, roundTo } from "../../lib/decimal.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { getActiveRecipeCost } from "../../lib/recipe-cost.js";
import { nextDocumentNumber } from "../../lib/sequence.js";
import { lineTotalMinor } from "@rbm/shared";
import { refreshLowStockNotifications } from "../inventory/inventory.service.js";

type AuditMeta = { ip?: string; userAgent?: string };

const saleInclude = {
  items: true,
  payments: {
    include: { paymentMethod: { select: { id: true, key: true, name: true } } }
  },
  customer: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, fullName: true } }
} satisfies Prisma.SaleInclude;

type SaleRecord = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

function serializeSale(sale: SaleRecord) {
  return {
    id: sale.id,
    transactionNumber: sale.transactionNumber,
    source: sale.source,
    status: sale.status,
    occurredAt: sale.occurredAt.toISOString(),
    businessDate: dateToDateOnly(sale.businessDate),
    currency: sale.currency,
    subtotalMinor: sale.subtotalMinor.toString(),
    totalMinor: sale.totalMinor.toString(),
    notes: sale.notes,
    customer: sale.customer,
    recordedBy: sale.recordedBy,
    voidedAt: sale.voidedAt?.toISOString() ?? null,
    voidReason: sale.voidReason,
    items: sale.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity.toFixed(4),
      unitPriceMinor: item.unitPriceMinor.toString(),
      lineTotalMinor: item.lineTotalMinor.toString(),
      costOfGoodsMinor: item.costOfGoodsMinor?.toString() ?? null,
      notes: item.notes
    })),
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      paymentMethodId: payment.paymentMethodId,
      paymentMethodKey: payment.paymentMethod.key,
      paymentMethodName: payment.paymentMethod.name,
      amountMinor: payment.amountMinor.toString()
    }))
  };
}

async function loadSale(restaurantId: string, saleId: string): Promise<SaleRecord> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, restaurantId },
    include: saleInclude
  });
  if (!sale) throw new NotFoundError("The sale was not found");
  return sale;
}

export async function listSales(
  restaurantId: string,
  query: {
    page: number;
    pageSize: number;
    startDate?: string;
    endDate?: string;
    status?: "COMPLETED" | "VOIDED";
    source?: "ITEMIZED" | "MANUAL";
  }
) {
  const where: Prisma.SaleWhereInput = {
    restaurantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.startDate || query.endDate
      ? {
          businessDate: {
            ...(query.startDate ? { gte: dateOnlyToDate(query.startDate) } : {}),
            ...(query.endDate ? { lte: dateOnlyToDate(query.endDate) } : {})
          }
        }
      : {})
  };

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: saleInclude
    }),
    prisma.sale.count({ where })
  ]);

  return {
    items: sales.map(serializeSale),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getSale(restaurantId: string, saleId: string) {
  return serializeSale(await loadSale(restaurantId, saleId));
}

type SaleInput = {
  clientId?: string;
  occurredAt: string;
  source: "ITEMIZED" | "MANUAL";
  customerId?: string;
  notes?: string;
  items: Array<{
    productId?: string;
    productName: string;
    quantity: string;
    unitPriceMinor: bigint;
    notes?: string;
  }>;
  payments: Array<{ paymentMethodId: string; amountMinor: bigint }>;
};

export async function createSale(
  restaurantId: string,
  actorUserId: string,
  input: SaleInput,
  meta: AuditMeta
) {
  if (input.clientId) {
    const existing = await prisma.sale.findFirst({
      where: { restaurantId, clientId: input.clientId },
      include: saleInclude
    });
    if (existing) return serializeSale(existing);
  }

  const occurredAt = new Date(input.occurredAt);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { timezone: true, currency: true }
  });
  const businessDate = businessDateFrom(occurredAt, restaurant.timezone);

  let saleId: string;

  try {
    saleId = await prisma.$transaction(
      async (transaction) => {
        await assertDayOpen(transaction, restaurantId, businessDate);

        const methodIds = [...new Set(input.payments.map((payment) => payment.paymentMethodId))];
        const methods = await transaction.paymentMethod.findMany({
          where: {
            id: { in: methodIds },
            isActive: true,
            OR: [{ restaurantId }, { restaurantId: null }]
          },
          select: { id: true }
        });
        if (methods.length !== methodIds.length) {
          throw new NotFoundError("A payment method was not found");
        }

        if (input.customerId) {
          const customer = await transaction.customer.findFirst({
            where: { id: input.customerId, restaurantId },
            select: { id: true }
          });
          if (!customer) throw new NotFoundError("The customer was not found");
        }

        const preparedItems: Array<{
          productId: string | null;
          productName: string;
          quantity: string;
          quantityDecimal: Prisma.Decimal;
          unitPriceMinor: bigint;
          lineTotalMinor: bigint;
          costOfGoodsMinor: bigint | null;
          recipeId: string | null;
          notes?: string;
        }> = [];
        const consumption = new Map<string, Prisma.Decimal>();

        if (input.source === "ITEMIZED") {
          for (const item of input.items) {
            const quantity = decimal(item.quantity);
            if (quantity.lte(0)) {
              throw new BadRequestError("Sale quantities must be greater than zero");
            }

            let productName = item.productName;
            let unitPriceMinor = item.unitPriceMinor;
            let productId: string | null = null;
            let isRecipeBased = false;

            if (item.productId) {
              const product = await transaction.product.findFirst({
                where: { id: item.productId, restaurantId, status: "ACTIVE" },
                select: {
                  id: true,
                  name: true,
                  sellingPriceMinor: true,
                  isRecipeBased: true
                }
              });
              if (!product) throw new NotFoundError("A product was not found");
              productId = product.id;
              productName = product.name;
              unitPriceMinor = product.sellingPriceMinor;
              isRecipeBased = product.isRecipeBased;
            } else if (unitPriceMinor <= 0n) {
              throw new BadRequestError("A custom item must have a positive price");
            }

            const lineTotal = lineTotalMinor(item.quantity, unitPriceMinor);
            let costOfGoods: bigint | null = null;
            let recipeId: string | null = null;

            if (isRecipeBased && productId) {
              const cost = await getActiveRecipeCost(
                transaction,
                restaurantId,
                productId
              );
              if (!cost) {
                throw new BadRequestError(
                  `${productName} has no active recipe and cannot be sold`
                );
              }
              recipeId = cost.recipeId;
              costOfGoods = roundTo(
                decimal(cost.costPerYieldUnitMinor).mul(quantity),
                0
              );

              for (const line of cost.lines) {
                const needed = decimal(line.quantityPerYieldUnit).mul(quantity);
                consumption.set(
                  line.inventoryItemId,
                  (consumption.get(line.inventoryItemId) ?? decimal(0)).plus(needed)
                );
              }
            }

            preparedItems.push({
              productId,
              productName,
              quantity: item.quantity,
              quantityDecimal: quantity,
              unitPriceMinor,
              lineTotalMinor: lineTotal,
              costOfGoodsMinor: costOfGoods,
              recipeId,
              notes: item.notes
            });
          }
        }

        const subtotal =
          input.source === "MANUAL"
            ? input.payments.reduce((sum, payment) => sum + payment.amountMinor, 0n)
            : preparedItems.reduce((sum, item) => sum + item.lineTotalMinor, 0n);

        if (subtotal <= 0n) {
          throw new BadRequestError("The sale total must be greater than zero");
        }

        const paid = input.payments.reduce((sum, payment) => sum + payment.amountMinor, 0n);
        if (paid !== subtotal) {
          throw new BadRequestError("Payments must equal the sale total", {
            expectedMinor: subtotal.toString(),
            receivedMinor: paid.toString()
          });
        }

        for (const [inventoryItemId, needed] of consumption) {
          const item = await transaction.inventoryItem.findFirst({
            where: { id: inventoryItemId, restaurantId },
            select: { id: true, name: true, currentQuantity: true }
          });
          if (!item) throw new NotFoundError("A recipe inventory item was not found");
          if (item.currentQuantity.lt(needed)) {
            throw new BadRequestError(
              `Not enough stock for ${item.name}: ${item.currentQuantity.toFixed(2)} available`
            );
          }
        }

        const transactionNumber = await nextDocumentNumber(
          transaction,
          restaurantId,
          "SALE",
          businessDate
        );

        const sale = await transaction.sale.create({
          data: {
            restaurantId,
            transactionNumber,
            source: input.source,
            occurredAt,
            businessDate,
            currency: restaurant.currency,
            subtotalMinor: subtotal,
            totalMinor: subtotal,
            notes: input.notes,
            customerId: input.customerId,
            recordedByUserId: actorUserId,
            clientId: input.clientId,
            items: {
              create: preparedItems.map((item) => ({
                productId: item.productId ?? undefined,
                productName: item.productName,
                quantity: item.quantityDecimal,
                unitPriceMinor: item.unitPriceMinor,
                lineTotalMinor: item.lineTotalMinor,
                costOfGoodsMinor: item.costOfGoodsMinor ?? undefined,
                recipeId: item.recipeId ?? undefined,
                notes: item.notes
              }))
            },
            payments: {
              create: input.payments.map((payment) => ({
                paymentMethodId: payment.paymentMethodId,
                amountMinor: payment.amountMinor
              }))
            }
          },
          select: { id: true }
        });

        for (const [inventoryItemId, needed] of consumption) {
          const updated = await transaction.inventoryItem.updateMany({
            where: {
              id: inventoryItemId,
              restaurantId,
              currentQuantity: { gte: needed }
            },
            data: { currentQuantity: { decrement: needed } }
          });
          if (updated.count === 0) {
            throw new BadRequestError("Stock changed while the sale was being recorded");
          }

          const item = await transaction.inventoryItem.findUniqueOrThrow({
            where: { id: inventoryItemId },
            select: {
              name: true,
              unit: true,
              currentQuantity: true,
              averageCostMinorPerUnit: true
            }
          });

          await transaction.stockMovement.create({
            data: {
              restaurantId,
              inventoryItemId,
              type: "CONSUMPTION",
              quantityDelta: needed.negated(),
              unitCostMinor: item.averageCostMinorPerUnit,
              valueMinor: roundTo(needed.mul(item.averageCostMinorPerUnit), 0),
              quantityAfter: item.currentQuantity,
              referenceType: "SALE",
              referenceId: sale.id,
              reason: `Sale ${transactionNumber}`,
              occurredAt,
              businessDate,
              recordedByUserId: actorUserId
            }
          });
        }

        await recordAudit(transaction, {
          restaurantId,
          actorUserId,
          action: "SALE_RECORDED",
          entityType: "Sale",
          entityId: sale.id,
          after: {
            transactionNumber,
            totalMinor: subtotal.toString(),
            source: input.source
          },
          ...meta
        });

        return sale.id;
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
  } catch (error) {
    if (
      input.clientId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.sale.findFirst({
        where: { restaurantId, clientId: input.clientId },
        include: saleInclude
      });
      if (existing) return serializeSale(existing);
      throw new ConflictError("The sale was already recorded");
    }
    throw error;
  }

  await refreshLowStockNotifications(restaurantId);
  return serializeSale(await loadSale(restaurantId, saleId));
}

export async function voidSale(
  restaurantId: string,
  actorUserId: string,
  saleId: string,
  reason: string,
  meta: AuditMeta
) {
  await prisma.$transaction(
    async (transaction) => {
      const sale = await transaction.sale.findFirst({
        where: { id: saleId, restaurantId },
        include: { items: true }
      });
      if (!sale) throw new NotFoundError("The sale was not found");
      if (sale.status === "VOIDED") {
        throw new BadRequestError("This sale is already voided");
      }

      await assertDayOpen(transaction, restaurantId, sale.businessDate);

      const movements = await transaction.stockMovement.findMany({
        where: {
          restaurantId,
          referenceType: "SALE",
          referenceId: saleId,
          type: "CONSUMPTION"
        }
      });

      const occurredAt = new Date();
      for (const movement of movements) {
        const restored = movement.quantityDelta.negated();
        const item = await transaction.inventoryItem.update({
          where: { id: movement.inventoryItemId },
          data: { currentQuantity: { increment: restored } },
          select: {
            currentQuantity: true,
            averageCostMinorPerUnit: true,
            name: true,
            unit: true
          }
        });

        await transaction.stockMovement.create({
          data: {
            restaurantId,
            inventoryItemId: movement.inventoryItemId,
            type: "RETURN",
            quantityDelta: restored,
            unitCostMinor: movement.unitCostMinor,
            valueMinor: movement.valueMinor,
            quantityAfter: item.currentQuantity,
            referenceType: "RETURN",
            referenceId: saleId,
            reason: `Sale ${sale.transactionNumber} voided`,
            occurredAt,
            businessDate: sale.businessDate,
            recordedByUserId: actorUserId
          }
        });
      }

      await transaction.sale.update({
        where: { id: saleId },
        data: {
          status: "VOIDED",
          voidedAt: occurredAt,
          voidedByUserId: actorUserId,
          voidReason: reason
        }
      });

      await recordAudit(transaction, {
        restaurantId,
        actorUserId,
        action: "SALE_VOIDED",
        entityType: "Sale",
        entityId: saleId,
        before: { status: sale.status, totalMinor: sale.totalMinor.toString() },
        after: { status: "VOIDED", reason },
        ...meta
      });
    },
    { maxWait: 10_000, timeout: 20_000 }
  );

  return getSale(restaurantId, saleId);
}
