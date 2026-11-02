import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "./notifications.service.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}

export const notificationsRouter = Router({ mergeParams: true });

notificationsRouter.get(
  "/",
  requirePermission("notifications.view"),
  asyncHandler(async (request, response) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        unreadOnly: z.coerce.boolean().default(false)
      })
      .parse(request.query);

    response.json({
      data: await listNotifications(
        restaurantIdFrom(request),
        request.user!.id,
        query
      )
    });
  })
);

notificationsRouter.post(
  "/read-all",
  requirePermission("notifications.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: await markAllNotificationsRead(
        restaurantIdFrom(request),
        request.user!.id
      )
    });
  })
);

notificationsRouter.post(
  "/:notificationId/read",
  requirePermission("notifications.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: await markNotificationRead(
        restaurantIdFrom(request),
        request.user!.id,
        stringParam(request.params.notificationId)!
      )
    });
  })
);
