import { pool, query, transaction } from "../../lib/db.js";
import { BadRequestError, NotFoundError, ConflictError } from "../../lib/errors.js";
import { lineTotalMinor } from "@rbm/shared";
import { refreshLowStockNotifications } from "../inventory/inventory.service.js";
import { nextDocumentNumber } from "../../lib/sequence.js";

type AuditMeta = { ip?: string; userAgent?: string };

// Helper: Convert pg result values to BigInt safely
const toBigInt = (val: any): bigint => {
  if (val === null || val === undefined) return 0n;
  if (typeof val === "bigint") return val;
  if (typeof val === "string") {
    const n = BigInt(val);
    return isNaN(n) ? 0n : n;
  }
  return BigInt(val);
};

// SQL Queries (parameterized to prevent SQL injection)
const SALES_BY_RESTAURANT = `
  SELECT id, transaction_number, source, status, occurred_at, business_date,
         currency, subtotal_minor, total_minor, notes, recorded_by_user_id, created_at
  FROM sales
  WHERE restaurant_id = $1
`;

const SALE_BY_ID = `
  SELECT * FROM sales WHERE id = $1
`;

const CREATE_SALE = `
  INSERT INTO sales (restaurant_id, transaction_number, source, status, occurred_at,
                     business_date, currency, subtotal_minor, total_minor, notes,
                     recorded_by_user_id, client_id)
  VALUES ($1, $2, $3, 'COMPLETED', $4, $5, $6, $7, $8, $9, $10, $11)
  RETURNING *
`;

const UPDATE_SALE_VOID = `
  UPDATE sales SET status = $1, voided_at = $2, void_reason = $3 WHERE id = $4
`;

const COUNT_SALES = `
  SELECT COUNT(*)::int as total FROM sales WHERE restaurant_id = $1
`;

const GET_PAYMENT_METHODS = `
  SELECT id, key, name FROM payment_method WHERE is_active = true AND (restaurant_id IS NULL OR restaurant_id = $1)
`;

const GET_PRODUCT_BY_ID = `
  SELECT id, name, selling_price_minor, is_recipe_based FROM products WHERE id = $1 AND restaurant_id = $2 AND status = 'ACTIVE'
`;

const GET_INVENTORY_ITEM = `
  SELECT id, current_quantity, name, unit FROM inventory_items WHERE id = $1 AND restaurant_id = $2
`;

const UPDATE_INVENTORY_QUANTITY = `
  UPDATE inventory_items SET current_quantity = $1 WHERE id = $2 AND restaurant_id = $3
`;

const GET_CUSTOMER_BY_ID = `
  SELECT id, name FROM customers WHERE id = $1 AND restaurant_id = $2
`;

const GET_STOCK_MOVEMENTS = `
  SELECT * FROM stock_movements WHERE restaurant_id = $1 AND reference_id = $2 ORDER BY occurred_at DESC
`;

const INSERT_STOCK_MOVEMENT = `
  INSERT INTO stock_movements (restaurant_id, inventory_item_id, type, quantity_delta, unit_cost_minor, value_minor, occurred_at, business_date, recorded_by_user_id, reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;

const GET_SALE_ITEMS = `
  SELECT * FROM sale_items WHERE sale_id = $1
`;

const INSERT_STOCK_MOVEMENT_RETURN = `
  INSERT INTO stock_movements (restaurant_id, inventory_item_id, type, quantity_delta, unit_cost_minor, value_minor, occurred_at, business_date, recorded_by_user_id, reference_type, reference_id, reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
`;

function serializeSale(sale: any) {
  return {
    id: sale.id,
    transactionNumber: sale.transaction_number,
    source: sale.source,
    status: sale.status,
    occurredAt: sale.occurredAt?.toISOString() || new Date().toISOString(),
    businessDate: sale.business_date?.toString() || new Date().toISOString().split('T')[0],
    currency: sale.currency || "MWK",
    subtotalMinor: toBigInt(sale.subtotal_minor),
    totalMinor: toBigInt(sale.total_minor),
    notes: sale.notes,
    customer: sale.customer,
    recordedBy: sale.recorded_by_user_id,
    voidedAt: sale.voidedAt?.toISOString() || null,
    voidReason: sale.void_reason,
    items: (sale.items || []).map((item: any) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      quantity: item.quantity !== undefined ? item.quantity.toFixed(4) : "0",
      unitPriceMinor: toBigInt(item.unit_price_minor),
      lineTotalMinor: toBigInt(item.line_total_minor),
      costOfGoodsMinor: item.cost_of_goods_minor != null ? toBigInt(item.cost_of_goods_minor) : 0n,
      notes: item.notes
    })),
    payments: (sale.payments || []).map((payment: any) => ({
      id: payment.id,
      paymentMethodId: payment.payment_method_id,
      paymentMethodKey: payment.payment_method?.key || "",
      paymentMethodName: payment.payment_method?.name || "",
      amountMinor: toBigInt(payment.amount_minor)
    }))
  };
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
  const params: any[] = [restaurantId];
  let whereClause = "WHERE restaurant_id = $1";
  let paramIndex = 2;

  if (query.status) {
    whereClause += ` AND status = $${paramIndex}`;
    params.push(query.status);
    paramIndex++;
  }

  if (query.source) {
    whereClause += ` AND source = $${paramIndex}`;
    params.push(query.source);
    paramIndex++;
  }

  if (query.startDate || query.endDate) {
    whereClause += ` AND occurred_at >= $${paramIndex}`;
    params.push(query.startDate || "1900-01-01");
    paramIndex++;
    if (query.endDate) {
      whereClause += ` AND occurred_at <= $${paramIndex}`;
      params.push(query.endDate);
      paramIndex++;
    }
  }

  // Count total
  const [{ count }] = await pool.query(
    `SELECT COUNT(*)::int as total FROM sales ${whereClause}`,
    params
  );
  const total = count || 0;

  // Add pagination params
  params.push(query.pageSize, (query.page - 1) * query.pageSize);

  // Fetch page
  const { rows } = await pool.query(
    `SELECT * FROM sales ${whereClause} ORDER BY occurred_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    items: rows.map(serializeSale),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getSale(restaurantId: string, saleId: string) {
  const { rows } = await pool.query(SALE_BY_ID, [saleId]);

  if (rows.length === 0) throw new NotFoundError("The sale was not found");
  return serializeSale(rows[0]);
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
  const result = await transaction(async (client) => {
    // 1. Check for existing sale with same clientId
    if (input.clientId) {
      const { rows: existing } = await client.query(
        `SELECT * FROM sales WHERE restaurant_id = $1 AND client_id = $2`,
        [restaurantId, input.clientId]
      );
      if (existing.length > 0) {
        return { success: true, sale: serializeSale(existing[0]) };
      }
    }

    // 2. Validate restaurant exists
    const { rows: restaurant } = await client.query(
      `SELECT id, timezone, currency FROM restaurants WHERE id = $1`,
      [restaurantId]
    );
    if (restaurant.length === 0) throw new NotFoundError("Restaurant not found");
    const restaurantData = restaurant[0];

    // 3. Parse occurredAt and calculate business date
    const occurredAt = new Date(input.occurredAt);
    const businessDate = occurredAt.toISOString().split('T')[0];

    // 4. Validate payment methods
    const methodIds = [...new Set(input.payments.map((payment) => payment.paymentMethodId))];
    const { rows: methods } = await client.query(GET_PAYMENT_METHODS, [restaurantId]);
    const validMethodIds = new Set(methods.map((m: any) => m.id));
    const allMethodsValid = methodIds.every(id => validMethodIds.has(id));
    if (!allMethodsValid) throw new NotFoundError("A payment method was not found");

    // 5. Validate customer if provided
    if (input.customerId) {
      const { rows: customer } = await client.query(
        `SELECT id, name FROM customers WHERE id = $1 AND restaurant_id = $2`,
        [input.customerId, restaurantId]
      );
      if (customer.length === 0) throw new NotFoundError("The customer was not found");
    }

    // 6. Process items and calculate subtotal
    const preparedItems: any[] = [];
    let subtotal = 0n;

    for (const item of input.items) {
      // Validate product exists and get price
      let productId = item.productId;
      let unitPriceMinor = toBigInt(item.unitPriceMinor);
      let productName = item.productName;

      if (item.productId) {
        const { rows: product } = await client.query(
          `SELECT id, name, selling_price_minor, is_recipe_based FROM products WHERE id = $1 AND restaurant_id = $2 AND status = 'ACTIVE'`,
          [item.productId, restaurantId]
        );
        if (product.length === 0) throw new NotFoundError("Product not found");
        const productData = product[0];
        productName = productData.name;
        unitPriceMinor = toBigInt(productData.selling_price_minor);
        productId = productData.id;
      } else if (unitPriceMinor <= 0n) {
        throw new BadRequestError("A custom item must have a positive price");
      }

      const quantity = toBigInt(item.quantity);
      if (quantity <= 0n) throw new BadRequestError("Sale quantities must be greater than zero");

      const lineTotal = lineTotalMinor(item.quantity, unitPriceMinor);
      subtotal += lineTotal;

      preparedItems.push({
        productId,
        productName,
        quantity: item.quantity,
        unitPriceMinor,
        lineTotalMinor: lineTotal,
        costOfGoodsMinor: 0n,
        notes: item.notes
      });
    }

    // 7. Validate subtotal
    if (subtotal <= 0n) throw new BadRequestError("The sale total must be greater than zero");

    // 8. Validate payments match subtotal
    const paid = input.payments.reduce((sum, p) => sum + toBigInt(p.amountMinor), 0n);
    if (paid !== subtotal) {
      throw new BadRequestError(
        "Payments must equal the sale total",
        { expectedMinor: subtotal.toString(), receivedMinor: paid.toString() }
      );
    }

    // 8. Create sale (INSERT with RETURNING)
    const transactionNumber = await nextDocumentNumber(client, restaurantId, "SALE", businessDate);

    const { rows: newSale } = await client.query(CREATE_SALE, [
      restaurantId,
      transactionNumber,
      input.source,
      occurredAt,
      businessDate,
      "MWK",
      subtotal,
      subtotal,
      input.notes,
      actorUserId,
      input.clientId
    ]);

    const saleId = newSale.id;

    // 9. Insert sale items
    for (const item of preparedItems) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, product_name, quantity,
                                 unit_price_minor, line_total_minor, cost_of_goods_minor, recipe_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          saleId,
          item.productId,
          item.productName,
          item.quantity,
          item.unitPriceMinor,
          item.lineTotalMinor,
          item.costOfGoodsMinor,
          null,
          item.notes
        ]
      );
    }

    // 10. Insert payments
    for (const payment of input.payments) {
      await client.query(
        `INSERT INTO sale_payments (sale_id, payment_method_id, amount_minor) VALUES ($1, $2, $3)`,
        [saleId, payment.paymentMethodId, toBigInt(payment.amountMinor)]
      );
    }

    // 11. Update inventory - deduct stock
    for (const item of preparedItems) {
      if (item.productId) {
        const { rows: inv } = await client.query(
          `SELECT id, current_quantity, name, unit FROM inventory_items WHERE id = $1 AND restaurant_id = $2`,
          [item.productId, restaurantId]
        );
        if (inv.length > 0 && inv[0].current_quantity !== undefined) {
          const currentQty = toBigInt(inv[0].current_quantity);
          const newQty = currentQty - toBigInt(item.quantity);
          await client.query(
            `UPDATE inventory_items SET current_quantity = $1 WHERE id = $2 AND restaurant_id = $3`,
            [newQty >= 0n ? newQty : 0n, item.productId, restaurantId]
          );
        }
      }
    }

    // 12. Create stock movements for consumption
    for (const item of preparedItems) {
      if (item.productId && item.quantity) {
        const { rows: inv } = await client.query(
          `SELECT id, current_quantity, name, unit, average_cost_minor_per_unit FROM inventory_items WHERE id = $1 AND restaurant_id = $2`,
          [item.productId, restaurantId]
        );
        if (inv.length > 0 && inv[0].current_quantity !== undefined) {
          const currentQty = toBigInt(inv[0].current_quantity);
          const newQty = currentQty - toBigInt(item.quantity);

          await client.query(INSERT_STOCK_MOVEMENT, [
            restaurantId,
            item.productId,
            "CONSUMPTION",
            item.quantity,
            inv[0].average_cost_minor_per_unit || 0n,
            toBigInt(item.quantity) * (inv[0].average_cost_minor_per_unit || 0n),
            occurredAt,
            businessDate,
            actorUserId,
            "SALE",
            saleId,
            `Sale ${transactionNumber}`
          ]);
        }
      }
    }

    // 13. Record audit
    await client.query(
      `INSERT INTO audit_log (restaurant_id, actor_user_id, action, entity_type, entity_id, before, after, ip, user_agent, created_at)
       VALUES ($1, $2, 'SALE_RECORDED', 'Sale', $3, $4, $5, $6, $7, NOW())`,
      [restaurantId, actorUserId, saleId,
        JSON.stringify({ transactionNumber, totalMinor: subtotal.toString(), source: input.source }),
        null,
        JSON.stringify({ transactionNumber, totalMinor: subtotal.toString(), source: input.source }),
        meta.ip, meta.userAgent]
    );

    return { success: true, sale: serializeSale(newSale) };
  });

  refreshLowStockNotifications(restaurantId);
  return result;
}

export async function voidSale(
  restaurantId: string,
  actorUserId: string,
  saleId: string,
  reason: string,
  meta: AuditMeta
) {
  const result = await transaction(async (client) => {
    // 1. Get sale details
    const { rows: sale } = await client.query(SALE_BY_ID, [saleId]);
    if (sale.length === 0) throw new NotFoundError("Sale not found");
    if (sale[0].status === "VOIDED") throw new BadRequestError("Sale already voided");

    const saleData = sale[0];

    // 2. Restock inventory - return consumed items
    const { rows: stockMovements } = await client.query(GET_STOCK_MOVEMENTS, [restaurantId, saleId]);

    for (const movement of stockMovements) {
      // quantity_delta is negative (consumption), so we need to add it back (positive)
      const restoredQty = toBigInt(movement.quantity_delta) * -1n; // Reverse the consumption
      const itemId = movement.inventory_item_id;

      // Update inventory quantity - add back the consumed amount
      if (itemId) {
        const { rows: inv } = await client.query(
          `SELECT id, current_quantity, name FROM inventory_items WHERE id = $1 AND restaurant_id = $2`,
          [itemId, restaurantId]
        );
        if (inv.length > 0 && inv[0].current_quantity !== undefined) {
          const currentQty = toBigInt(inv[0].current_quantity);
          await client.query(
            `UPDATE inventory_items SET current_quantity = $1 WHERE id = $2 AND restaurant_id = $3`,
            [currentQty + restoredQty, itemId, restaurantId]
          );
        }
      }

      // Create return stock movement (positive quantity_delta means return)
      await client.query(INSERT_STOCK_MOVEMENT_RETURN, [
        restaurantId,
        itemId,
        "RETURN",
        restoredQty,  // positive = returning stock
        movement.unit_cost_minor || 0n,
        movement.value_minor || 0n,
        new Date(),
        saleData.business_date,
        actorUserId,
        "RETURN",
        saleId,
        `Sale ${saleData.transaction_number} voided`
      ]);
    }

    // 3. Update sale status to VOIDED
    await client.query(UPDATE_SALE_VOID, ["VOIDED", new Date(), reason, saleId]);

    // 4. Record audit
    await client.query(
      `INSERT INTO audit_log (restaurant_id, actor_user_id, action, entity_type, entity_id, before, after, ip, user_agent, created_at)
       VALUES ($1, $2, 'SALE_VOIDED', 'Sale', $3, $4, $5, $6, $7, NOW())`,
      [restaurantId, actorUserId, saleId,
        JSON.stringify({ status: saleData.status, totalMinor: toBigInt(saleData.total_minor).toString() }),
        JSON.stringify({ status: "VOIDED", reason }),
        meta.ip, meta.userAgent]
    );

    return getSale(restaurantId, saleId);
  });

  return result;
}