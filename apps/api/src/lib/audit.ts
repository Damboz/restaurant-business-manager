import type { Prisma } from "@prisma/client";

type AuditClient = Pick<Prisma.TransactionClient, "auditLog">;

export type AuditEntry = {
  restaurantId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
};

export async function recordAudit(
  client: AuditClient,
  entry: AuditEntry
): Promise<void> {
  await client.auditLog.create({
    data: {
      restaurantId: entry.restaurantId ?? null,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(entry.before === undefined ? {} : { before: entry.before }),
      ...(entry.after === undefined ? {} : { after: entry.after }),
      ip: entry.ip,
      userAgent: entry.userAgent
    }
  });
}
