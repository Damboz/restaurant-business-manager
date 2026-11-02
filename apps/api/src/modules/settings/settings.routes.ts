import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import { getSettings, updateSettings } from "./settings.service.js";
import { updateSettingsSchema } from "./settings.schemas.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}

export const settingsRouter = Router({ mergeParams: true });

settingsRouter.get(
  "/",
  requirePermission("settings.view"),
  asyncHandler(async (request, response) => {
    response.json({ data: await getSettings(restaurantIdFrom(request)) });
  })
);

settingsRouter.patch(
  "/",
  requirePermission("settings.manage"),
  validateBody(updateSettingsSchema),
  asyncHandler(async (request, response) => {
    response.json({
      data: await updateSettings(
        restaurantIdFrom(request),
        request.user!.id,
        request.body,
        { ip: request.ip, userAgent: request.get("user-agent") }
      )
    });
  })
);
