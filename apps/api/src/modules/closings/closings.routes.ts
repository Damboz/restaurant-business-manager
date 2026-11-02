import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import { closeDay, listClosings, previewClosing, reopenDay } from "./closings.service.js";
import {
  businessDateQuerySchema,
  closeDaySchema,
  listClosingsQuerySchema,
  reopenDaySchema
} from "./closings.schemas.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}
function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.get("user-agent") };
}

export const closingsRouter = Router({ mergeParams: true });

closingsRouter.get(
  "/",
  requirePermission("closings.view"),
  asyncHandler(async (request, response) => {
    const query = listClosingsQuerySchema.parse(request.query);
    response.json({ data: await listClosings(restaurantIdFrom(request), query) });
  })
);

closingsRouter.get(
  "/preview",
  requirePermission("closings.view"),
  asyncHandler(async (request, response) => {
    const query = businessDateQuerySchema.parse(request.query);
    response.json({
      data: await previewClosing(restaurantIdFrom(request), query.businessDate)
    });
  })
);

closingsRouter.post(
  "/close",
  requirePermission("closings.close"),
  validateBody(closeDaySchema),
  asyncHandler(async (request, response) => {
    const closing = await closeDay(
      restaurantIdFrom(request),
      request.user!.id,
      request.body.businessDate,
      metaFrom(request)
    );
    response.status(201).json({ data: { closing } });
  })
);

closingsRouter.post(
  "/reopen",
  requirePermission("closings.reopen"),
  validateBody(reopenDaySchema),
  asyncHandler(async (request, response) => {
    const closing = await reopenDay(
      restaurantIdFrom(request),
      request.user!.id,
      request.body.businessDate,
      request.body.reason,
      metaFrom(request)
    );
    response.json({ data: { closing } });
  })
);
