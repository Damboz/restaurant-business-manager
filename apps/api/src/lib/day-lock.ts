import type { Prisma } from "@prisma/client";
import { BadRequestError } from "./errors.js";
import { dateToDateOnly } from "./business-date.js";

export async function assertDayOpen(
  transaction: Prisma.TransactionClient,
  restaurantId: string,
  businessDate: Date
): Promise<void> {
  const closing = await transaction.dailyClosing.findUnique({
    where: {
      restaurantId_businessDate: { restaurantId, businessDate }
    },
    select: { status: true }
  });

  if (closing?.status === "CLOSED") {
    throw new BadRequestError(
      `The business day ${dateToDateOnly(businessDate)} is closed`,
      { field: "occurredAt", businessDate: dateToDateOnly(businessDate) }
    );
  }
}
