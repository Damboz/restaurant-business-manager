import type { DocumentType, Prisma } from "@prisma/client";
import { dateToDateOnly } from "./business-date.js";

const PREFIXES: Record<DocumentType, string> = {
  SALE: "S",
  EXPENSE: "E",
  STOCK_PURCHASE: "P",
  OWNER_TRANSACTION: "O"
};

export async function nextDocumentNumber(
  transaction: Prisma.TransactionClient,
  restaurantId: string,
  documentType: DocumentType,
  businessDate: Date
): Promise<string> {
  const periodKey = dateToDateOnly(businessDate).replaceAll("-", "").slice(0, 6);

  const rows = await transaction.$queryRaw<Array<{ last_number: bigint }>>`
    INSERT INTO document_sequences (id, restaurant_id, document_type, period_key, last_number)
    VALUES (gen_random_uuid(), ${restaurantId}::uuid, ${documentType}::"DocumentType", ${periodKey}, 1)
    ON CONFLICT (restaurant_id, document_type, period_key)
    DO UPDATE SET last_number = document_sequences.last_number + 1
    RETURNING last_number
  `;

  const number = rows[0]?.last_number ?? 1n;
  const prefix = PREFIXES[documentType];
  const day = dateToDateOnly(businessDate).replaceAll("-", "");

  return `${prefix}${day}-${number.toString().padStart(4, "0")}`;
}
