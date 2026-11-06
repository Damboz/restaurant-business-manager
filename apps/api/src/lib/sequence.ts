import { dateToDateOnly } from "./business-date.js";

const PREFIXES: Record<string, string> = {
  SALE: "S",
  EXPENSE: "E",
  STOCK_PURCHASE: "P",
  OWNER_TRANSACTION: "O"
};

export async function nextDocumentNumber(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  restaurantId: string,
  documentType: string,
  businessDate: string | Date
): Promise<string> {
  const dateOnly = dateToDateOnly(businessDate);
  const periodKey = dateOnly.replaceAll("-", "").slice(0, 6);

  const { rows } = await client.query(
    `INSERT INTO document_sequences
       (id, restaurant_id, document_type, period_key, last_number, updated_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, 1, NOW())
     ON CONFLICT (restaurant_id, document_type, period_key)
     DO UPDATE SET last_number = document_sequences.last_number + 1, updated_at = NOW()
     RETURNING last_number`,
    [restaurantId, documentType, periodKey]
  );

  const newNumber = BigInt(String(rows[0]?.last_number ?? "1"));
  const prefix = PREFIXES[documentType] ?? "S";
  const day = dateOnly.replaceAll("-", "");

  return `${prefix}${day}-${newNumber.toString().padStart(4, "0")}`;
}
