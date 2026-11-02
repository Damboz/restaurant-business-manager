import { Prisma } from "@prisma/client";
import { decimal, roundTo } from "../../lib/decimal.js";
import { ConflictError, NotFoundError, BadRequestError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import {
  businessDateFrom,
  dateOnlyToDate,
  dateToDateOnly,
  todayInTimeZone
} from "../../lib/business-date.js";
import { assertDayOpen } from "../../lib/day-lock.js";
import { nextDocumentNumber } from "../../lib/sequence.js";
import { lineTotalMinor } from "@rbm/shared";

type AuditMeta = { ip?: string; userAgent?: string };

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function jsonItem(item: {
  id: string;
  name: string;
  unit: string;
  currentQuantity: Prisma.Decimal;
  minimumLevel: Prisma.Decimal;
  averageCostMinorPerUnit: Prisma.Decimal;
  isActive: boolean;
  categoryId: string;
  category: { name: string };
  defaultSupplier?: { id: string; name: string } | null;
  lastRestockedAt: Date | null;
  updatedAt: Date;
}) {
  const lowStock = item.currentQuantity.lte(item.minimumLevel);
  return {
    id: item.id,
    name: item.name,
    unit: item.unit,
    categoryId: item.categoryId,
    categoryName: item.category.name,
    currentQuantity: item.currentQuantity.toFixed(4),
    minimumLevel: item.minimumLevel.toFixed(4),
    averageCostMinorPerUnit: item.averageCostMinorPerUnit.toFixed(6),
    stockValueMinor: roundTo(
      item.currentQuantity.mul(item.averageCostMinorPerUnit),
      0
    ).toString(),
    lowStock,
    isActive: item.isActive,
    defaultSupplier: item.defaultSupplier ?? null,
    lastRestockedAt: item.lastRestockedAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString()
  };
}

export async function listInventoryCategories(restaurantId: string) {
  return prisma.inventoryCategory.findMany({
    where: { restaurantId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sortOrder: true, isActive: true }
  });
}

export async function createInventoryCategory(
  restaurantId: string,
  actorUserId: string,
  input: { name: string; sortOrder: number; isActive: boolean },
  meta: AuditMeta
) {
  try {
    const category = await prisma.inventoryCategory.create({
      data: { restaurantId, ...input },
      select: { id: true }
    });
    await recordAudit(prisma, {
      restaurantId,
      actorUserId,
      action: "INVENTORY_CATEGORY_CREATED",
      entityType: "InventoryCategory",
      entityId: category.id,
      after: input,
      ...meta
    });
    return category;
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("An inventory category with this name already exists");
    }
    throw error;
  }
}

export async function updateInventoryCategory(
  restaurantId: string,
  actorUserId: string,
  categoryId: string,
  input: Record<string, unknown>,
  meta: AuditMeta
) {
  const category = await prisma.inventoryCategory.findFirst({
    where: { id: categoryId, restaurantId }
  });
  if (!category) throw new NotFoundError("The inventory category was not found");

  try {
    await prisma.inventoryCategory.update({ where: { id: categoryId }, data: input });
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("An inventory category with this name already exists");
    }
    throw error;
  }

  await recordAudit(prisma, {
    restaurantId,
    actorUserId,
    action: "INVENTORY_CATEGORY_UPDATED",
    entityType: "InventoryCategory",
    entityId: categoryId,
    before: { name: category.name },
    after: input as Prisma.InputJsonValue,
    ...meta
  });

  return prisma.inventoryCategory.findUniqueOrThrow({ where: { id: categoryId } });
}

export async function listInventoryItems(
  restaurantId: string,
  query: {
    page: number;
    pageSize: number;
    search?: string;
    categoryId?: string;
    lowStock: boolean;
    activeOnly: boolean;
  }
) {
  const where: Prisma.InventoryItemWhereInput = {
    restaurantId,
    ...(query.activeOnly ? { isActive: true } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.search
      ? { name: { contains: query.search, mode: "insensitive" } }
      : {})
  };

  const all = await prisma.inventoryItem.findMany({
    where,
    orderBy: [{ name: "asc" }],
    include: {
      category: { select: { name: true } },
      defaultSupplier: { select: { id: true, name: true } }
    }
  });

  const filtered = query.lowStock
    ? all.filter((item) => item.currentQuantity.lte(item.minimumLevel))
    : all;
  const items = filtered.slice(
    (query.page - 1) * query.pageSize,
    query.page * query.pageSize
  );

  return {
    items: items.map(jsonItem),
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function createInventoryItem(
  restaurantId: string,
  actorUserId: string,
  input: {
    categoryId: string;
    name: string;
    unit: string;
    minimumLevel: string;
    defaultSupplierId?: string;
    openingQuantity?: string;
    openingUnitCostMinor?: bigint;
  },
  meta: AuditMeta
) {
  const category = await prisma.inventoryCategory.findFirst({
    where: { id: input.categoryId, restaurantId },
    select: { id: true }
  });
  if (!category) throw new NotFoundError("The inventory category was not found");

  if (input.defaultSupplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: input.defaultSupplierId, restaurantId },
      select: { id: true }
    });
    if (!supplier) throw new NotFoundError("The default supplier was not found");
  }

  const openingQuantity = decimal(input.openingQuantity ?? "0");
  const openingCost = decimal(input.openingUnitCostMinor ?? 0n);

  let itemId: string;

  try {
    itemId = await prisma.$transaction(async (transaction) => {
      const item = await transaction.inventoryItem.create({
        data: {
          restaurantId,
          categoryId: input.categoryId,
          name: input.name,
          unit: input.unit,
          minimumLevel: decimal(input.minimumLevel),
          defaultSupplierId: input.defaultSupplierId,
          currentQuantity: openingQuantity,
          averageCostMinorPerUnit: openingQuantity.gt(0) ? openingCost : decimal(0),
          lastRestockedAt: openingQuantity.gt(0) ? new Date() : null
        },
        select: { id: true }
      });

      if (openingQuantity.gt(0)) {
        const businessDate = businessDateFrom(
          new Date(),
          (
            await transaction.restaurant.findUniqueOrThrow({
              where: { id: restaurantId },
              select: { timezone: true }
            })
          ).timezone
        );

        await transaction.stockMovement.create({
          data: {
            restaurantId,
            inventoryItemId: item.id,
            type: "OPENING",
            quantityDelta: openingQuantity,
            unitCostMinor: openingCost,
            valueMinor: roundTo(openingQuantity.mul(openingCost), 0),
            quantityAfter: openingQuantity,
            referenceType: "OPENING",
            reason: "Opening stock",
            occurredAt: new Date(),
            businessDate,
            recordedByUserId: actorUserId
          }
        });
      }

      return item.id;
    });
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("An inventory item with this name already exists");
    }
    throw error;
  }

  await recordAudit(prisma, {
    restaurantId,
    actorUserId,
    action: "INVENTORY_ITEM_CREATED",
    entityType: "InventoryItem",
    entityId: itemId,
    after: { name: input.name, unit: input.unit },
    ...meta
  });

  return getInventoryItem(restaurantId, itemId);
}

export async function getInventoryItem(restaurantId: string, itemId: string) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, restaurantId },
    include: {
      category: { select: { name: true } },
      defaultSupplier: { select: { id: true, name: true } }
    }
  });
  if (!item) throw new NotFoundError("The inventory item was not found");
  return jsonItem(item);
}

export async function updateInventoryItem(
  restaurantId: string,
  actorUserId: string,
  itemId: string,
  input: {
    categoryId?: string;
    name?: string;
    unit?: string;
    minimumLevel?: string;
    defaultSupplierId?: string | null;
    isActive?: boolean;
  },
  meta: AuditMeta
) {
  const existing = await prisma.inventoryItem.findFirst({
    where: { id: itemId, restaurantId }
  });
  if (!existing) throw new NotFoundError("The inventory item was not found");

  if (input.categoryId) {
    const category = await prisma.inventoryCategory.findFirst({
      where: { id: input.categoryId, restaurantId },
      select: { id: true }
    });
    if (!category) throw new NotFoundError("The inventory category was not found");
  }

  try {
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: {
        ...input,
        minimumLevel:
          input.minimumLevel === undefined ? undefined : decimal(input.minimumLevel)
      }
    });
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("An inventory item with this name already exists");
    }
    throw error;
  }

  await recordAudit(prisma, {
    restaurantId,
    actorUserId,
    action: "INVENTORY_ITEM_UPDATED",
    entityType: "InventoryItem",
    entityId: itemId,
    before: { name: existing.name, isActive: existing.isActive },
    after: input as Prisma.InputJsonValue,
    ...meta
  });

  return getInventoryItem(restaurantId, itemId);
}

export async function listStockMovements(
  restaurantId: string,
  query: {
    page: number;
    pageSize: number;
    inventoryItemId?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
  }
) {
  const where: Prisma.StockMovementWhereInput = {
    restaurantId,
    ...(query.inventoryItemId ? { inventoryItemId: query.inventoryItemId } : {}),
    ...(query.type ? { type: query.type as Prisma.EnumStockMovementTypeFilter["equals"] } : {}),
    ...(query.startDate || query.endDate
      ? {
          businessDate: {
            ...(query.startDate ? { gte: dateOnlyToDate(query.startDate) } : {}),
            ...(query.endDate ? { lte: dateOnlyToDate(query.endDate) } : {})
          }
        }
      : {})
  };

  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        inventoryItem: { select: { name: true, unit: true } },
        recordedBy: { select: { fullName: true } }
      }
    }),
    prisma.stockMovement.count({ where })
  ]);

  return {
    items: movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      itemName: movement.inventoryItem.name,
      unit: movement.inventoryItem.unit,
      quantityDelta: movement.quantityDelta.toFixed(4),
      quantityAfter: movement.quantityAfter.toFixed(4),
      unitCostMinor: movement.unitCostMinor.toFixed(6),
      valueMinor: movement.valueMinor.toString(),
      reason: movement.reason,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      businessDate: dateToDateOnly(movement.businessDate),
      occurredAt: movement.occurredAt.toISOString(),
      recordedBy: movement.recordedBy.fullName
    })),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}

async function paymentMethodFor(
  transaction: Prisma.TransactionClient,
  restaurantId: string,
  paymentMethodId: string
): Promise<{ key: string }> {
  const method = await transaction.paymentMethod.findFirst({
    where: {
      id: paymentMethodId,
      isActive: true,
      OR: [{ restaurantId }, { restaurantId: null }]
    },
    select: { key: true }
  });
  if (!method) throw new NotFoundError("The payment method was not found");
  return method;
}

export async function createStockPurchase(
  restaurantId: string,
  actorUserId: string,
  input: {
    clientId?: string;
    occurredAt: string;
    supplierId?: string;
    paymentMethodId: string;
    notes?: string;
    items: Array<{
      inventoryItemId: string;
      quantity: string;
      unit: string;
      unitPriceMinor: bigint;
    }>;
  },
  meta: AuditMeta
) {
  const occurredAt = new Date(input.occurredAt);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { timezone: true }
  });
  const businessDate = businessDateFrom(occurredAt, restaurant.timezone);

  const result = await prisma.$transaction(
    async (transaction) => {
      await assertDayOpen(transaction, restaurantId, businessDate);
      await paymentMethodFor(transaction, restaurantId, input.paymentMethodId);

      if (input.supplierId) {
        const supplier = await transaction.supplier.findFirst({
          where: { id: input.supplierId, restaurantId },
          select: { id: true }
        });
        if (!supplier) throw new NotFoundError("The supplier was not found");
      }

      const items = await Promise.all(
        input.items.map(async (line) => {
          const item = await transaction.inventoryItem.findFirst({
            where: { id: line.inventoryItemId, restaurantId, isActive: true },
            select: {
              id: true,
              currentQuantity: true,
              averageCostMinorPerUnit: true
            }
          });
          if (!item) throw new NotFoundError("An inventory item was not found");

          const quantity = decimal(line.quantity);
          const unitPrice = decimal(line.unitPriceMinor);
          const lineTotal = lineTotalMinor(line.quantity, line.unitPriceMinor);
          return { line, item, quantity, unitPrice, lineTotal };
        })
      );

      const total = items.reduce((sum, line) => sum + line.lineTotal, 0n);
      if (total <= 0n) throw new BadRequestError("The purchase total must be greater than zero");

      const purchaseNumber = await nextDocumentNumber(
        transaction,
        restaurantId,
        "STOCK_PURCHASE",
        businessDate
      );

      const purchase = await transaction.stockPurchase.create({
        data: {
          restaurantId,
          purchaseNumber,
          supplierId: input.supplierId,
          paymentMethodId: input.paymentMethodId,
          occurredAt,
          businessDate,
          totalMinor: total,
          notes: input.notes,
          recordedByUserId: actorUserId,
          clientId: input.clientId,
          items: {
            create: items.map(({ line, lineTotal }) => ({
              inventoryItemId: line.inventoryItemId,
              quantity: decimal(line.quantity),
              unit: line.unit,
              unitPriceMinor: line.unitPriceMinor,
              lineTotalMinor: lineTotal
            }))
          }
        },
        select: { id: true, purchaseNumber: true }
      });

      for (const { item, quantity, unitPrice, lineTotal } of items) {
        const newQuantity = item.currentQuantity.plus(quantity);
        const newAverage = item.currentQuantity.gt(0)
          ? item.currentQuantity
              .mul(item.averageCostMinorPerUnit)
              .plus(quantity.mul(unitPrice))
              .div(newQuantity)
              .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
          : unitPrice;

        await transaction.inventoryItem.update({
          where: { id: item.id },
          data: {
            currentQuantity: newQuantity,
            averageCostMinorPerUnit: newAverage,
            lastRestockedAt: occurredAt
          }
        });

        await transaction.stockMovement.create({
          data: {
            restaurantId,
            inventoryItemId: item.id,
            type: "PURCHASE",
            quantityDelta: quantity,
            unitCostMinor: unitPrice,
            valueMinor: lineTotal,
            quantityAfter: newQuantity,
            referenceType: "STOCK_PURCHASE",
            referenceId: purchase.id,
            occurredAt,
            businessDate,
            recordedByUserId: actorUserId
          }
        });
      }

      await recordAudit(transaction, {
        restaurantId,
        actorUserId,
        action: "STOCK_PURCHASE_CREATED",
        entityType: "StockPurchase",
        entityId: purchase.id,
        after: { totalMinor: total.toString() },
        ...meta
      });

      return purchase;
    },
    { maxWait: 10_000, timeout: 30_000 }
  );

  await refreshLowStockNotifications(restaurantId);
  return getStockPurchase(restaurantId, result.id);
}

export async function listStockPurchases(
  restaurantId: string,
  query: { page: number; pageSize: number; startDate?: string; endDate?: string }
) {
  const where: Prisma.StockPurchaseWhereInput = {
    restaurantId,
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
    prisma.stockPurchase.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        supplier: { select: { name: true } },
        paymentMethod: { select: { name: true } },
        recordedBy: { select: { fullName: true } },
        _count: { select: { items: true } }
      }
    }),
    prisma.stockPurchase.count({ where })
  ]);

  return {
    items: items.map((purchase) => ({
      id: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      status: purchase.status,
      supplierName: purchase.supplier?.name ?? null,
      paymentMethodName: purchase.paymentMethod.name,
      totalMinor: purchase.totalMinor.toString(),
      itemCount: purchase._count.items,
      recordedBy: purchase.recordedBy.fullName,
      occurredAt: purchase.occurredAt.toISOString(),
      businessDate: dateToDateOnly(purchase.businessDate),
      notes: purchase.notes
    })),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getStockPurchase(restaurantId: string, purchaseId: string) {
  const purchase = await prisma.stockPurchase.findFirst({
    where: { id: purchaseId, restaurantId },
    include: {
      supplier: { select: { name: true } },
      paymentMethod: { select: { name: true } },
      recordedBy: { select: { fullName: true } },
      items: {
        include: {
          inventoryItem: { select: { name: true, unit: true } }
        }
      }
    }
  });
  if (!purchase) throw new NotFoundError("The stock purchase was not found");

  return {
    id: purchase.id,
    purchaseNumber: purchase.purchaseNumber,
    status: purchase.status,
    supplierName: purchase.supplier?.name ?? null,
    paymentMethodName: purchase.paymentMethod.name,
    totalMinor: purchase.totalMinor.toString(),
    notes: purchase.notes,
    occurredAt: purchase.occurredAt.toISOString(),
    businessDate: dateToDateOnly(purchase.businessDate),
    recordedBy: purchase.recordedBy.fullName,
    items: purchase.items.map((item) => ({
      id: item.id,
      inventoryItemId: item.inventoryItemId,
      name: item.inventoryItem.name,
      quantity: item.quantity.toFixed(4),
      unit: item.unit,
      unitPriceMinor: item.unitPriceMinor.toString(),
      lineTotalMinor: item.lineTotalMinor.toString()
    }))
  };
}

export async function createStockAdjustment(
  restaurantId: string,
  actorUserId: string,
  input: {
    inventoryItemId: string;
    occurredAt: string;
    type: "ADJUSTMENT" | "WASTAGE" | "RETURN";
    quantityDelta: string;
    reason: string;
  },
  meta: AuditMeta
) {
  const occurredAt = new Date(input.occurredAt);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { timezone: true }
  });
  const businessDate = businessDateFrom(occurredAt, restaurant.timezone);

  const movement = await prisma.$transaction(
    async (transaction) => {
      await assertDayOpen(transaction, restaurantId, businessDate);

      const item = await transaction.inventoryItem.findFirst({
        where: { id: input.inventoryItemId, restaurantId, isActive: true }
      });
      if (!item) throw new NotFoundError("The inventory item was not found");

      const delta = decimal(input.quantityDelta);
      const newQuantity = item.currentQuantity.plus(delta);
      if (newQuantity.lt(0)) {
        throw new BadRequestError("The adjustment would make stock negative");
      }

      const value = roundTo(delta.mul(item.averageCostMinorPerUnit), 0);

      await transaction.inventoryItem.update({
        where: { id: item.id },
        data: { currentQuantity: newQuantity }
      });

      const created = await transaction.stockMovement.create({
        data: {
          restaurantId,
          inventoryItemId: item.id,
          type: input.type,
          quantityDelta: delta,
          unitCostMinor: item.averageCostMinorPerUnit,
          valueMinor: value,
          quantityAfter: newQuantity,
          referenceType: input.type,
          reason: input.reason,
          occurredAt,
          businessDate,
          recordedByUserId: actorUserId
        }
      });

      await recordAudit(transaction, {
        restaurantId,
        actorUserId,
        action: "STOCK_ADJUSTED",
        entityType: "StockMovement",
        entityId: created.id,
        after: {
          item: item.name,
          type: input.type,
          quantityDelta: input.quantityDelta,
          reason: input.reason
        },
        ...meta
      });

      return created;
    },
    { maxWait: 10_000, timeout: 20_000 }
  );

  await refreshLowStockNotifications(restaurantId);

  return {
    id: movement.id,
    type: movement.type,
    quantityDelta: movement.quantityDelta.toFixed(4),
    quantityAfter: movement.quantityAfter.toFixed(4),
    valueMinor: movement.valueMinor.toString()
  };
}

export async function refreshLowStockNotifications(restaurantId: string): Promise<void> {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { restaurantId, isActive: true },
      select: {
        id: true,
        name: true,
        unit: true,
        currentQuantity: true,
        minimumLevel: true
      }
    });
    const lowStock = items.filter((item) =>
      item.currentQuantity.lte(item.minimumLevel)
    );
    if (lowStock.length === 0) return;

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { timezone: true }
    });
    if (!restaurant) return;

    const members = await prisma.restaurantUser.findMany({
      where: { restaurantId, status: "ACTIVE" },
      select: {
        userId: true,
        role: {
          select: {
            permissions: { select: { permission: { select: { key: true } } } }
          }
        },
        permissionOverrides: {
          select: { effect: true, permission: { select: { key: true } } }
        }
      }
    });

    const recipients = members
      .filter((member) => {
        const base = member.role.permissions.map(({ permission }) => permission.key);
        const overrides = new Map(
          member.permissionOverrides.map((override) => [
            override.permission.key,
            override.effect
          ])
        );
        if (overrides.get("stock.view") === "DENY") return false;
        return base.includes("stock.view") || overrides.get("stock.view") === "ALLOW";
      })
      .map((member) => member.userId);

    if (recipients.length === 0) return;

    const today = todayInTimeZone(restaurant.timezone);
    const data = lowStock.flatMap((item) =>
      recipients.map((userId) => ({
        restaurantId,
        userId,
        type: "LOW_STOCK" as const,
        severity: item.currentQuantity.isZero() ? ("CRITICAL" as const) : ("WARNING" as const),
        titleKey: "notifications.lowStock.title",
        bodyKey: "notifications.lowStock.body",
        params: {
          itemName: item.name,
          quantity: item.currentQuantity.toFixed(2),
          unit: item.unit
        },
        dedupeKey: `low-stock:${item.id}:${today}`
      }))
    );

    await prisma.notification.createMany({ data, skipDuplicates: true });
  } catch {
    // Notifications must never break financial writes.
  }
}
