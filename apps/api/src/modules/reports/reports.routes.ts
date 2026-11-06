import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import {
  defaultReportDates,
  exportCsv,
  getDashboard,
  summaryForRange
} from "./reports.service.js";
import { exportQuerySchema, summaryQuerySchema } from "./reports.schemas.js";
import { query } from "../../lib/db.js";
import { NotFoundError } from "../../lib/errors.js";
import { todayInTimeZone } from "../../lib/business-date.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}

export const reportsRouter = Router({ mergeParams: true });

reportsRouter.get(
  "/dashboard",
  requirePermission("dashboard.view"),
  asyncHandler(async (request, response) => {
    response.json({ data: await getDashboard(restaurantIdFrom(request)) });
  })
);

reportsRouter.get(
  "/summary",
  requirePermission("reports.view"),
  asyncHandler(async (request, response) => {
    const restaurantId = restaurantIdFrom(request);
    let range;

    if (request.query.startDate && request.query.endDate) {
      range = summaryQuerySchema.parse(request.query);
    } else {
      const { rows } = await query<{ timezone: string }>(
        "SELECT timezone FROM restaurants WHERE id = $1",
        [restaurantId]
      );
      if (!rows[0]) {
        throw new NotFoundError("The restaurant was not found");
      }
      range = defaultReportDates(todayInTimeZone(rows[0].timezone));
    }

    response.json({
      data: await summaryForRange(restaurantId, range.startDate, range.endDate)
    });
  })
);

reportsRouter.get(
  "/export",
  requirePermission("reports.export"),
  asyncHandler(async (request, response) => {
    const query = exportQuerySchema.parse(request.query);
    const csv = await exportCsv(
      restaurantIdFrom(request),
      query.type,
      query.startDate,
      query.endDate
    );

    response
      .status(200)
      .type("text/csv")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="${query.type}-${query.startDate}-${query.endDate}.csv"`
      )
      .send(csv);
  })
);
