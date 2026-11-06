import type { RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { BadRequestError, ForbiddenError } from "../lib/errors.js";
import { resolvePermissions, type PermissionEffect } from "../lib/permissions.js";
import { query } from "../lib/db.js";
import { stringParam } from "../lib/request-params.js";

const uuidSchema = z.string().uuid();

type MembershipRow = {
  id: string;
  status: string;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_currency: string;
  restaurant_timezone: string;
  restaurant_status: string;
  role_key: string;
  role_name: string;
};

export const requireRestaurant: RequestHandler = asyncHandler(
  async (request, _response, next) => {
    const restaurantId =
      stringParam(request.params.restaurantId) ?? request.header("x-restaurant-id");

    if (!restaurantId || !uuidSchema.safeParse(restaurantId).success) {
      throw new BadRequestError("A valid restaurant id is required", {
        field: "restaurantId"
      });
    }

    const { rows } = await query<MembershipRow>(
      `SELECT ru.id, ru.status, ru.restaurant_id,
              r.name AS restaurant_name, r.currency AS restaurant_currency,
              r.timezone AS restaurant_timezone, r.status AS restaurant_status,
              ro.key AS role_key, ro.name AS role_name
       FROM restaurant_users ru
       JOIN restaurants r ON r.id = ru.restaurant_id
       JOIN roles ro ON ro.id = ru.role_id
       WHERE ru.restaurant_id = $1 AND ru.user_id = $2
       LIMIT 1`,
      [restaurantId, request.user!.id]
    );
    const membership = rows[0];

    if (!membership || membership.status !== "ACTIVE") {
      throw new ForbiddenError("You do not have access to this restaurant");
    }

    if (membership.restaurant_status !== "ACTIVE") {
      throw new ForbiddenError("This restaurant is not active");
    }

    const { rows: rolePermissions } = await query<{ key: string }>(
      `SELECT p.key
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = (SELECT role_id FROM restaurant_users WHERE id = $1)`,
      [membership.id]
    );

    const { rows: overrides } = await query<{
      effect: PermissionEffect;
      key: string;
    }>(
      `SELECT rup.effect, p.key
       FROM restaurant_user_permissions rup
       JOIN permissions p ON p.id = rup.permission_id
       WHERE rup.restaurant_user_id = $1`,
      [membership.id]
    );

    request.restaurant = {
      id: membership.restaurant_id,
      name: membership.restaurant_name,
      currency: membership.restaurant_currency,
      timezone: membership.restaurant_timezone,
      status: membership.restaurant_status
    };
    request.membership = {
      id: membership.id,
      status: membership.status,
      role: {
        key: membership.role_key,
        name: membership.role_name
      }
    };
    request.permissions = new Set(
      resolvePermissions(
        rolePermissions.map((permission) => permission.key),
        overrides.map((override) => ({
          key: override.key,
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
