import { recordAudit } from "../../lib/audit.js";
import { query } from "../../lib/db.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

export type ContactKind = "supplier" | "customer";
type AuditMeta = { ip?: string; userAgent?: string };

type ContactRow = {
  id: string;
  restaurant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address?: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

function isUnique(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function tableFor(kind: ContactKind): "suppliers" | "customers" {
  return kind === "supplier" ? "suppliers" : "customers";
}

function entityName(kind: ContactKind): "Supplier" | "Customer" {
  return kind === "supplier" ? "Supplier" : "Customer";
}

function serializeContact(kind: ContactKind, row: ContactRow) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    ...(kind === "supplier" ? { address: row.address ?? null } : {}),
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function listContacts(
  kind: ContactKind,
  restaurantId: string,
  queryInput: { page: number; pageSize: number; search?: string; activeOnly: boolean }
) {
  const table = tableFor(kind);
  const params: unknown[] = [restaurantId];
  let where = "WHERE restaurant_id = $1";

  if (queryInput.activeOnly) {
    where += " AND is_active = true";
  }

  if (queryInput.search) {
    params.push(`%${queryInput.search}%`);
    where +=
      ` AND (name ILIKE $${params.length} OR phone ILIKE $${params.length}` +
      ` OR email ILIKE $${params.length})`;
  }

  const offset = (queryInput.page - 1) * queryInput.pageSize;
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const [itemsResult, countResult] = await Promise.all([
    query<ContactRow>(
      `SELECT * FROM ${table}
       ${where}
       ORDER BY is_active DESC, name ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, queryInput.pageSize, offset]
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${table} ${where}`,
      params
    )
  ]);

  return {
    items: itemsResult.rows.map((row) => serializeContact(kind, row)),
    total: countResult.rows[0]?.count ?? 0,
    page: queryInput.page,
    pageSize: queryInput.pageSize
  };
}

export async function createContact(
  kind: ContactKind,
  restaurantId: string,
  actorUserId: string,
  input: Record<string, unknown>,
  meta: AuditMeta
) {
  const table = tableFor(kind);
  const columns = ["id", "restaurant_id", "name", "phone", "email"];
  const values = ["gen_random_uuid()", "$1", "$2", "$3", "$4"];
  const params: unknown[] = [
    restaurantId,
    input.name ?? null,
    input.phone ?? null,
    input.email ?? null
  ];

  if (kind === "supplier") {
    columns.push("address");
    values.push(`$${params.length + 1}`);
    params.push(input.address ?? null);
  }

  columns.push("notes");
  values.push(`$${params.length + 1}`);
  params.push(input.notes ?? null);

  columns.push("is_active", "created_at", "updated_at");
  values.push(`$${params.length + 1}`, "NOW()", "NOW()");
  params.push(input.isActive ?? true);

  try {
    const { rows } = await query<ContactRow>(
      `INSERT INTO ${table} (${columns.join(", ")})
       VALUES (${values.join(", ")})
       RETURNING *`,
      params
    );
    const created = rows[0]!;

    await recordAudit(null, {
      restaurantId,
      actorUserId,
      action: `${kind.toUpperCase()}_CREATED`,
      entityType: entityName(kind),
      entityId: created.id,
      after: input,
      ...meta
    });

    return serializeContact(kind, created);
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError(`A ${kind} with this name already exists`);
    }
    throw error;
  }
}

const CONTACT_COLUMNS: Record<string, string> = {
  name: "name",
  phone: "phone",
  email: "email",
  address: "address",
  notes: "notes",
  isActive: "is_active"
};

export async function updateContact(
  kind: ContactKind,
  restaurantId: string,
  actorUserId: string,
  id: string,
  input: Record<string, unknown>,
  meta: AuditMeta
) {
  const table = tableFor(kind);
  const { rows: existingRows } = await query<ContactRow>(
    `SELECT * FROM ${table} WHERE id = $1 AND restaurant_id = $2`,
    [id, restaurantId]
  );
  const existing = existingRows[0];

  if (!existing) {
    throw new NotFoundError(`The ${kind} was not found`);
  }

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(CONTACT_COLUMNS)) {
    if (key === "address" && kind !== "supplier") {
      continue;
    }

    if (input[key] !== undefined) {
      params.push(input[key]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (assignments.length === 0) {
    return serializeContact(kind, existing);
  }

  params.push(id);
  params.push(restaurantId);

  try {
    const { rows } = await query<ContactRow>(
      `UPDATE ${table}
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND restaurant_id = $${params.length}
       RETURNING *`,
      params
    );
    const updated = rows[0]!;

    await recordAudit(null, {
      restaurantId,
      actorUserId,
      action: `${kind.toUpperCase()}_UPDATED`,
      entityType: entityName(kind),
      entityId: id,
      before: { name: existing.name, isActive: existing.is_active },
      after: input,
      ...meta
    });

    return serializeContact(kind, updated);
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError(`A ${kind} with this name already exists`);
    }
    throw error;
  }
}
