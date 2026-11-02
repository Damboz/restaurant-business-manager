import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  requirePermission,
  requireRestaurant
} from "../../middleware/restaurant.js";
import { listRolesAndPermissions } from "../users/users.service.js";
import { usersRouter } from "../users/users.routes.js";
import { businessRouter } from "../business/business.routes.js";
import { listMyRestaurants } from "./restaurants.service.js";

export const restaurantsRouter = Router();

restaurantsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (request, response) => {
    const restaurants = await listMyRestaurants(request.user!.id);

    response.json({ data: { restaurants } });
  })
);

restaurantsRouter.get(
  "/:restaurantId",
  requireAuth,
  requireRestaurant,
  asyncHandler(async (request, response) => {
    response.json({
      data: {
        restaurant: request.restaurant,
        membership: {
          id: request.membership!.id,
          status: request.membership!.status,
          role: request.membership!.role
        },
        permissions: [...request.permissions!].sort()
      }
    });
  })
);

restaurantsRouter.get(
  "/:restaurantId/roles",
  requireAuth,
  requireRestaurant,
  requirePermission("employees.view"),
  asyncHandler(async (_request, response) => {
    const result = await listRolesAndPermissions();

    response.json({ data: result });
  })
);

restaurantsRouter.use(
  "/:restaurantId/users",
  requireAuth,
  requireRestaurant,
  usersRouter
);

restaurantsRouter.use(
  "/:restaurantId",
  requireAuth,
  requireRestaurant,
  businessRouter
);
