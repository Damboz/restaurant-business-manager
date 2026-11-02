import { prisma } from "../../lib/prisma.js";
import { NotFoundError } from "../../lib/errors.js";

export async function listNotifications(
  restaurantId: string,
  userId: string,
  query: { page: number; pageSize: number; unreadOnly: boolean }
) {
  const where = {
    restaurantId,
    userId,
    ...(query.unreadOnly ? { readAt: null } : {})
  };

  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { restaurantId, userId, readAt: null } })
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      type: item.type,
      severity: item.severity,
      titleKey: item.titleKey,
      bodyKey: item.bodyKey,
      params: item.params,
      readAt: item.readAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString()
    })),
    total,
    unread,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function markNotificationRead(
  restaurantId: string,
  userId: string,
  notificationId: string
) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, restaurantId, userId }
  });
  if (!notification) throw new NotFoundError("The notification was not found");

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: notification.readAt ?? new Date() }
  });

  return {
    id: updated.id,
    readAt: updated.readAt?.toISOString() ?? null
  };
}

export async function markAllNotificationsRead(restaurantId: string, userId: string) {
  const result = await prisma.notification.updateMany({
    where: { restaurantId, userId, readAt: null },
    data: { readAt: new Date() }
  });

  return { updated: result.count };
}
