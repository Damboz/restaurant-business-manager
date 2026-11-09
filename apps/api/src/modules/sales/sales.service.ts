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
import { decimal, roundTo, type Decimal } from "../../lib/decimal.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { getActiveRecipeCost } from "../../lib/recipe-cost.js";
import { nextDocumentNumber } from "../../lib/sequence.js";
import { refreshLowStockNotifications } from "../inventory/inventory.service.js";

type AuditMeta = { ip?: string; userAgent?: string };

type SaleRow = {
  id: string;
  transaction_number: string;
  source: "ITEMIZED" | "MANUAL";
  status: "COMPLETED" | "VOIDED";
  occurred_at: Date;
  business_date: string;
  currency: string;
  subtotal_minor: string;
  total_minor: string;
  notes: string | null;
  customer_id: string | null;
  customer_name: string | null;
  recorded_by_user_id: string;
  recorded_by_name: string;
  voided_at: Date | null;
  void_reason: string | null;
};

type SaleItemRow = {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  quantity: string;
  unit_price_minor: string;
  line_total_minor: string;
  cost_of_goods_minor: string | null;
  notes: string | null;
};

type SalePaymentRow = {
  id: string;
  sale_id: string;
  payment_method_id: string;
  payment_method_key: string;
  payment_method_name: string;
  amount_minor: string;
};

const SALE_SELECT = `
  SELECT s.id, s.transaction_number, s.source, s.status, s.occurred_at,
         s.business_date, s.currency, s.subtotal_minor, s.total_minor, s.notes,
         s.customer_id, c.name AS customer_name,
         s.recorded_by_user_id, u.full_name AS recorded_by_name,
         s.voided_at, s.void_reason
  FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id
  JOIN users u ON u.id = s.recorded_by_user_id
`;

function serializeSale(
  sale: SaleRow,
  items: SaleItemRow[],
  payments: SalePaymentRow[]
) {
  return {
    id: sale.id,
    transactionNumber: sale.transaction_number,
    source: sale.source,
    status: sale.status,
    occurredAt: sale.occurred_at.toISOString(),
    businessDate: dateToDateOnly(sale.business_date),
    currency: sale.currency,
    subtotalMinor: sale.subtotal_minor.toString(),
    totalMinor: sale.total_minor.toString(),
    notes: sale.notes,
    customer: sale.customer_id
      ? { id: sale.customer_id, name: sale.customer_name }
      : null,
    recordedBy: { id: sale.recorded_by_user_id, fullName: sale.recorded_by_name },
    voidedAt: sale.voided_at ? sale.voided_at.toISOString() : null,
    voidReason: sale.void_reason,
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      quantity: decimal(item.quantity).toFixed(4),
      unitPriceMinor: item.unit_price_minor.toString(),
      lineTotalMinor: item.line_total_minor.toString(),
      costOfGoodsMinor:
        item.cost_of_goods_minor === null
          ? null
          : item.cost_of_goods_minor.toString(),
      notes: item.notes
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      paymentMethodId: payment.payment_method_id,
      paymentMethodKey: payment.payment_method_key,
      paymentMethodName: payment.payment_method_name,
      amountMinor: payment.amount_minor.toString()
    }))
  };
}

async function hydrateSales(sales: SaleRow[]) {
  if (sales.length === 0) {
    return [];
  }

  const ids = sales.map((sale) => sale.id);

  const [{ rows: items }, { rows: payments }] = await Promise.all([
    query<SaleItemRow>(
      `SELECT id, sale_id, product_id, product_name, quantity,
              unit_price_minor, line_total_minor, cost_of_goods_minor, notes
       FROM sale_items
       WHERE sale_id = ANY($1::uuid[])`,
      [ids]
    ),
    query<SalePaymentRow>(
      `SELECT sp.id, sp.sale_id, sp.payment_method_id,
              pm.key AS payment_method_key, pm.name AS payment_method_name,
              sp.amount_minor
       FROM sale_payments sp
       JOIN payment_methods pm ON pm.id = sp.payment_method_id
       WHERE sp.sale_id = ANY($1::uuid[])`,
      [ids]
    )
  ]);

  const itemsBySale = new Map<string, SaleItemRow[]>();
  for (const item of items) {
    const list = itemsBySale.get(item.sale_id) ?? [];
    list.push(item);
    itemsBySale.set(item.sale_id, list);
  }

  const paymentsBySale = new Map<string, SalePaymentRow[]>();
  for (const payment of payments) {
    const list = paymentsBySale.get(payment.sale_id) ?? [];
    list.push(payment);
    paymentsBySale.set(payment.sale_id, list);
  }

  return sales.map((sale) =>
    serializeSale(
      sale,
      itemsBySale.get(sale.id) ?? [],
      paymentsBySale.get(sale.id) ?? []
    )
  );
}

async function loadSale(restaurantId: string, saleId: string) {
  const { rows } = await query<SaleRow>(
    `${SALE_SELECT} WHERE s.id = $1 AND s.restaurant_id = $2`,
    [saleId, restaurantId]
  );

  if (!rows[0]) {
    throw new NotFoundError("The sale was not found");
  }

  const [serialized] = await hydrateSales(rows);
  return serialized;
}

export async function listSales(
  restaurantId: string,
  filters: {
    page: number;
    pageSize: number;
    startDate?: string;
    endDate?: string;
    status?: "COMPLETED" | "VOIDED";
    source?: "ITEMIZED" | "MANUAL";
  }
) {
  const conditions = ["s.restaurant_id = $1"];
  const params: unknown[] = [restaurantId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`s.status = $${params.length}`);
  }
  if (filters.source) {
    params.push(filters.source);
    conditions.push(`s.source = $${params.length}`);
  }
  if (filters.startDate) {
    params.push(dateToDateOnly(dateOnlyToDate(filters.startDate)));
    conditions.push(`s.business_date >= $${params.length}`);
  }
  if (filters.endDate) {
    params.push(dateToDateOnly(dateOnlyToDate(filters.endDate)));
    conditions.push(`s.business_date <= $${params.length}`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const offset = (filters.page - 1) * filters.pageSize;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    query<SaleRow>(
      `${SALE_SELECT} ${where} ORDER BY s.occurred_at DESC LIMIT $${
        params.length + 1
      } OFFSET $${params.length + 2}`,
      [...params, filters.pageSize, offset]
    ),
    query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM sales s ${where}`,
      params
    )
  ]);

  return {
    items: await hydrateSales(rows),
    total: Number(countRows[0]?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize
  };
}

export async function getSale(restaurantId: string, saleId: string) {
  return loadSale(restaurantId, saleId);
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

type PreparedItem = {
  productId: string | null;
  productName: string;
  quantity: string;
  quantityDecimal: Decimal;
  unitPriceMinor: bigint;
  lineTotalMinor: bigint;
  costOfGoodsMinor: bigint | null;
  recipeId: string | null;
  notes?: string;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

export async function createSale(
  restaurantId: string,
  actorUserId: string,
  input: SaleInput,
  meta: AuditMeta
) {
  if (input.clientId) {
    const { rows } = await query<SaleRow>(
      `${SALE_SELECT} WHERE s.restaurant_id = $1 AND s.client_id = $2`,
      [restaurantId, input.clientId]
    );
    if (rows[0]) {
      const [serialized] = await hydrateSales(rows);
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

  let saleId: string;

  try {
    saleId = await transaction(async (client) => {
      await assertDayOpen(client, restaurantId, businessDate);

      const methodIds = [
        ...new Set(input.payments.map((payment) => payment.paymentMethodId))
      ];
      const { rows: methods } = await client.query<{ id: string }>(
        `SELECT id FROM payment_methods
         WHERE id = ANY($1::uuid[]) AND is_active = true
           AND (restaurant_id = $2 OR restaurant_id IS NULL)`,
        [methodIds, restaurantId]
      );
      if (methods.length !== methodIds.length) {
        throw new NotFoundError("A payment method was not found");
      }

      if (input.customerId) {
        const { rows: customers } = await client.query<{ id: string }>(
          "SELECT id FROM customers WHERE id = $1 AND restaurant_id = $2",
          [input.customerId, restaurantId]
        );
        if (!customers[0]) {
          throw new NotFoundError("The customer was not found");
        }
      }

      const preparedItems: PreparedItem[] = [];
      const consumption = new Map<string, Decimal>();

      if (input.source === "ITEMIZED") {
        for (const item of input.items) {
          const quantityDecimal = decimal(item.quantity);
          if (quantityDecimal.lte(0)) {
            throw new BadRequestError(
              "Sale quantities must be greater than zero"
            );
          }

          let productName = item.productName;
          let unitPriceMinor = item.unitPriceMinor;
          let productId: string | null = null;
          let isRecipeBased = false;

          if (item.productId) {
            const { rows: products } = await client.query<{
              id: string;
              name: string;
              selling_price_minor: string;
              is_recipe_based: boolean;
            }>(
              `SELECT id, name, selling_price_minor, is_recipe_based
               FROM products
               WHERE id = $1 AND restaurant_id = $2 AND status = 'ACTIVE'`,
              [item.productId, restaurantId]
            );
            const product = products[0];
            if (!product) {
              throw new NotFoundError("A product was not found");
            }
            productId = product.id;
            productName = product.name;
            unitPriceMinor = BigInt(product.selling_price_minor);
            isRecipeBased = product.is_recipe_based;
          } else if (unitPriceMinor <= 0n) {
            throw new BadRequestError("A custom item must have a positive price");
          }

          const lineTotal = lineTotalMinor(item.quantity, unitPriceMinor);
          let costOfGoods: bigint | null = null;
          let recipeId: string | null = null;

          if (isRecipeBased && productId) {
            const cost = await getActiveRecipeCost(
              client,
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
              decimal(cost.costPerYieldUnitMinor).mul(quantityDecimal),
              0
            );

            for (const line of cost.lines) {
              const needed = decimal(line.quantityPerYieldUnit).mul(
                quantityDecimal
              );
              consumption.set(
                line.inventoryItemId,
                (consumption.get(line.inventoryItemId) ?? decimal(0)).plus(
                  needed
                )
              );
            }
          }

          preparedItems.push({
            productId,
            productName,
            quantity: item.quantity,
            quantityDecimal,
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

      const paid = input.payments.reduce(
        (sum, payment) => sum + payment.amountMinor,
        0n
      );
      if (paid !== subtotal) {
        throw new BadRequestError("Payments must equal the sale total", {
          expectedMinor: subtotal.toString(),
          receivedMinor: paid.toString()
        });
      }

      if (consumption.size > 0) {
        const inventoryIds = [...consumption.keys()];
        const { rows: stockRows } = await client.query<{
          id: string;
          name: string;
          current_quantity: string;
        }>(
          `SELECT id, name, current_quantity FROM inventory_items
           WHERE id = ANY($1::uuid[]) AND restaurant_id = $2`,
          [inventoryIds, restaurantId]
        );
        const stockById = new Map(stockRows.map((row) => [row.id, row]));

        for (const [inventoryItemId, needed] of consumption) {
          const stock = stockById.get(inventoryItemId);
          if (!stock) {
            throw new NotFoundError("A recipe inventory item was not found");
          }
          const available = decimal(stock.current_quantity);
          if (available.lt(needed)) {
            throw new BadRequestError(
              `Not enough stock for ${stock.name}: ${available.toFixed(2)} available`
            );
          }
        }
      }

      const transactionNumber = await nextDocumentNumber(
        client,
        restaurantId,
        "SALE",
        businessDate
      );

      const { rows: saleRows } = await client.query<{ id: string }>(
        `INSERT INTO sales
           (id, restaurant_id, transaction_number, source, status,
            occurred_at, business_date, currency, subtotal_minor, total_minor,
            notes, customer_id, recorded_by_user_id, client_id, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, 'COMPLETED',
            $4, $5, $6, $7, $8,
            $9, $10, $11, $12, NOW(), NOW())
         RETURNING id`,
        [
          restaurantId,
          transactionNumber,
          input.source,
          occurredAt,
          businessDate,
          restaurant.currency,
          subtotal.toString(),
          subtotal.toString(),
          input.notes ?? null,
          input.customerId ?? null,
          actorUserId,
          input.clientId ?? null
        ]
      );

      const sale = saleRows[0];
      if (!sale) {
        throw new ConflictError("The sale could not be recorded");
      }

      for (const item of preparedItems) {
        await client.query(
          `INSERT INTO sale_items
             (id, sale_id, product_id, product_name, quantity,
              unit_price_minor, line_total_minor, cost_of_goods_minor, recipe_id, notes)
           VALUES
             (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            sale.id,
            item.productId,
            item.productName,
            item.quantityDecimal.toFixed(4),
            item.unitPriceMinor.toString(),
            item.lineTotalMinor.toString(),
            item.costOfGoodsMinor?.toString() ?? null,
            item.recipeId,
            item.notes ?? null
          ]
        );
      }

      for (const payment of input.payments) {
        await client.query(
          `INSERT INTO sale_payments
             (id, sale_id, payment_method_id, amount_minor)
           VALUES (gen_random_uuid(), $1, $2, $3)`,
          [sale.id, payment.paymentMethodId, payment.amountMinor.toString()]
        );
      }

      for (const [inventoryItemId, needed] of consumption) {
        const { rows: updatedRows } = await client.query<{
          name: string;
          unit: string;
          current_quantity: string;
          average_cost_minor_per_unit: string;
        }>(
          `UPDATE inventory_items
           SET current_quantity = current_quantity - $1,
               updated_at = NOW()
           WHERE id = $2 AND restaurant_id = $3 AND current_quantity >= $1
           RETURNING name, unit, current_quantity, average_cost_minor_per_unit`,
          [needed.toFixed(4), inventoryItemId, restaurantId]
        );

        const updated = updatedRows[0];
        if (!updated) {
          throw new BadRequestError(
            "Stock changed while the sale was being recorded"
          );
        }

        const averageCost = decimal(updated.average_cost_minor_per_unit);

        await client.query(
          `INSERT INTO stock_movements
             (id, restaurant_id, inventory_item_id, type, quantity_delta,
              unit_cost_minor, value_minor, quantity_after, reference_type,
              reference_id, reason, occurred_at, business_date,
              recorded_by_user_id, created_at)
           VALUES
             (gen_random_uuid(), $1, $2, 'CONSUMPTION', $3,
              $4, $5, $6, 'SALE',
              $7, $8, $9, $10,
              $11, NOW())`,
          [
            restaurantId,
            inventoryItemId,
            needed.mul(-1n).toFixed(4),
            averageCost.toFixed(6),
            roundTo(needed.mul(averageCost), 0).toString(),
            decimal(updated.current_quantity).toFixed(4),
            sale.id,
            `Sale ${transactionNumber}`,
            occurredAt,
            businessDate,
            actorUserId
          ]
        );
      }

      await recordAudit(client, {
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
    });
  } catch (error) {
    if (input.clientId && isUniqueViolation(error)) {
      const { rows } = await query<SaleRow>(
        `${SALE_SELECT} WHERE s.restaurant_id = $1 AND s.client_id = $2`,
        [restaurantId, input.clientId]
      );
      if (rows[0]) {
        const [serialized] = await hydrateSales(rows);
        return serialized;
      }
      throw new ConflictError("The sale was already recorded");
    }
    throw error;
  }

  await refreshLowStockNotifications(restaurantId);
  return loadSale(restaurantId, saleId);
}

export async function voidSale(
  restaurantId: string,
  actorUserId: string,
  saleId: string,
  reason: string,
  meta: AuditMeta
) {
  let voidedBusinessDate: string | null = null;

  await transaction(async (client) => {
    const { rows: saleRows } = await client.query<{
      id: string;
      transaction_number: string;
      status: string;
      total_minor: string;
      business_date: string;
    }>(
      `SELECT id, transaction_number, status, total_minor, business_date
       FROM sales WHERE id = $1 AND restaurant_id = $2`,
      [saleId, restaurantId]
    );

    const sale = saleRows[0];
    if (!sale) {
      throw new NotFoundError("The sale was not found");
    }
    if (sale.status === "VOIDED") {
      throw new BadRequestError("This sale is already voided");
    }

    voidedBusinessDate = sale.business_date;

    const { rows: movements } = await client.query<{
      id: string;
      inventory_item_id: string;
      quantity_delta: string;
      unit_cost_minor: string;
      value_minor: string;
    }>(
      `SELECT id, inventory_item_id, quantity_delta, unit_cost_minor, value_minor
       FROM stock_movements
       WHERE restaurant_id = $1 AND reference_type = 'SALE'
         AND reference_id = $2 AND type = 'CONSUMPTION'`,
      [restaurantId, saleId]
    );

    const occurredAt = new Date();

    for (const movement of movements) {
      const restored = decimal(movement.quantity_delta).mul(-1n);

      const { rows: itemRows } = await client.query<{
        current_quantity: string;
      }>(
        `UPDATE inventory_items
         SET current_quantity = current_quantity + $1, updated_at = NOW()
         WHERE id = $2
         RETURNING current_quantity`,
        [restored.toFixed(4), movement.inventory_item_id]
      );

      const item = itemRows[0];
      if (!item) {
        throw new NotFoundError("A recipe inventory item was not found");
      }

      await client.query(
        `INSERT INTO stock_movements
           (id, restaurant_id, inventory_item_id, type, quantity_delta,
            unit_cost_minor, value_minor, quantity_after, reference_type,
            reference_id, reason, occurred_at, business_date,
            recorded_by_user_id, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, 'RETURN', $3,
            $4, $5, $6, 'RETURN',
            $7, $8, $9, $10,
            $11, NOW())`,
        [
          restaurantId,
          movement.inventory_item_id,
          restored.toFixed(4),
          movement.unit_cost_minor,
          movement.value_minor,
          decimal(item.current_quantity).toFixed(4),
          saleId,
          `Sale ${sale.transaction_number} voided`,
          occurredAt,
          sale.business_date,
          actorUserId
        ]
      );
    }

    await client.query(
      `UPDATE sales
       SET status = 'VOIDED', voided_at = $1, voided_by_user_id = $2,
           void_reason = $3, updated_at = NOW()
       WHERE id = $4`,
      [occurredAt, actorUserId, reason, saleId]
    );

    await recordAudit(client, {
      restaurantId,
      actorUserId,
      action: "SALE_VOIDED",
      entityType: "Sale",
      entityId: saleId,
      before: { status: sale.status, totalMinor: sale.total_minor.toString() },
      after: { status: "VOIDED", reason },
      ...meta
    });
  });

  if (voidedBusinessDate) {
    await refreshClosedDaySnapshot(restaurantId, voidedBusinessDate);
  }

  return getSale(restaurantId, saleId);
}
