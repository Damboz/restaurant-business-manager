import { query } from "../../lib/db.js";
import { NotFoundError } from "../../lib/errors.js";

type NotificationRow = {
  id: string;
  type: string;
  severity: string;
  title_key: string;
  body_key: string;
  params: Record<string, unknown> | null;
  read_at: Date | null;
  created_at: Date;
};

export async function listNotifications(
  restaurantId: string,
  userId: string,
  queryInput: { page: number; pageSize: number; unreadOnly: boolean }
) {
  const params: unknown[] = [restaurantId, userId];
  let where = "WHERE restaurant_id = $1 AND user_id = $2";

  if (queryInput.unreadOnly) {
    where += " AND read_at IS NULL";
  }

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const offset = (queryInput.page - 1) * queryInput.pageSize;

  const [itemsResult, totalResult, unreadResult] = await Promise.all([
    query<NotificationRow>(
      `SELECT id, type, severity, title_key, body_key, params, read_at, created_at
       FROM notifications
       ${where}
       ORDER BY created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, queryInput.pageSize, offset]
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM notifications ${where}`,
      params
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE restaurant_id = $1 AND user_id = $2 AND read_at IS NULL`,
      [restaurantId, userId]
    )
  ]);

  return {
    items: itemsResult.rows.map((item) => ({
      id: item.id,
      type: item.type,
      severity: item.severity,
      titleKey: item.title_key,
      bodyKey: item.body_key,
      params: item.params,
      readAt: item.read_at?.toISOString() ?? null,
      createdAt: item.created_at.toISOString()
    })),
    total: totalResult.rows[0]?.count ?? 0,
    unread: unreadResult.rows[0]?.count ?? 0,
    page: queryInput.page,
    pageSize: queryInput.pageSize
  };
}

export async function markNotificationRead(
  restaurantId: string,
  userId: string,
  notificationId: string
) {
  const { rows } = await query<{ id: string; read_at: Date | null }>(
    `SELECT id, read_at FROM notifications
     WHERE id = $1 AND restaurant_id = $2 AND user_id = $3`,
    [notificationId, restaurantId, userId]
  );

  if (!rows[0]) {
    throw new NotFoundError("The notification was not found");
  }

  const { rows: updated } = await query<{ id: string; read_at: Date | null }>(
    `UPDATE notifications
     SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1
     RETURNING id, read_at`,
    [notificationId]
  );
  const notification = updated[0]!;

  return {
    id: notification.id,
    readAt: notification.read_at?.toISOString() ?? null
  };
}

export async function markAllNotificationsRead(restaurantId: string, userId: string) {
  const result = await query(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE restaurant_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [restaurantId, userId]
  );

  return { updated: result.rowCount ?? 0 };
}
