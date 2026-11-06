import { query } from "../../lib/db.js";
import {
  resolvePermissions,
  type PermissionEffect
} from "../../lib/permissions.js";

export type RestaurantAccess = {
  membershipId: string;
  joinedAt: string;
  restaurant: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    status: string;
  };
  role: {
    key: string;
    name: string;
  };
  permissions: string[];
};

type MembershipRow = {
  id: string;
  joined_at: Date;
  role_id: string;
  role_key: string;
  role_name: string;
  restaurant_id: string;
  name: string;
  currency: string;
  timezone: string;
  restaurant_status: string;
};

export async function listMyRestaurants(
  userId: string
): Promise<RestaurantAccess[]> {
  const { rows: memberships } = await query<MembershipRow>(
    `SELECT ru.id, ru.joined_at, ru.role_id,
            ro.key AS role_key, ro.name AS role_name,
            r.id AS restaurant_id, r.name, r.currency, r.timezone,
            r.status AS restaurant_status
     FROM restaurant_users ru
     JOIN restaurants r ON r.id = ru.restaurant_id
     JOIN roles ro ON ro.id = ru.role_id
     WHERE ru.user_id = $1 AND ru.status = 'ACTIVE' AND r.status = 'ACTIVE'
     ORDER BY ru.joined_at ASC`,
    [userId]
  );

  if (memberships.length === 0) {
    return [];
  }

  const roleIds = [...new Set(memberships.map((membership) => membership.role_id))];
  const membershipIds = memberships.map((membership) => membership.id);

  const [{ rows: rolePermissions }, { rows: overrides }] = await Promise.all([
    query<{ role_id: string; key: string }>(
      `SELECT rp.role_id, p.key
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ANY($1::uuid[])`,
      [roleIds]
    ),
    query<{
      restaurant_user_id: string;
      effect: PermissionEffect;
      key: string;
    }>(
      `SELECT rup.restaurant_user_id, rup.effect, p.key
       FROM restaurant_user_permissions rup
       JOIN permissions p ON p.id = rup.permission_id
       WHERE rup.restaurant_user_id = ANY($1::uuid[])`,
      [membershipIds]
    )
  ]);

  const permissionsByRole = new Map<string, string[]>();
  for (const permission of rolePermissions) {
    const list = permissionsByRole.get(permission.role_id) ?? [];
    list.push(permission.key);
    permissionsByRole.set(permission.role_id, list);
  }

  const overridesByMembership = new Map<
    string,
    Array<{ key: string; effect: PermissionEffect }>
  >();
  for (const override of overrides) {
    const list = overridesByMembership.get(override.restaurant_user_id) ?? [];
    list.push({ key: override.key, effect: override.effect });
    overridesByMembership.set(override.restaurant_user_id, list);
  }

  return memberships.map((membership) => ({
    membershipId: membership.id,
    joinedAt: membership.joined_at.toISOString(),
    restaurant: {
      id: membership.restaurant_id,
      name: membership.name,
      currency: membership.currency,
      timezone: membership.timezone,
      status: membership.restaurant_status
    },
    role: {
      key: membership.role_key,
      name: membership.role_name
    },
    permissions: resolvePermissions(
      permissionsByRole.get(membership.role_id) ?? [],
      overridesByMembership.get(membership.id) ?? []
    )
  }));
}
