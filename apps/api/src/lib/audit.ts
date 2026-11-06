import type { PoolClient } from "pg";
import { pool } from "./db.js";

type Queryable = Pick<PoolClient, "query">;

export type AuditEntry = {
  restaurantId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
};

export async function recordAudit(
  client: Queryable | typeof pool | null,
  entry: AuditEntry
): Promise<void> {
  const db = client ?? pool;

  await db.query(
    `INSERT INTO audit_logs
       (id, restaurant_id, actor_user_id, action, entity_type, entity_id, before, after, ip, user_agent, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [
      entry.restaurantId ?? null,
      entry.actorUserId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.ip ?? null,
      entry.userAgent ?? null
    ]
  );
}
