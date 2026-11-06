import { recordAudit } from "../../lib/audit.js";
import {
  businessDateFrom,
  dateOnlyToDate,
  dateToDateOnly
} from "../../lib/business-date.js";
import { assertDayOpen } from "../../lib/day-lock.js";
import { query, transaction } from "../../lib/db.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { nextDocumentNumber } from "../../lib/sequence.js";

type AuditMeta = { ip?: string; userAgent?: string };

type OwnerTransactionRow = {
  id: string;
  type: string;
  status: string;
  amount_minor: string;
  occurred_at: Date;
  business_date: string;
  currency: string;
  description: string;
  recorded_by_name: string;
  voided_at: Date | null;
  void_reason: string | null;
};

const OWNER_TRANSACTION_SELECT = `
  SELECT ot.id, ot.type, ot.status, ot.amount_minor, ot.occurred_at,
         ot.business_date, ot.currency, ot.description,
         u.full_name AS recorded_by_name,
         ot.voided_at, ot.void_reason
  FROM owner_transactions ot
  JOIN users u ON u.id = ot.recorded_by_user_id
`;

function serializeOwnerTransaction(record: OwnerTransactionRow) {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    amountMinor: record.amount_minor.toString(),
    occurredAt: record.occurred_at.toISOString(),
    businessDate: dateToDateOnly(record.business_date),
    currency: record.currency,
    description: record.description,
    recordedBy: record.recorded_by_name,
    voidedAt: record.voided_at ? record.voided_at.toISOString() : null,
    voidReason: record.void_reason
  };
}

export async function listOwnerTransactions(
  restaurantId: string,
  filters: {
    page: number;
    pageSize: number;
    type?: "WITHDRAWAL" | "CONTRIBUTION";
    status?: "ACTIVE" | "VOIDED";
    startDate?: string;
    endDate?: string;
  }
) {
  const conditions = ["ot.restaurant_id = $1"];
  const params: unknown[] = [restaurantId];

  if (filters.type) {
    params.push(filters.type);
    conditions.push(`ot.type = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`ot.status = $${params.length}`);
  }
  if (filters.startDate) {
    params.push(dateToDateOnly(dateOnlyToDate(filters.startDate)));
    conditions.push(`ot.business_date >= $${params.length}`);
  }
  if (filters.endDate) {
    params.push(dateToDateOnly(dateOnlyToDate(filters.endDate)));
    conditions.push(`ot.business_date <= $${params.length}`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const offset = (filters.page - 1) * filters.pageSize;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    query<OwnerTransactionRow>(
      `${OWNER_TRANSACTION_SELECT} ${where} ORDER BY ot.occurred_at DESC LIMIT $${
        params.length + 1
      } OFFSET $${params.length + 2}`,
      [...params, filters.pageSize, offset]
    ),
    query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM owner_transactions ot ${where}`,
      params
    )
  ]);

  return {
    items: rows.map(serializeOwnerTransaction),
    total: Number(countRows[0]?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize
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
    const { rows } = await query<OwnerTransactionRow>(
      `${OWNER_TRANSACTION_SELECT} WHERE ot.restaurant_id = $1 AND ot.client_id = $2`,
      [restaurantId, input.clientId]
    );
    if (rows[0]) {
      return serializeOwnerTransaction(rows[0]);
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

  const record = await transaction(async (client) => {
    await assertDayOpen(client, restaurantId, businessDate);

    const number = await nextDocumentNumber(
      client,
      restaurantId,
      "OWNER_TRANSACTION",
      businessDate
    );

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO owner_transactions
         (id, restaurant_id, type, status, amount_minor, occurred_at,
          business_date, currency, description, recorded_by_user_id,
          client_id, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'ACTIVE', $3, $4,
          $5, $6, $7, $8,
          $9, NOW(), NOW())
       RETURNING id`,
      [
        restaurantId,
        input.type,
        input.amountMinor.toString(),
        occurredAt,
        businessDate,
        restaurant.currency,
        `${number} ${input.description}`,
        actorUserId,
        input.clientId ?? null
      ]
    );

    const createdId = rows[0]?.id;
    if (!createdId) {
      throw new BadRequestError("The owner transaction could not be recorded");
    }

    const { rows: createdRows } = await client.query<OwnerTransactionRow>(
      `${OWNER_TRANSACTION_SELECT} WHERE ot.id = $1`,
      [createdId]
    );
    const created = createdRows[0];
    if (!created) {
      throw new NotFoundError("The owner transaction was not found");
    }

    await recordAudit(client, {
      restaurantId,
      actorUserId,
      action: `${input.type}_RECORDED`,
      entityType: "OwnerTransaction",
      entityId: created.id,
      after: { amountMinor: input.amountMinor.toString() },
      ...meta
    });

    return created;
  });

  return serializeOwnerTransaction(record);
}

export async function voidOwnerTransaction(
  restaurantId: string,
  actorUserId: string,
  transactionId: string,
  reason: string,
  meta: AuditMeta
) {
  const updated = await transaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      status: string;
      business_date: string;
    }>(
      `SELECT id, status, business_date
       FROM owner_transactions WHERE id = $1 AND restaurant_id = $2`,
      [transactionId, restaurantId]
    );

    const record = rows[0];
    if (!record) {
      throw new NotFoundError("The owner transaction was not found");
    }
    if (record.status === "VOIDED") {
      throw new BadRequestError("This owner transaction is already voided");
    }

    await assertDayOpen(client, restaurantId, record.business_date);

    await client.query(
      `UPDATE owner_transactions
       SET status = 'VOIDED', voided_at = NOW(), voided_by_user_id = $1,
           void_reason = $2, updated_at = NOW()
       WHERE id = $3`,
      [actorUserId, reason, transactionId]
    );

    const { rows: updatedRows } = await client.query<OwnerTransactionRow>(
      `${OWNER_TRANSACTION_SELECT} WHERE ot.id = $1`,
      [transactionId]
    );
    const result = updatedRows[0];
    if (!result) {
      throw new NotFoundError("The owner transaction was not found");
    }

    await recordAudit(client, {
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
  const { rows } = await query<{
    id: string;
    as_of_date: string;
    cash_minor: string;
    bank_minor: string;
    inventory_value_minor: string;
    notes: string | null;
    created_at: Date;
  }>(
    `SELECT id, as_of_date, cash_minor, bank_minor,
            inventory_value_minor, notes, created_at
     FROM opening_balances
     WHERE restaurant_id = $1
     ORDER BY as_of_date DESC
     LIMIT 50`,
    [restaurantId]
  );

  return rows.map((balance) => ({
    id: balance.id,
    asOfDate: dateToDateOnly(balance.as_of_date),
    cashMinor: balance.cash_minor.toString(),
    bankMinor: balance.bank_minor.toString(),
    inventoryValueMinor: balance.inventory_value_minor.toString(),
    notes: balance.notes,
    createdAt: balance.created_at.toISOString()
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
  const asOfDate = dateToDateOnly(dateOnlyToDate(input.asOfDate));

  const { rows } = await query<{
    id: string;
    as_of_date: string;
    cash_minor: string;
    bank_minor: string;
    inventory_value_minor: string;
    notes: string | null;
  }>(
    `INSERT INTO opening_balances
       (id, restaurant_id, as_of_date, cash_minor, bank_minor,
        inventory_value_minor, notes, created_by_user_id, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (restaurant_id, as_of_date) DO UPDATE
       SET cash_minor = EXCLUDED.cash_minor,
           bank_minor = EXCLUDED.bank_minor,
           inventory_value_minor = EXCLUDED.inventory_value_minor,
           notes = EXCLUDED.notes
     RETURNING id, as_of_date, cash_minor, bank_minor,
               inventory_value_minor, notes`,
    [
      restaurantId,
      asOfDate,
      input.cashMinor.toString(),
      input.bankMinor.toString(),
      input.inventoryValueMinor.toString(),
      input.notes ?? null,
      actorUserId
    ]
  );

  const balance = rows[0];
  if (!balance) {
    throw new BadRequestError("The opening balance could not be saved");
  }

  await recordAudit(null, {
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
    asOfDate: dateToDateOnly(balance.as_of_date),
    cashMinor: balance.cash_minor.toString(),
    bankMinor: balance.bank_minor.toString(),
    inventoryValueMinor: balance.inventory_value_minor.toString(),
    notes: balance.notes
  };
}
