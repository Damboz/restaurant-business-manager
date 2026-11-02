import { Prisma } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import { dateOnlyToDate, dateToDateOnly } from "../../lib/business-date.js";
import { NotFoundError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

type AuditMeta = { ip?: string; userAgent?: string };

export async function getSettings(restaurantId: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId }
  });
  if (!restaurant) throw new NotFoundError("The restaurant was not found");

  const [paymentMethods, expenseCategories] = await Promise.all([
    prisma.paymentMethod.findMany({
      where: {
        isActive: true,
        OR: [{ restaurantId }, { restaurantId: null }]
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, key: true, name: true, isActive: true, restaurantId: true }
    }),
    prisma.expenseCategory.findMany({
      where: {
        isActive: true,
        OR: [{ restaurantId }, { restaurantId: null }]
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        isOperating: true,
        isSystem: true
      }
    })
  ]);

  return {
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      phone: restaurant.phone,
      email: restaurant.email,
      addressLine: restaurant.addressLine,
      city: restaurant.city,
      country: restaurant.country,
      currency: restaurant.currency,
      timezone: restaurant.timezone,
      logoUrl: restaurant.logoUrl,
      openingDate: restaurant.openingDate
        ? dateToDateOnly(restaurant.openingDate)
        : null,
      operatingHours: restaurant.operatingHours,
      status: restaurant.status
    },
    paymentMethods,
    expenseCategories
  };
}

export async function updateSettings(
  restaurantId: string,
  actorUserId: string,
  input: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    addressLine?: string | null;
    city?: string | null;
    logoUrl?: string | null;
    openingDate?: string | null;
    operatingHours?: Record<string, unknown> | null;
  },
  meta: AuditMeta
) {
  const existing = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!existing) throw new NotFoundError("The restaurant was not found");

  const updated = await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      ...input,
      openingDate:
        input.openingDate === undefined
          ? undefined
          : input.openingDate === null
            ? null
            : dateOnlyToDate(input.openingDate),
      operatingHours:
        input.operatingHours === undefined
          ? undefined
          : input.operatingHours === null
            ? Prisma.JsonNull
            : (input.operatingHours as Prisma.InputJsonValue)
    }
  });

  await recordAudit(prisma, {
    restaurantId,
    actorUserId,
    action: "SETTINGS_UPDATED",
    entityType: "Restaurant",
    entityId: restaurantId,
    before: {
      name: existing.name,
      phone: existing.phone,
      city: existing.city
    },
    after: input as Prisma.InputJsonValue,
    ...meta
  });

  return getSettings(updated.id);
}
