import { dateToDateOnly } from "./business-date.js";

const PREFIXES: Record<string, string> = {
  SALE: "S",
  EXPENSE: "E",
  STOCK_PURCHASE: "P",
  OWNER_TRANSACTION: "O"
};

export async function nextDocumentNumber(
  client: any,
  restaurantId: string,
  documentType: string,
  businessDate: string | Date
): Promise<string> {
  const periodKey = dateToDateOnly(businessDate).replaceAll("-", "").slice(0, 6);

  // Check if document_sequences table has an entry for this restaurant/type/period
  const checkKey =
    documentType === "SALE"
      ? "SELECT last_number FROM document_sequences WHERE restaurant_id = $1::uuid AND document_type = 'SALE' AND period_key = $2"
      : documentType === "EXPENSE"
        ? "SELECT last_number FROM document_sequences WHERE restaurant_id = $1::uuid AND document_type = 'EXPENSE' AND period_key = $2"
        : "SELECT last_number FROM document_sequences WHERE restaurant_id = $1::uuid AND document_type = $3 AND period_key = $2";

  const { rows: existing } = await client.query(checkKey, [restaurantId, periodKey, documentType]);

  let newNumber: bigint;

  if (existing.length > 0 && existing[0].last_number !== undefined) {
    newNumber = existing[0].last_number + 1n;
  } else {
    // Insert new sequence
    const insertKey =
      documentType === "SALE"
        ? `INSERT INTO document_sequences (restaurant_id, document_type, period_key, last_number) VALUES ($1::uuid, 'SALE', $2, 1) RETURNING last_number`
        : documentType === "EXPENSE"
          ? `INSERT INTO document_sequences (restaurant_id, document_type, period_key, last_number) VALUES ($1::uuid, 'EXPENSE', $2, 1) RETURNING last_number`
          : `INSERT INTO document_sequences (restaurant_id, document_type, period_key, last_number) VALUES ($1::uuid, $3, $2, 1) RETURNING last_number`;

    const { rows: inserted } = await client.query(insertKey, [restaurantId, periodKey, documentType]);
    newNumber = inserted[0]?.last_number ?? 1n;
  }

  const prefix = PREFIXES[documentType] || "S";
  const day = dateToDateOnly(businessDate).replaceAll("-", "");

  return `${prefix}${day}-${newNumber.toString().padStart(4, "0")}`;
}