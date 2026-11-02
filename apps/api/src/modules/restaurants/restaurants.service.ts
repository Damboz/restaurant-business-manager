import { resolvePermissions } from "../../lib/permissions.js";
import { prisma } from "../../lib/prisma.js";

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

export async function listMyRestaurants(
  userId: string
): Promise<RestaurantAccess[]> {
  const memberships = await prisma.restaurantUser.findMany({
    where: {
      userId,
      status: "ACTIVE",
      restaurant: { status: "ACTIVE" }
    },
    orderBy: { joinedAt: "asc" },
    select: {
      id: true,
      joinedAt: true,
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

  return memberships.map((membership) => ({
    membershipId: membership.id,
    joinedAt: membership.joinedAt.toISOString(),
    restaurant: membership.restaurant,
    role: {
      key: membership.role.key,
      name: membership.role.name
    },
    permissions: resolvePermissions(
      membership.role.permissions.map(({ permission }) => permission.key),
      membership.permissionOverrides.map((override) => ({
        key: override.permission.key,
        effect: override.effect
      }))
    )
  }));
}
