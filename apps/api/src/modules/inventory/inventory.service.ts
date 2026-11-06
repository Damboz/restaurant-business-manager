import { lineTotalMinor } from "@rbm/shared";
import type { PoolClient } from "pg";
import { recordAudit } from "../../lib/audit.js";
import {
  businessDateFrom,
  dateToDateOnly,
  todayInTimeZone
} from "../../lib/business-date.js";
import { query, transaction } from "../../lib/db.js";
import { decimal, roundTo } from "../../lib/decimal.js";
import { assertDayOpen } from "../../lib/day-lock.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { nextDocumentNumber } from "../../lib/sequence.js";

type AuditMeta = { ip?: string; userAgent?: string };

function isUnique(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

type InventoryItemRow = {
  id: string;
  name: string;
  unit: string;
  category_id: string;
  category_name: string;
  current_quantity: string;
  minimum_level: string;
  average_cost_minor_per_unit: string;
  is_active: boolean;
  default_supplier_id: string | null;
  supplier_name: string | null;
  last_restocked_at: Date | null;
  updated_at: Date;
};

function jsonItem(item: InventoryItemRow) {
  const currentQuantity = decimal(item.current_quantity);
  const minimumLevel = decimal(item.minimum_level);
  const averageCost = decimal(item.average_cost_minor_per_unit);

  return {
    id: item.id,
    name: item.name,
    unit: item.unit,
    categoryId: item.category_id,
    categoryName: item.category_name,
    currentQuantity: currentQuantity.toFixed(4),
    minimumLevel: minimumLevel.toFixed(4),
    averageCostMinorPerUnit: averageCost.toFixed(6),
    stockValueMinor: roundTo(currentQuantity.mul(averageCost), 0).toString(),
    lowStock: currentQuantity.lte(minimumLevel),
    isActive: item.is_active,
    defaultSupplier:
      item.default_supplier_id && item.supplier_name
        ? { id: item.default_supplier_id, name: item.supplier_name }
        : null,
    lastRestockedAt: item.last_restocked_at?.toISOString() ?? null,
    updatedAt: item.updated_at.toISOString()
  };
}

const INVENTORY_ITEM_SELECT = `
  SELECT ii.id, ii.name, ii.unit, ii.category_id, ic.name AS category_name,
         ii.current_quantity, ii.minimum_level, ii.average_cost_minor_per_unit,
         ii.is_active, ii.default_supplier_id, s.name AS supplier_name,
         ii.last_restocked_at, ii.updated_at
  FROM inventory_items ii
  JOIN inventory_categories ic ON ic.id = ii.category_id
  LEFT JOIN suppliers s ON s.id = ii.default_supplier_id
`;

export async function listInventoryCategories(restaurantId: string) {
  const { rows } = await query<{
    id: string;
    name: string;
    sort_order: number;
    is_active: boolean;
  }>(
    `SELECT id, name, sort_order, is_active
     FROM inventory_categories
     WHERE restaurant_id = $1
     ORDER BY sort_order ASC, name ASC`,
    [restaurantId]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active
  }));
}

export async function createInventoryCategory(
  restaurantId: string,
  actorUserId: string,
  input: { name: string; sortOrder: number; isActive: boolean },
  meta: AuditMeta
) {
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO inventory_categories
         (id, restaurant_id, name, sort_order, is_active, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       RETURNING id`,
      [restaurantId, input.name, input.sortOrder, input.isActive]
    );
    const category = rows[0]!;

    await recordAudit(null, {
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

const CATEGORY_COLUMNS: Record<string, string> = {
  name: "name",
  sortOrder: "sort_order",
  isActive: "is_active"
};

export async function updateInventoryCategory(
  restaurantId: string,
  actorUserId: string,
  categoryId: string,
  input: Record<string, unknown>,
  meta: AuditMeta
) {
  const { rows: existingRows } = await query<{
    id: string;
    name: string;
  }>(
    `SELECT id, name FROM inventory_categories WHERE id = $1 AND restaurant_id = $2`,
    [categoryId, restaurantId]
  );
  const existing = existingRows[0];

  if (!existing) {
    throw new NotFoundError("The inventory category was not found");
  }

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(CATEGORY_COLUMNS)) {
    if (input[key] !== undefined) {
      params.push(input[key]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (assignments.length > 0) {
    params.push(categoryId);
    params.push(restaurantId);

    try {
      await query(
        `UPDATE inventory_categories
         SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE id = $${params.length - 1} AND restaurant_id = $${params.length}`,
        params
      );
    } catch (error) {
      if (isUnique(error)) {
        throw new ConflictError("An inventory category with this name already exists");
      }
      throw error;
    }
  }

  await recordAudit(null, {
    restaurantId,
    actorUserId,
    action: "INVENTORY_CATEGORY_UPDATED",
    entityType: "InventoryCategory",
    entityId: categoryId,
    before: { name: existing.name },
    after: input,
    ...meta
  });

  const { rows } = await query<{
    id: string;
    name: string;
    sort_order: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, sort_order, is_active, created_at, updated_at
     FROM inventory_categories
     WHERE id = $1 AND restaurant_id = $2`,
    [categoryId, restaurantId]
  );
  const category = rows[0]!;

  return {
    id: category.id,
    name: category.name,
    sortOrder: category.sort_order,
    isActive: category.is_active,
    createdAt: category.created_at.toISOString(),
    updatedAt: category.updated_at.toISOString()
  };
}

export async function listInventoryItems(
  restaurantId: string,
  queryInput: {
    page: number;
    pageSize: number;
    search?: string;
    categoryId?: string;
    lowStock: boolean;
    activeOnly: boolean;
  }
) {
  const params: unknown[] = [restaurantId];
  let where = "WHERE ii.restaurant_id = $1";

  if (queryInput.activeOnly) {
    where += " AND ii.is_active = true";
  }

  if (queryInput.categoryId) {
    params.push(queryInput.categoryId);
    where += ` AND ii.category_id = $${params.length}`;
  }

  if (queryInput.search) {
    params.push(`%${queryInput.search}%`);
    where += ` AND ii.name ILIKE $${params.length}`;
  }

  if (queryInput.lowStock) {
    where += " AND ii.current_quantity <= ii.minimum_level";
  }

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const offset = (queryInput.page - 1) * queryInput.pageSize;

  const [itemsResult, countResult] = await Promise.all([
    query<InventoryItemRow>(
      `${INVENTORY_ITEM_SELECT}
       ${where}
       ORDER BY ii.name ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, queryInput.pageSize, offset]
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM inventory_items ii ${where}`,
      params
    )
  ]);

  return {
    items: itemsResult.rows.map(jsonItem),
    total: countResult.rows[0]?.count ?? 0,
    page: queryInput.page,
    pageSize: queryInput.pageSize
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
  const { rows: categories } = await query<{ id: string }>(
    `SELECT id FROM inventory_categories WHERE id = $1 AND restaurant_id = $2`,
    [input.categoryId, restaurantId]
  );

  if (!categories[0]) {
    throw new NotFoundError("The inventory category was not found");
  }

  if (input.defaultSupplierId) {
    const { rows: suppliers } = await query<{ id: string }>(
      `SELECT id FROM suppliers WHERE id = $1 AND restaurant_id = $2`,
      [input.defaultSupplierId, restaurantId]
    );

    if (!suppliers[0]) {
      throw new NotFoundError("The default supplier was not found");
    }
  }

  const openingQuantity = decimal(input.openingQuantity ?? "0");
  const openingCost = decimal(input.openingUnitCostMinor ?? 0n);
  const hasOpeningStock = openingQuantity.gt(0);

  let itemId: string;

  try {
    itemId = await transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO inventory_items
           (id, restaurant_id, category_id, name, unit, minimum_level,
            default_supplier_id, current_quantity, average_cost_minor_per_unit,
            last_restocked_at, is_active, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW())
         RETURNING id`,
        [
          restaurantId,
          input.categoryId,
          input.name,
          input.unit,
          decimal(input.minimumLevel).toFixed(4),
          input.defaultSupplierId ?? null,
          openingQuantity.toFixed(4),
          (hasOpeningStock ? openingCost : decimal(0)).toFixed(6),
          hasOpeningStock ? new Date() : null
        ]
      );
      const item = rows[0]!;

      if (hasOpeningStock) {
        const { rows: restaurants } = await client.query<{ timezone: string }>(
          `SELECT timezone FROM restaurants WHERE id = $1`,
          [restaurantId]
        );
        const businessDate = dateToDateOnly(
          businessDateFrom(new Date(), restaurants[0]!.timezone)
        );

        await client.query(
          `INSERT INTO stock_movements
             (id, restaurant_id, inventory_item_id, type, quantity_delta,
              unit_cost_minor, value_minor, quantity_after, reference_type,
              reference_id, reason, occurred_at, business_date,
              recorded_by_user_id, created_at)
           VALUES
             (gen_random_uuid(), $1, $2, 'OPENING', $3, $4, $5, $6, 'OPENING',
              NULL, $7, NOW(), $8, $9, NOW())`,
          [
            restaurantId,
            item.id,
            openingQuantity.toFixed(4),
            openingCost.toFixed(6),
            roundTo(openingQuantity.mul(openingCost), 0).toString(),
            openingQuantity.toFixed(4),
            "Opening stock",
            businessDate,
            actorUserId
          ]
        );
      }

      return item.id;
    });
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("An inventory item with this name already exists");
    }
    throw error;
  }

  await recordAudit(null, {
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
  const { rows } = await query<InventoryItemRow>(
    `${INVENTORY_ITEM_SELECT}
     WHERE ii.id = $1 AND ii.restaurant_id = $2`,
    [itemId, restaurantId]
  );
  const item = rows[0];

  if (!item) {
    throw new NotFoundError("The inventory item was not found");
  }

  return jsonItem(item);
}

const ITEM_COLUMNS: Record<string, string> = {
  categoryId: "category_id",
  name: "name",
  unit: "unit",
  minimumLevel: "minimum_level",
  defaultSupplierId: "default_supplier_id",
  isActive: "is_active"
};

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
  const { rows: existingRows } = await query<{
    id: string;
    name: string;
    is_active: boolean;
  }>(
    `SELECT id, name, is_active FROM inventory_items WHERE id = $1 AND restaurant_id = $2`,
    [itemId, restaurantId]
  );
  const existing = existingRows[0];

  if (!existing) {
    throw new NotFoundError("The inventory item was not found");
  }

  if (input.categoryId) {
    const { rows: categories } = await query<{ id: string }>(
      `SELECT id FROM inventory_categories WHERE id = $1 AND restaurant_id = $2`,
      [input.categoryId, restaurantId]
    );

    if (!categories[0]) {
      throw new NotFoundError("The inventory category was not found");
    }
  }

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(ITEM_COLUMNS)) {
    const value = input[key as keyof typeof input];

    if (value !== undefined) {
      params.push(
        key === "minimumLevel" ? decimal(value as string).toFixed(4) : value
      );
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (assignments.length > 0) {
    params.push(itemId);
    params.push(restaurantId);

    try {
      await query(
        `UPDATE inventory_items
         SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE id = $${params.length - 1} AND restaurant_id = $${params.length}`,
        params
      );
    } catch (error) {
      if (isUnique(error)) {
        throw new ConflictError("An inventory item with this name already exists");
      }
      throw error;
    }
  }

  await recordAudit(null, {
    restaurantId,
    actorUserId,
    action: "INVENTORY_ITEM_UPDATED",
    entityType: "InventoryItem",
    entityId: itemId,
    before: { name: existing.name, isActive: existing.is_active },
    after: input,
    ...meta
  });

  return getInventoryItem(restaurantId, itemId);
}

export async function listStockMovements(
  restaurantId: string,
  queryInput: {
    page: number;
    pageSize: number;
    inventoryItemId?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
  }
) {
  const params: unknown[] = [restaurantId];
  let where = "WHERE sm.restaurant_id = $1";

  if (queryInput.inventoryItemId) {
    params.push(queryInput.inventoryItemId);
    where += ` AND sm.inventory_item_id = $${params.length}`;
  }

  if (queryInput.type) {
    params.push(queryInput.type);
    where += ` AND sm.type = $${params.length}`;
  }

  if (queryInput.startDate) {
    params.push(queryInput.startDate);
    where += ` AND sm.business_date >= $${params.length}`;
  }

  if (queryInput.endDate) {
    params.push(queryInput.endDate);
    where += ` AND sm.business_date <= $${params.length}`;
  }

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const offset = (queryInput.page - 1) * queryInput.pageSize;

  const [movementsResult, countResult] = await Promise.all([
    query<{
      id: string;
      type: string;
      item_name: string;
      unit: string;
      quantity_delta: string;
      quantity_after: string;
      unit_cost_minor: string;
      value_minor: string;
      reason: string | null;
      reference_type: string;
      reference_id: string | null;
      business_date: string;
      occurred_at: Date;
      full_name: string;
    }>(
      `SELECT sm.id, sm.type, ii.name AS item_name, ii.unit,
              sm.quantity_delta, sm.quantity_after, sm.unit_cost_minor,
              sm.value_minor, sm.reason, sm.reference_type, sm.reference_id,
              sm.business_date, sm.occurred_at, u.full_name
       FROM stock_movements sm
       JOIN inventory_items ii ON ii.id = sm.inventory_item_id
       JOIN users u ON u.id = sm.recorded_by_user_id
       ${where}
       ORDER BY sm.occurred_at DESC, sm.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, queryInput.pageSize, offset]
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM stock_movements sm ${where}`,
      params
    )
  ]);

  return {
    items: movementsResult.rows.map((movement) => ({
      id: movement.id,
      type: movement.type,
      itemName: movement.item_name,
      unit: movement.unit,
      quantityDelta: decimal(movement.quantity_delta).toFixed(4),
      quantityAfter: decimal(movement.quantity_after).toFixed(4),
      unitCostMinor: decimal(movement.unit_cost_minor).toFixed(6),
      valueMinor: movement.value_minor,
      reason: movement.reason,
      referenceType: movement.reference_type,
      referenceId: movement.reference_id,
      businessDate: movement.business_date,
      occurredAt: movement.occurred_at.toISOString(),
      recordedBy: movement.full_name
    })),
    total: countResult.rows[0]?.count ?? 0,
    page: queryInput.page,
    pageSize: queryInput.pageSize
  };
}

async function paymentMethodFor(
  client: PoolClient,
  restaurantId: string,
  paymentMethodId: string
): Promise<{ key: string }> {
  const { rows } = await client.query<{ key: string }>(
    `SELECT key FROM payment_methods
     WHERE id = $1 AND is_active = true AND (restaurant_id = $2 OR restaurant_id IS NULL)`,
    [paymentMethodId, restaurantId]
  );

  if (!rows[0]) {
    throw new NotFoundError("The payment method was not found");
  }

  return rows[0];
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
  const { rows: restaurants } = await query<{ timezone: string }>(
    `SELECT timezone FROM restaurants WHERE id = $1`,
    [restaurantId]
  );

  if (!restaurants[0]) {
    throw new NotFoundError("The restaurant was not found");
  }

  const businessDate = dateToDateOnly(
    businessDateFrom(occurredAt, restaurants[0].timezone)
  );

  const result = await transaction(async (client) => {
    await assertDayOpen(client, restaurantId, businessDate);
    await paymentMethodFor(client, restaurantId, input.paymentMethodId);

    if (input.supplierId) {
      const { rows: suppliers } = await client.query<{ id: string }>(
        `SELECT id FROM suppliers WHERE id = $1 AND restaurant_id = $2`,
        [input.supplierId, restaurantId]
      );

      if (!suppliers[0]) {
        throw new NotFoundError("The supplier was not found");
      }
    }

    const items = [];

    for (const line of input.items) {
      const { rows: inventoryItems } = await client.query<{
        id: string;
        current_quantity: string;
        average_cost_minor_per_unit: string;
      }>(
        `SELECT id, current_quantity, average_cost_minor_per_unit
         FROM inventory_items
         WHERE id = $1 AND restaurant_id = $2 AND is_active = true`,
        [line.inventoryItemId, restaurantId]
      );
      const item = inventoryItems[0];

      if (!item) {
        throw new NotFoundError("An inventory item was not found");
      }

      items.push({
        line,
        item,
        quantity: decimal(line.quantity),
        unitPrice: decimal(line.unitPriceMinor),
        lineTotal: lineTotalMinor(line.quantity, line.unitPriceMinor)
      });
    }

    const total = items.reduce((sum, line) => sum + line.lineTotal, 0n);

    if (total <= 0n) {
      throw new BadRequestError("The purchase total must be greater than zero");
    }

    const purchaseNumber = await nextDocumentNumber(
      client,
      restaurantId,
      "STOCK_PURCHASE",
      businessDate
    );

    const { rows: purchases } = await client.query<{
      id: string;
      purchase_number: string;
    }>(
      `INSERT INTO stock_purchases
         (id, restaurant_id, purchase_number, status, supplier_id,
          payment_method_id, occurred_at, business_date, total_minor, notes,
          recorded_by_user_id, client_id, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'RECEIVED', $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING id, purchase_number`,
      [
        restaurantId,
        purchaseNumber,
        input.supplierId ?? null,
        input.paymentMethodId,
        occurredAt,
        businessDate,
        total.toString(),
        input.notes ?? null,
        actorUserId,
        input.clientId ?? null
      ]
    );
    const purchase = purchases[0]!;

    for (const { line, item, quantity, unitPrice, lineTotal } of items) {
      await client.query(
        `INSERT INTO stock_purchase_items
           (id, stock_purchase_id, inventory_item_id, quantity, unit,
            unit_price_minor, line_total_minor)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [
          purchase.id,
          line.inventoryItemId,
          quantity.toFixed(4),
          line.unit,
          line.unitPriceMinor.toString(),
          lineTotal.toString()
        ]
      );

      const currentQuantity = decimal(item.current_quantity);
      const currentAverage = decimal(item.average_cost_minor_per_unit);
      const newQuantity = currentQuantity.plus(quantity);
      const newAverage = currentQuantity.gt(0)
        ? currentQuantity
            .mul(currentAverage)
            .plus(quantity.mul(unitPrice))
            .div(newQuantity)
            .toDecimalPlaces(6)
        : unitPrice;

      await client.query(
        `UPDATE inventory_items
         SET current_quantity = $1, average_cost_minor_per_unit = $2,
             last_restocked_at = $3, updated_at = NOW()
         WHERE id = $4`,
        [
          newQuantity.toFixed(4),
          newAverage.toFixed(6),
          occurredAt,
          item.id
        ]
      );

      await client.query(
        `INSERT INTO stock_movements
           (id, restaurant_id, inventory_item_id, type, quantity_delta,
            unit_cost_minor, value_minor, quantity_after, reference_type,
            reference_id, occurred_at, business_date, recorded_by_user_id, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, 'PURCHASE', $3, $4, $5, $6,
            'STOCK_PURCHASE', $7, $8, $9, $10, NOW())`,
        [
          restaurantId,
          item.id,
          quantity.toFixed(4),
          unitPrice.toFixed(6),
          lineTotal.toString(),
          newQuantity.toFixed(4),
          purchase.id,
          occurredAt,
          businessDate,
          actorUserId
        ]
      );
    }

    await recordAudit(client, {
      restaurantId,
      actorUserId,
      action: "STOCK_PURCHASE_CREATED",
      entityType: "StockPurchase",
      entityId: purchase.id,
      after: { totalMinor: total.toString() },
      ...meta
    });

    return purchase;
  });

  await refreshLowStockNotifications(restaurantId);

  return getStockPurchase(restaurantId, result.id);
}

export async function listStockPurchases(
  restaurantId: string,
  queryInput: { page: number; pageSize: number; startDate?: string; endDate?: string }
) {
  const params: unknown[] = [restaurantId];
  let where = "WHERE sp.restaurant_id = $1";

  if (queryInput.startDate) {
    params.push(queryInput.startDate);
    where += ` AND sp.business_date >= $${params.length}`;
  }

  if (queryInput.endDate) {
    params.push(queryInput.endDate);
    where += ` AND sp.business_date <= $${params.length}`;
  }

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const offset = (queryInput.page - 1) * queryInput.pageSize;

  const [itemsResult, countResult] = await Promise.all([
    query<{
      id: string;
      purchase_number: string;
      status: string;
      supplier_name: string | null;
      payment_method_name: string;
      total_minor: string;
      item_count: number;
      full_name: string;
      occurred_at: Date;
      business_date: string;
      notes: string | null;
    }>(
      `SELECT sp.id, sp.purchase_number, sp.status, s.name AS supplier_name,
              pm.name AS payment_method_name, sp.total_minor,
              (SELECT COUNT(*)::int FROM stock_purchase_items spi WHERE spi.stock_purchase_id = sp.id) AS item_count,
              u.full_name, sp.occurred_at, sp.business_date, sp.notes
       FROM stock_purchases sp
       LEFT JOIN suppliers s ON s.id = sp.supplier_id
       JOIN payment_methods pm ON pm.id = sp.payment_method_id
       JOIN users u ON u.id = sp.recorded_by_user_id
       ${where}
       ORDER BY sp.occurred_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, queryInput.pageSize, offset]
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM stock_purchases sp ${where}`,
      params
    )
  ]);

  return {
    items: itemsResult.rows.map((purchase) => ({
      id: purchase.id,
      purchaseNumber: purchase.purchase_number,
      status: purchase.status,
      supplierName: purchase.supplier_name,
      paymentMethodName: purchase.payment_method_name,
      totalMinor: purchase.total_minor,
      itemCount: purchase.item_count,
      recordedBy: purchase.full_name,
      occurredAt: purchase.occurred_at.toISOString(),
      businessDate: purchase.business_date,
      notes: purchase.notes
    })),
    total: countResult.rows[0]?.count ?? 0,
    page: queryInput.page,
    pageSize: queryInput.pageSize
  };
}

export async function getStockPurchase(restaurantId: string, purchaseId: string) {
  const { rows: purchases } = await query<{
    id: string;
    purchase_number: string;
    status: string;
    supplier_name: string | null;
    payment_method_name: string;
    total_minor: string;
    notes: string | null;
    occurred_at: Date;
    business_date: string;
    full_name: string;
  }>(
    `SELECT sp.id, sp.purchase_number, sp.status, s.name AS supplier_name,
            pm.name AS payment_method_name, sp.total_minor, sp.notes,
            sp.occurred_at, sp.business_date, u.full_name
     FROM stock_purchases sp
     LEFT JOIN suppliers s ON s.id = sp.supplier_id
     JOIN payment_methods pm ON pm.id = sp.payment_method_id
     JOIN users u ON u.id = sp.recorded_by_user_id
     WHERE sp.id = $1 AND sp.restaurant_id = $2`,
    [purchaseId, restaurantId]
  );
  const purchase = purchases[0];

  if (!purchase) {
    throw new NotFoundError("The stock purchase was not found");
  }

  const { rows: items } = await query<{
    id: string;
    inventory_item_id: string;
    name: string;
    quantity: string;
    unit: string;
    unit_price_minor: string;
    line_total_minor: string;
  }>(
    `SELECT spi.id, spi.inventory_item_id, ii.name, spi.quantity, spi.unit,
            spi.unit_price_minor, spi.line_total_minor
     FROM stock_purchase_items spi
     JOIN inventory_items ii ON ii.id = spi.inventory_item_id
     WHERE spi.stock_purchase_id = $1`,
    [purchaseId]
  );

  return {
    id: purchase.id,
    purchaseNumber: purchase.purchase_number,
    status: purchase.status,
    supplierName: purchase.supplier_name,
    paymentMethodName: purchase.payment_method_name,
    totalMinor: purchase.total_minor,
    notes: purchase.notes,
    occurredAt: purchase.occurred_at.toISOString(),
    businessDate: purchase.business_date,
    recordedBy: purchase.full_name,
    items: items.map((item) => ({
      id: item.id,
      inventoryItemId: item.inventory_item_id,
      name: item.name,
      quantity: decimal(item.quantity).toFixed(4),
      unit: item.unit,
      unitPriceMinor: item.unit_price_minor,
      lineTotalMinor: item.line_total_minor
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
  const { rows: restaurants } = await query<{ timezone: string }>(
    `SELECT timezone FROM restaurants WHERE id = $1`,
    [restaurantId]
  );

  if (!restaurants[0]) {
    throw new NotFoundError("The restaurant was not found");
  }

  const businessDate = dateToDateOnly(
    businessDateFrom(occurredAt, restaurants[0].timezone)
  );

  const movement = await transaction(async (client) => {
    await assertDayOpen(client, restaurantId, businessDate);

    const { rows: inventoryItems } = await client.query<{
      id: string;
      name: string;
      current_quantity: string;
      average_cost_minor_per_unit: string;
    }>(
      `SELECT id, name, current_quantity, average_cost_minor_per_unit
       FROM inventory_items
       WHERE id = $1 AND restaurant_id = $2 AND is_active = true`,
      [input.inventoryItemId, restaurantId]
    );
    const item = inventoryItems[0];

    if (!item) {
      throw new NotFoundError("The inventory item was not found");
    }

    const delta = decimal(input.quantityDelta);
    const averageCost = decimal(item.average_cost_minor_per_unit);
    const newQuantity = decimal(item.current_quantity).plus(delta);

    if (newQuantity.lt(0)) {
      throw new BadRequestError("The adjustment would make stock negative");
    }

    const value = roundTo(delta.mul(averageCost), 0);

    await client.query(
      `UPDATE inventory_items
       SET current_quantity = $1, updated_at = NOW()
       WHERE id = $2`,
      [newQuantity.toFixed(4), item.id]
    );

    const { rows: created } = await client.query<{
      id: string;
      type: string;
      quantity_delta: string;
      quantity_after: string;
      value_minor: string;
    }>(
      `INSERT INTO stock_movements
         (id, restaurant_id, inventory_item_id, type, quantity_delta,
          unit_cost_minor, value_minor, quantity_after, reference_type,
          reason, occurred_at, business_date, recorded_by_user_id, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       RETURNING id, type, quantity_delta, quantity_after, value_minor`,
      [
        restaurantId,
        item.id,
        input.type,
        delta.toFixed(4),
        averageCost.toFixed(6),
        value.toString(),
        newQuantity.toFixed(4),
        input.type,
        input.reason,
        occurredAt,
        businessDate,
        actorUserId
      ]
    );
    const stockMovement = created[0]!;

    await recordAudit(client, {
      restaurantId,
      actorUserId,
      action: "STOCK_ADJUSTED",
      entityType: "StockMovement",
      entityId: stockMovement.id,
      after: {
        item: item.name,
        type: input.type,
        quantityDelta: input.quantityDelta,
        reason: input.reason
      },
      ...meta
    });

    return stockMovement;
  });

  await refreshLowStockNotifications(restaurantId);

  return {
    id: movement.id,
    type: movement.type,
    quantityDelta: decimal(movement.quantity_delta).toFixed(4),
    quantityAfter: decimal(movement.quantity_after).toFixed(4),
    valueMinor: movement.value_minor
  };
}

export async function refreshLowStockNotifications(restaurantId: string): Promise<void> {
  try {
    const { rows: lowStock } = await query<{
      id: string;
      name: string;
      unit: string;
      current_quantity: string;
      minimum_level: string;
    }>(
      `SELECT id, name, unit, current_quantity, minimum_level
       FROM inventory_items
       WHERE restaurant_id = $1 AND is_active = true
         AND current_quantity <= minimum_level`,
      [restaurantId]
    );

    if (lowStock.length === 0) {
      return;
    }

    const { rows: restaurants } = await query<{ timezone: string }>(
      `SELECT timezone FROM restaurants WHERE id = $1`,
      [restaurantId]
    );

    if (!restaurants[0]) {
      return;
    }

    const { rows: recipients } = await query<{ user_id: string }>(
      `SELECT DISTINCT ru.user_id
       FROM restaurant_users ru
       WHERE ru.restaurant_id = $1
         AND ru.status = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1
           FROM restaurant_user_permissions rup
           JOIN permissions p ON p.id = rup.permission_id
           WHERE rup.restaurant_user_id = ru.id
             AND p.key = 'stock.view'
             AND rup.effect = 'DENY'
         )
         AND (
           EXISTS (
             SELECT 1
             FROM role_permissions rp
             JOIN permissions p ON p.id = rp.permission_id
             WHERE rp.role_id = ru.role_id AND p.key = 'stock.view'
           )
           OR EXISTS (
             SELECT 1
             FROM restaurant_user_permissions rup
             JOIN permissions p ON p.id = rup.permission_id
             WHERE rup.restaurant_user_id = ru.id
               AND p.key = 'stock.view'
               AND rup.effect = 'ALLOW'
           )
         )`,
      [restaurantId]
    );

    if (recipients.length === 0) {
      return;
    }

    const today = todayInTimeZone(restaurants[0].timezone);

    for (const item of lowStock) {
      const currentQuantity = decimal(item.current_quantity);

      for (const recipient of recipients) {
        await query(
          `INSERT INTO notifications
             (id, restaurant_id, user_id, type, severity, title_key, body_key,
              params, dedupe_key, created_at)
           VALUES
             (gen_random_uuid(), $1, $2, 'LOW_STOCK', $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
          [
            restaurantId,
            recipient.user_id,
            currentQuantity.isZero() ? "CRITICAL" : "WARNING",
            "notifications.lowStock.title",
            "notifications.lowStock.body",
            JSON.stringify({
              itemName: item.name,
              quantity: currentQuantity.toFixed(2),
              unit: item.unit
            }),
            `low-stock:${item.id}:${today}`
          ]
        );
      }
    }
  } catch {
    // Notifications must never break financial writes.
  }
}
