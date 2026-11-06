import type { PoolClient } from "pg";
import { pool, query, transaction } from "../../lib/db.js";
import { recordAudit } from "../../lib/audit.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError
} from "../../lib/errors.js";
import { hashPassword, validatePassword } from "../../lib/password.js";
import { resolvePermissions, type PermissionEffect } from "../../lib/permissions.js";
import { normalizeEmail, normalizePhone } from "../../lib/phone.js";
import type {
  CreateMemberInput,
  ListMembersQuery,
  UpdateMemberInput
} from "./users.schemas.js";

type RequestMetadata = {
  ip?: string;
  userAgent?: string;
};

export type MembershipActor = {
  userId: string;
  membershipId: string;
  roleKey: string;
};

type Queryable = Pick<PoolClient, "query"> | typeof pool;

type MemberRow = {
  id: string;
  status: string;
  joined_at: Date;
  created_at: Date;
  updated_at: Date;
  role_id: string;
  role_key: string;
  role_name: string;
  user_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  language: "EN" | "NY";
  user_status: string;
  must_change_password: boolean;
  last_login_at: Date | null;
};

export type MemberProfile = {
  id: string;
  status: string;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    language: "en" | "ny";
    status: string;
    mustChangePassword: boolean;
    lastLoginAt: string | null;
  };
  role: {
    key: string;
    name: string;
  };
  permissions: string[];
  permissionOverrides: Array<{
    key: string;
    effect: "ALLOW" | "DENY";
  }>;
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

async function loadPermissionData(
  client: Queryable,
  rows: MemberRow[]
): Promise<{
  rolePermissions: Map<string, string[]>;
  overrides: Map<string, Array<{ key: string; effect: PermissionEffect }>>;
}> {
  const roleIds = [...new Set(rows.map((row) => row.role_id))];
  const membershipIds = rows.map((row) => row.id);

  const { rows: rolePermissions } = await client.query<{
    role_id: string;
    key: string;
  }>(
    `SELECT rp.role_id, p.key
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ANY($1::uuid[])`,
    [roleIds]
  );

  const { rows: overrideRows } = await client.query<{
    restaurant_user_id: string;
    effect: PermissionEffect;
    key: string;
  }>(
    `SELECT rup.restaurant_user_id, rup.effect, p.key
     FROM restaurant_user_permissions rup
     JOIN permissions p ON p.id = rup.permission_id
     WHERE rup.restaurant_user_id = ANY($1::uuid[])`,
    [membershipIds]
  );

  const rolePermissionsByRole = new Map<string, string[]>();
  for (const permission of rolePermissions) {
    const list = rolePermissionsByRole.get(permission.role_id) ?? [];
    list.push(permission.key);
    rolePermissionsByRole.set(permission.role_id, list);
  }

  const overridesByMembership = new Map<
    string,
    Array<{ key: string; effect: PermissionEffect }>
  >();
  for (const override of overrideRows) {
    const list = overridesByMembership.get(override.restaurant_user_id) ?? [];
    list.push({ key: override.key, effect: override.effect });
    overridesByMembership.set(override.restaurant_user_id, list);
  }

  return { rolePermissions: rolePermissionsByRole, overrides: overridesByMembership };
}

async function serializeMembers(
  client: Queryable,
  rows: MemberRow[]
): Promise<MemberProfile[]> {
  const { rolePermissions, overrides } = await loadPermissionData(client, rows);

  return rows.map((member) => {
    const memberOverrides = overrides.get(member.id) ?? [];

    return {
      id: member.id,
      status: member.status,
      joinedAt: member.joined_at.toISOString(),
      createdAt: member.created_at.toISOString(),
      updatedAt: member.updated_at.toISOString(),
      user: {
        id: member.user_id,
        fullName: member.full_name,
        phone: member.phone,
        email: member.email,
        language: member.language === "NY" ? "ny" : "en",
        status: member.user_status,
        mustChangePassword: member.must_change_password,
        lastLoginAt: member.last_login_at?.toISOString() ?? null
      },
      role: {
        key: member.role_key,
        name: member.role_name
      },
      permissions: resolvePermissions(
        rolePermissions.get(member.role_id) ?? [],
        memberOverrides
      ),
      permissionOverrides: memberOverrides
    };
  });
}

const MEMBER_SELECT = `
  SELECT ru.id, ru.status, ru.joined_at, ru.created_at, ru.updated_at, ru.role_id,
         ro.key AS role_key, ro.name AS role_name,
         u.id AS user_id, u.full_name, u.phone, u.email, u.language,
         u.status AS user_status, u.must_change_password, u.last_login_at
  FROM restaurant_users ru
  JOIN users u ON u.id = ru.user_id
  JOIN roles ro ON ro.id = ru.role_id
`;

async function findMember(
  restaurantId: string,
  membershipId: string
): Promise<MemberProfile> {
  const { rows } = await query<MemberRow>(
    `${MEMBER_SELECT}
     WHERE ru.id = $1 AND ru.restaurant_id = $2`,
    [membershipId, restaurantId]
  );

  if (!rows[0]) {
    throw new NotFoundError("The team member was not found");
  }

  return (await serializeMembers(pool, rows))[0]!;
}

async function assertOwnerRemains(
  client: PoolClient,
  restaurantId: string,
  excludedMembershipId: string
): Promise<void> {
  const { rows: ownerRoles } = await client.query<{ id: string }>(
    `SELECT id FROM roles WHERE key = 'OWNER' LIMIT 1`
  );
  const ownerRole = ownerRoles[0];

  if (!ownerRole) {
    throw new BadRequestError("The OWNER role is not configured");
  }

  const { rows } = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM restaurant_users
     WHERE restaurant_id = $1 AND role_id = $2 AND status = 'ACTIVE' AND id <> $3`,
    [restaurantId, ownerRole.id, excludedMembershipId]
  );

  if ((rows[0]?.count ?? 0) === 0) {
    throw new BadRequestError("The restaurant must keep at least one active owner");
  }
}

export async function listMembers(
  restaurantId: string,
  queryInput: ListMembersQuery
): Promise<MemberProfile[]> {
  const params: unknown[] = [restaurantId];
  let whereClause = "WHERE ru.restaurant_id = $1";

  if (queryInput.status) {
    params.push(queryInput.status);
    whereClause += ` AND ru.status = $${params.length}`;
  }

  if (queryInput.search) {
    params.push(`%${queryInput.search}%`);
    whereClause +=
      ` AND (u.full_name ILIKE $${params.length} OR u.phone ILIKE $${params.length}` +
      ` OR u.email ILIKE $${params.length})`;
  }

  const { rows } = await query<MemberRow>(
    `${MEMBER_SELECT}
     ${whereClause}
     ORDER BY ru.status ASC, ru.joined_at ASC`,
    params
  );

  return serializeMembers(pool, rows);
}

export async function getMember(
  restaurantId: string,
  membershipId: string
): Promise<MemberProfile> {
  return findMember(restaurantId, membershipId);
}

export async function createMember(
  restaurantId: string,
  actor: MembershipActor,
  input: CreateMemberInput,
  metadata: RequestMetadata
): Promise<MemberProfile> {
  const phone = normalizePhone(input.phone);
  const email = input.email ? normalizeEmail(input.email) : null;

  let membershipId: string;

  try {
    membershipId = await transaction(async (client) => {
      const { rows: roles } = await client.query<{ id: string; key: string }>(
        `SELECT id, key FROM roles WHERE key = $1 LIMIT 1`,
        [input.roleKey]
      );
      const role = roles[0];

      if (!role) {
        throw new BadRequestError("The selected role does not exist", {
          field: "roleKey"
        });
      }

      if (role.key === "OWNER" && actor.roleKey !== "OWNER") {
        throw new ForbiddenError("Only an owner can add another owner");
      }

      const { rows: existingUsers } = await client.query<{
        id: string;
        status: string;
      }>(
        `SELECT id, status FROM users
         WHERE phone = $1 OR ($2::varchar IS NOT NULL AND email = $2)
         LIMIT 1`,
        [phone, email]
      );
      const existingUser = existingUsers[0];

      let userId: string;

      if (existingUser) {
        if (existingUser.status !== "ACTIVE") {
          throw new ForbiddenError("This account is not active");
        }

        const { rows: existingMemberships } = await client.query<{ id: string }>(
          `SELECT id FROM restaurant_users WHERE restaurant_id = $1 AND user_id = $2 LIMIT 1`,
          [restaurantId, existingUser.id]
        );

        if (existingMemberships[0]) {
          throw new ConflictError("This person is already a member of the restaurant");
        }

        userId = existingUser.id;
      } else {
        if (!input.password) {
          throw new BadRequestError(
            "A temporary password is required for a new user",
            { field: "password" }
          );
        }

        const passwordError = validatePassword(input.password);

        if (passwordError) {
          throw new BadRequestError(passwordError, { field: "password" });
        }

        const { rows: users } = await client.query<{ id: string }>(
          `INSERT INTO users
             (id, phone, email, full_name, password_hash, language, must_change_password, created_at, updated_at)
           VALUES
             (gen_random_uuid(), $1, $2, $3, $4, $5, true, NOW(), NOW())
           RETURNING id`,
          [
            phone,
            email,
            input.fullName,
            await hashPassword(input.password),
            input.language === "ny" ? "NY" : "EN"
          ]
        );
        userId = users[0]!.id;
      }

      const { rows: created } = await client.query<{ id: string; status: string }>(
        `INSERT INTO restaurant_users
           (id, restaurant_id, user_id, role_id, status, invited_by_user_id, invited_at, accepted_at, joined_at, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, 'ACTIVE', $4, NOW(), NOW(), NOW(), NOW(), NOW())
         RETURNING id, status`,
        [restaurantId, userId, role.id, actor.userId]
      );
      const membership = created[0]!;

      await recordAudit(client, {
        restaurantId,
        actorUserId: actor.userId,
        action: existingUser ? "MEMBERSHIP_ADDED" : "USER_CREATED",
        entityType: "RestaurantUser",
        entityId: membership.id,
        after: {
          userId,
          roleKey: role.key,
          status: membership.status
        },
        ip: metadata.ip,
        userAgent: metadata.userAgent
      });

      return membership.id;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("This person is already a member of the restaurant");
    }

    throw error;
  }

  return findMember(restaurantId, membershipId);
}

export async function updateMember(
  restaurantId: string,
  actor: MembershipActor,
  membershipId: string,
  input: UpdateMemberInput,
  metadata: RequestMetadata
): Promise<MemberProfile> {
  const { rows: targets } = await query<{
    id: string;
    user_id: string;
    status: string;
    role_id: string;
    role_key: string;
    full_name: string;
    phone: string;
  }>(
    `SELECT ru.id, ru.user_id, ru.status, ru.role_id, ro.key AS role_key,
            u.full_name, u.phone
     FROM restaurant_users ru
     JOIN roles ro ON ro.id = ru.role_id
     JOIN users u ON u.id = ru.user_id
     WHERE ru.id = $1 AND ru.restaurant_id = $2`,
    [membershipId, restaurantId]
  );
  const target = targets[0];

  if (!target) {
    throw new NotFoundError("The team member was not found");
  }

  if (target.id === actor.membershipId && (input.roleKey || input.status)) {
    throw new BadRequestError("You cannot change your own role or status");
  }

  const { rows: roles } = input.roleKey
    ? await query<{ id: string; key: string }>(
        `SELECT id, key FROM roles WHERE key = $1 LIMIT 1`,
        [input.roleKey]
      )
    : { rows: [] as Array<{ id: string; key: string }> };
  const role = roles[0] ?? null;

  if (input.roleKey && !role) {
    throw new BadRequestError("The selected role does not exist", {
      field: "roleKey"
    });
  }

  if (role?.key === "OWNER" && actor.roleKey !== "OWNER") {
    throw new ForbiddenError("Only an owner can assign the owner role");
  }

  const ownerIsBeingRemoved =
    target.role_key === "OWNER" &&
    ((role && role.key !== "OWNER") ||
      (input.status !== undefined && input.status !== "ACTIVE"));

  const overrides = input.permissionOverrides;

  if (overrides) {
    const permissionKeys = overrides.map((override) => override.key);
    const { rows: existingPermissions } = await query<{ id: string; key: string }>(
      `SELECT id, key FROM permissions WHERE key = ANY($1::varchar[])`,
      [permissionKeys]
    );

    const existingKeys = new Set(
      existingPermissions.map((permission) => permission.key)
    );
    const missing = permissionKeys.filter((key) => !existingKeys.has(key));

    if (missing.length > 0) {
      throw new BadRequestError("Unknown permission keys", {
        field: "permissionOverrides",
        missing
      });
    }

    const permissionIdByKey = new Map(
      existingPermissions.map((permission) => [permission.key, permission.id])
    );

    const { rows: before } = await query<{ effect: string; key: string }>(
      `SELECT rup.effect, p.key
       FROM restaurant_user_permissions rup
       JOIN permissions p ON p.id = rup.permission_id
       WHERE rup.restaurant_user_id = $1`,
      [target.id]
    );

    await transaction(async (client) => {
      if (ownerIsBeingRemoved) {
        await assertOwnerRemains(client, restaurantId, target.id);
      }

      await updateMembershipRow(client, target.id, role?.id, input.status);

      await client.query(
        `DELETE FROM restaurant_user_permissions WHERE restaurant_user_id = $1`,
        [target.id]
      );

      for (const override of overrides) {
        await client.query(
          `INSERT INTO restaurant_user_permissions (restaurant_user_id, permission_id, effect)
           VALUES ($1, $2, $3)`,
          [target.id, permissionIdByKey.get(override.key)!, override.effect]
        );
      }

      await recordAudit(client, {
        restaurantId,
        actorUserId: actor.userId,
        action: "MEMBERSHIP_UPDATED",
        entityType: "RestaurantUser",
        entityId: target.id,
        before: {
          roleKey: target.role_key,
          status: target.status,
          permissionOverrides: before.map((override) => ({
            key: override.key,
            effect: override.effect
          }))
        },
        after: {
          roleKey: role?.key ?? target.role_key,
          status: input.status ?? target.status,
          permissionOverrides: overrides
        },
        ip: metadata.ip,
        userAgent: metadata.userAgent
      });
    });

    return findMember(restaurantId, target.id);
  }

  await transaction(async (client) => {
    if (ownerIsBeingRemoved) {
      await assertOwnerRemains(client, restaurantId, target.id);
    }

    await updateMembershipRow(client, target.id, role?.id, input.status);

    await recordAudit(client, {
      restaurantId,
      actorUserId: actor.userId,
      action: "MEMBERSHIP_UPDATED",
      entityType: "RestaurantUser",
      entityId: target.id,
      before: {
        roleKey: target.role_key,
        status: target.status
      },
      after: {
        roleKey: role?.key ?? target.role_key,
        status: input.status ?? target.status
      },
      ip: metadata.ip,
      userAgent: metadata.userAgent
    });
  });

  return findMember(restaurantId, target.id);
}

async function updateMembershipRow(
  client: PoolClient,
  membershipId: string,
  roleId: string | undefined,
  status: string | undefined
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  if (roleId) {
    params.push(roleId);
    assignments.push(`role_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    assignments.push(`status = $${params.length}`);
  }

  if (assignments.length === 0) {
    return;
  }

  params.push(membershipId);
  await client.query(
    `UPDATE restaurant_users
     SET ${assignments.join(", ")}, updated_at = NOW()
     WHERE id = $${params.length}`,
    params
  );
}

export async function removeMember(
  restaurantId: string,
  actor: MembershipActor,
  membershipId: string,
  metadata: RequestMetadata
): Promise<void> {
  const { rows: targets } = await query<{
    id: string;
    user_id: string;
    status: string;
    role_key: string;
  }>(
    `SELECT ru.id, ru.user_id, ru.status, ro.key AS role_key
     FROM restaurant_users ru
     JOIN roles ro ON ro.id = ru.role_id
     WHERE ru.id = $1 AND ru.restaurant_id = $2`,
    [membershipId, restaurantId]
  );
  const target = targets[0];

  if (!target) {
    throw new NotFoundError("The team member was not found");
  }

  if (target.id === actor.membershipId) {
    throw new BadRequestError("You cannot remove yourself from the restaurant");
  }

  await transaction(async (client) => {
    if (target.role_key === "OWNER") {
      await assertOwnerRemains(client, restaurantId, target.id);
    }

    await client.query(
      `UPDATE restaurant_users SET status = 'REMOVED', updated_at = NOW() WHERE id = $1`,
      [target.id]
    );

    await recordAudit(client, {
      restaurantId,
      actorUserId: actor.userId,
      action: "MEMBERSHIP_REMOVED",
      entityType: "RestaurantUser",
      entityId: target.id,
      before: { status: target.status, roleKey: target.role_key },
      after: { status: "REMOVED" },
      ip: metadata.ip,
      userAgent: metadata.userAgent
    });
  });
}

export async function listRolesAndPermissions(): Promise<{
  roles: Array<{
    key: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    permissions: string[];
  }>;
  permissions: Array<{
    key: string;
    module: string;
    description: string;
  }>;
}> {
  const [{ rows: roles }, { rows: permissions }] = await Promise.all([
    query<{
      id: string;
      key: string;
      name: string;
      description: string | null;
      is_system: boolean;
    }>(`SELECT id, key, name, description, is_system FROM roles ORDER BY name ASC`),
    query<{ key: string; module: string; description: string }>(
      `SELECT key, module, description FROM permissions ORDER BY module ASC, key ASC`
    )
  ]);

  const { rows: rolePermissions } = await query<{ role_id: string; key: string }>(
    `SELECT rp.role_id, p.key
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id`
  );

  const permissionsByRole = new Map<string, string[]>();
  for (const permission of rolePermissions) {
    const list = permissionsByRole.get(permission.role_id) ?? [];
    list.push(permission.key);
    permissionsByRole.set(permission.role_id, list);
  }

  return {
    roles: roles.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.is_system,
      permissions: (permissionsByRole.get(role.id) ?? []).sort()
    })),
    permissions
  };
}
