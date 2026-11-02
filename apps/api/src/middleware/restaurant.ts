import type { RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { BadRequestError, ForbiddenError } from "../lib/errors.js";
import { resolvePermissions } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { stringParam } from "../lib/request-params.js";

const uuidSchema = z.string().uuid();

export const requireRestaurant: RequestHandler = asyncHandler(
  async (request, _response, next) => {
    const restaurantId =
      stringParam(request.params.restaurantId) ?? request.header("x-restaurant-id");

    if (!restaurantId || !uuidSchema.safeParse(restaurantId).success) {
      throw new BadRequestError("A valid restaurant id is required", {
        field: "restaurantId"
      });
    }

    const membership = await prisma.restaurantUser.findUnique({
      where: {
        restaurantId_userId: {
          restaurantId,
          userId: request.user!.id
        }
      },
      select: {
        id: true,
        status: true,
        restaurant: {
          select: {
            id: true,
            name: true,
            currency: true,
            timezone: true,
            status: true
          }
        },
        role: {
          select: {
            key: true,
            name: true,
            permissions: {
              select: {
                permission: { select: { key: true } }
              }
            }
          }
        },
        permissionOverrides: {
          select: {
            effect: true,
            permission: { select: { key: true } }
          }
        }
      }
    });

    if (!membership || membership.status !== "ACTIVE") {
      throw new ForbiddenError("You do not have access to this restaurant");
    }

    if (membership.restaurant.status !== "ACTIVE") {
      throw new ForbiddenError("This restaurant is not active");
    }

    request.restaurant = membership.restaurant;
    request.membership = {
      id: membership.id,
      status: membership.status,
      role: {
        key: membership.role.key,
        name: membership.role.name
      }
    };
    request.permissions = new Set(
      resolvePermissions(
        membership.role.permissions.map(({ permission }) => permission.key),
        membership.permissionOverrides.map((override) => ({
          key: override.permission.key,
          effect: override.effect
        }))
      )
    );

    next();
  }
);

export function requirePermission(...required: string[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.permissions) {
      next(new ForbiddenError("Restaurant context is required"));
      return;
    }

    const missing = required.filter(
      (permission) => !request.permissions!.has(permission)
    );

    if (missing.length > 0) {
      next(
        new ForbiddenError("You do not have permission to perform this action", {
          required,
          missing
        })
      );
      return;
    }

    next();
  };
}
