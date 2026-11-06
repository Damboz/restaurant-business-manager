import type { PoolClient } from "pg";
import { BadRequestError } from "./errors.js";
import { dateToDateOnly } from "./business-date.js";

export async function assertDayOpen(
  client: PoolClient,
  restaurantId: string,
  businessDate: Date | string
): Promise<void> {
  const date = dateToDateOnly(businessDate);
  const { rows } = await client.query<{ status: string }>(
    `SELECT status FROM daily_closings WHERE restaurant_id = $1 AND business_date = $2`,
    [restaurantId, date]
  );

  if (rows[0]?.status === "CLOSED") {
    throw new BadRequestError(`The business day ${date} is closed`, {
      field: "occurredAt",
      businessDate: date
    });
  }
}
