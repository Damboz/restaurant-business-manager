import { Prisma } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

export type ContactKind = "supplier" | "customer";
type AuditMeta = { ip?: string; userAgent?: string };

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function delegateFor(kind: ContactKind) {
  return (kind === "supplier" ? prisma.supplier : prisma.customer) as typeof prisma.supplier;
}

export async function listContacts(
  kind: ContactKind,
  restaurantId: string,
  query: { page: number; pageSize: number; search?: string; activeOnly: boolean }
) {
  const where = {
    restaurantId,
    ...(query.activeOnly ? { isActive: true } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { phone: { contains: query.search } },
            { email: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {})
  };

  const delegate = delegateFor(kind);
  const [items, total] = await Promise.all([
    delegate.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    }),
    delegate.count({ where })
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    })),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function createContact(
  kind: ContactKind,
  restaurantId: string,
  actorUserId: string,
  input: Record<string, unknown>,
  meta: AuditMeta
) {
  const delegate = delegateFor(kind);

  try {
    const created = await delegate.create({
      data: {
        ...input,
        restaurantId
      } as Prisma.SupplierUncheckedCreateInput
    });

    await recordAudit(prisma, {
      restaurantId,
      actorUserId,
      action: `${kind.toUpperCase()}_CREATED`,
      entityType: kind === "supplier" ? "Supplier" : "Customer",
      entityId: created.id,
      after: input as Prisma.InputJsonValue,
      ...meta
    });

    return created;
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError(`A ${kind} with this name already exists`);
    }
    throw error;
  }
}

export async function updateContact(
  kind: ContactKind,
  restaurantId: string,
  actorUserId: string,
  id: string,
  input: Record<string, unknown>,
  meta: AuditMeta
) {
  const delegate = delegateFor(kind);
  const existing = await delegate.findFirst({ where: { id, restaurantId } });

  if (!existing) {
    throw new NotFoundError(`The ${kind} was not found`);
  }

  try {
    await delegate.update({
      where: { id },
      data: input as Prisma.SupplierUncheckedUpdateInput
    });
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError(`A ${kind} with this name already exists`);
    }
    throw error;
  }

  await recordAudit(prisma, {
    restaurantId,
    actorUserId,
    action: `${kind.toUpperCase()}_UPDATED`,
    entityType: kind === "supplier" ? "Supplier" : "Customer",
    entityId: id,
    before: { name: existing.name, isActive: existing.isActive },
    after: input as Prisma.InputJsonValue,
    ...meta
  });

  return delegate.findUniqueOrThrow({ where: { id } });
}
