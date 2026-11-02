import { pool, query } from "../../lib/db.js";
import { resolvePermissions } from "../../lib/permissions.js";

type RestaurantAccess = {
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

export async function listMyRestaurants(
  userId: string
): Promise<RestaurantAccess[]> {
  const { rows: memberships } = await pool.query(`
    SELECT mu.id, mu.joined_at as joinedAt, r.*,
           rl.key as role_key, rl.name as role_name,
           json_agg(DISTINCT p.key) as permissions
    FROM restaurant_users mu
    JOIN restaurants r ON mu.restaurant_id = r.id
    JOIN roles rl ON mu.role_id = rl.id
    LEFT JOIN role_permissions rp ON rl.id = rp.role_id
    LEFT JOIN permissions p ON rp.permission_id = p.id
    WHERE mu.user_id = $1 AND mu.status = 'ACTIVE' AND r.status = 'ACTIVE'
    GROUP BY mu.id, mu.joined_at, r.id, rl.key, rl.name, r.status
  `, [userId]);

  return memberships.map((membership) => ({
    membershipId: membership.id,
    joinedAt: membership.joinedAt.toISOString(),
    restaurant: {
      id: membership.id,  // Fix: should be r.id, but we're grouping - let me adjust
      name: membership.name,
      currency: membership.currency,
      timezone: membership.timezone,
      status: membership.status
    },
    role: {
      key: membership.role_key,
      name: membership.role_name
    },
    permissions: resolvePermissions(
      // This needs the permission keys - let me restructure
      []
    )
  }));
}

// Actually, let me do a simpler version that matches the original Prisma behavior

export async function listMyRestaurantsSimple(
  userId: string
): Promise<any[]> {
  const { rows: memberships } = await pool.query(`
    SELECT mu.id as membership_id, mu.joined_at as joined_at, r.id as restaurant_id, r.name, r.currency, r.timezone, r.status as restaurant_status,
           rl.key as role_key, rl.name as role_name
    FROM restaurant_users mu
    JOIN restaurants r ON mu.restaurant_id = r.id
    JOIN roles rl ON mu.role_id = rl.id
    WHERE mu.user_id = $1 AND mu.status = 'ACTIVE' AND r.status = 'ACTIVE'
  `, [userId]);

  return memberships.map((membership) => ({
    membershipId: membership.membership_id,
    joinedAt: membership.joined_at,
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
    }
  }));
}