import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";
import { pool, query, transaction, type DbClient } from "../../lib/db.js";
import {
  AppError,
  BadRequestError,
  ConflictError,
  UnauthorizedError
} from "../../lib/errors.js";
import { hashPassword, validatePassword, verifyPassword } from "../../lib/password.js";
import { normalizeEmail, normalizePhone } from "../../lib/phone.js";
import { signAccessToken } from "../../lib/jwt.js";
import { resolvePermissions, type PermissionEffect } from "../../lib/permissions.js";
import { generateRefreshToken, hashRefreshToken } from "../../lib/refresh-tokens.js";
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput
} from "./auth.schemas.js";

const DUMMY_PASSWORD_HASH = bcrypt.hashSync("timing-safe-placeholder-password", env.bcryptRounds);

type RequestMetadata = {
  ip?: string;
  userAgent?: string;
};

export type SessionTokens = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

export type UserProfile = {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  language: "en" | "ny";
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  memberships: Array<{
    id: string;
    status: string;
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
  }>;
};

type UserRow = {
  id: string;
  phone: string;
  email: string | null;
  full_name: string;
  language: "EN" | "NY";
  status: string;
  must_change_password: boolean;
  last_login_at: Date | null;
  created_at: Date;
  password_hash: string;
};

type MembershipRow = {
  id: string;
  status: string;
  joined_at: Date;
  role_id: string;
  role_key: string;
  role_name: string;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_currency: string;
  restaurant_timezone: string;
  restaurant_status: string;
};

function languageValue(language: "en" | "ny"): "EN" | "NY" {
  return language === "ny" ? "NY" : "EN";
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

async function serializeProfile(
  client: Pick<DbClient, "query"> | typeof pool,
  user: UserRow
): Promise<UserProfile> {
  const { rows: memberships } = await client.query<MembershipRow>(
    `SELECT ru.id, ru.status, ru.joined_at, ru.role_id,
            ro.key AS role_key, ro.name AS role_name,
            r.id AS restaurant_id, r.name AS restaurant_name,
            r.currency AS restaurant_currency, r.timezone AS restaurant_timezone,
            r.status AS restaurant_status
     FROM restaurant_users ru
     JOIN restaurants r ON r.id = ru.restaurant_id
     JOIN roles ro ON ro.id = ru.role_id
     WHERE ru.user_id = $1 AND ru.status = 'ACTIVE' AND r.status = 'ACTIVE'
     ORDER BY ru.created_at ASC`,
    [user.id]
  );

  const { rows: rolePermissions } = await client.query<{
    role_id: string;
    key: string;
  }>(
    `SELECT rp.role_id, p.key
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ANY($1::uuid[])`,
    [memberships.map((membership) => membership.role_id)]
  );

  const { rows: overrides } = await client.query<{
    restaurant_user_id: string;
    effect: PermissionEffect;
    key: string;
  }>(
    `SELECT rup.restaurant_user_id, rup.effect, p.key
     FROM restaurant_user_permissions rup
     JOIN permissions p ON p.id = rup.permission_id
     WHERE rup.restaurant_user_id = ANY($1::uuid[])`,
    [memberships.map((membership) => membership.id)]
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
  for (const override of overrides) {
    const list = overridesByMembership.get(override.restaurant_user_id) ?? [];
    list.push({ key: override.key, effect: override.effect });
    overridesByMembership.set(override.restaurant_user_id, list);
  }

  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    fullName: user.full_name,
    language: user.language === "NY" ? "ny" : "en",
    status: user.status,
    mustChangePassword: user.must_change_password,
    lastLoginAt: user.last_login_at?.toISOString() ?? null,
    createdAt: user.created_at.toISOString(),
    memberships: memberships.map((membership) => ({
      id: membership.id,
      status: membership.status,
      joinedAt: membership.joined_at.toISOString(),
      restaurant: {
        id: membership.restaurant_id,
        name: membership.restaurant_name,
        currency: membership.restaurant_currency,
        timezone: membership.restaurant_timezone,
        status: membership.restaurant_status
      },
      role: {
        key: membership.role_key,
        name: membership.role_name
      },
      permissions: resolvePermissions(
        rolePermissionsByRole.get(membership.role_id) ?? [],
        overridesByMembership.get(membership.id) ?? []
      )
    }))
  };
}

async function getUserProfile(userId: string): Promise<UserProfile> {
  const { rows } = await query<UserRow>(`SELECT * FROM users WHERE id = $1`, [userId]);
  const user = rows[0];

  if (!user || user.status !== "ACTIVE") {
    throw new UnauthorizedError("The account is not active");
  }

  return serializeProfile(pool, user);
}

async function issueSession(userId: string, metadata: RequestMetadata): Promise<SessionTokens> {
  const refresh = generateRefreshToken();
  const access = signAccessToken(userId);

  await query(
    `INSERT INTO refresh_tokens
       (id, user_id, token_hash, family_id, expires_at, created_by_ip, user_agent, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())`,
    [
      userId,
      refresh.tokenHash,
      refresh.familyId,
      refresh.expiresAt,
      metadata.ip ?? null,
      metadata.userAgent ?? null
    ]
  );

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt.toISOString()
  };
}

async function findUserByIdentifier(identifier: string): Promise<UserRow | null> {
  if (identifier.includes("@")) {
    const { rows } = await query<UserRow>(`SELECT * FROM users WHERE email = $1`, [
      normalizeEmail(identifier)
    ]);
    return rows[0] ?? null;
  }

  try {
    const { rows } = await query<UserRow>(`SELECT * FROM users WHERE phone = $1`, [
      normalizePhone(identifier)
    ]);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function register(
  input: RegisterInput,
  metadata: RequestMetadata
): Promise<{ user: UserProfile; tokens: SessionTokens }> {
  const passwordError = validatePassword(input.password);

  if (passwordError) {
    throw new BadRequestError(passwordError, { field: "password" });
  }

  const phone = normalizePhone(input.phone);
  const email = input.email ? normalizeEmail(input.email) : null;
  const restaurantPhone = input.restaurantPhone
    ? normalizePhone(input.restaurantPhone)
    : phone;
  const passwordHash = await hashPassword(input.password);

  let userId: string;

  try {
    userId = await transaction(async (client) => {
      const { rows: existing } = await client.query(
        `SELECT id FROM users WHERE phone = $1 OR ($2::varchar IS NOT NULL AND email = $2)
         LIMIT 1`,
        [phone, email]
      );

      if (existing.length > 0) {
        throw new ConflictError("A user with this phone number or email already exists");
      }

      const { rows: ownerRoles } = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE key = 'OWNER' LIMIT 1`
      );
      const ownerRole = ownerRoles[0];

      if (!ownerRole) {
        throw new AppError(
          500,
          "SETUP_REQUIRED",
          "The OWNER role is missing. Run the database seed before registering users."
        );
      }

      const { rows: users } = await client.query<{ id: string }>(
        `INSERT INTO users
           (id, phone, email, full_name, password_hash, language, last_login_at, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW(), NOW())
         RETURNING id`,
        [phone, email, input.fullName, passwordHash, languageValue(input.language)]
      );
      const user = users[0]!;

      const { rows: restaurants } = await client.query<{ id: string }>(
        `INSERT INTO restaurants
           (id, name, phone, email, address_line, city, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
        [
          input.restaurantName,
          restaurantPhone,
          email,
          input.restaurantAddress ?? null,
          input.city ?? null
        ]
      );
      const restaurant = restaurants[0]!;

      await client.query(
        `INSERT INTO restaurant_users
           (id, restaurant_id, user_id, role_id, status, joined_at, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, 'ACTIVE', NOW(), NOW(), NOW())`,
        [restaurant.id, user.id, ownerRole.id]
      );

      return user.id;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("A user with this phone number or email already exists");
    }

    throw error;
  }

  return {
    user: await getUserProfile(userId),
    tokens: await issueSession(userId, metadata)
  };
}

export async function login(
  input: LoginInput,
  metadata: RequestMetadata
): Promise<{ user: UserProfile; tokens: SessionTokens }> {
  const user = await findUserByIdentifier(input.identifier);

  if (!user) {
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    throw new UnauthorizedError("Invalid phone/email or password");
  }

  const passwordMatches = await verifyPassword(input.password, user.password_hash);

  if (!passwordMatches || user.status !== "ACTIVE") {
    throw new UnauthorizedError("Invalid phone/email or password");
  }

  await query(`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [
    user.id
  ]);

  return {
    user: await getUserProfile(user.id),
    tokens: await issueSession(user.id, metadata)
  };
}

type RefreshOutcome =
  | { kind: "ok"; userId: string; refresh: ReturnType<typeof generateRefreshToken> }
  | { kind: "invalid" }
  | { kind: "reuse" }
  | { kind: "expired" }
  | { kind: "inactive" };

export async function refreshSession(
  rawToken: string,
  metadata: RequestMetadata
): Promise<{ user: UserProfile; tokens: SessionTokens }> {
  const tokenHash = hashRefreshToken(rawToken);

  const outcome: RefreshOutcome = await transaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      user_id: string;
      family_id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, family_id, expires_at, revoked_at
       FROM refresh_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    const stored = rows[0];

    if (!stored) {
      return { kind: "invalid" };
    }

    if (stored.revoked_at) {
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW(), revoked_reason = 'REUSE_DETECTED'
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [stored.family_id]
      );

      return { kind: "reuse" };
    }

    if (stored.expires_at.getTime() <= Date.now()) {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = 'EXPIRED' WHERE id = $1`,
        [stored.id]
      );

      return { kind: "expired" };
    }

    const { rows: users } = await client.query<{ status: string }>(
      `SELECT status FROM users WHERE id = $1`,
      [stored.user_id]
    );

    if (!users[0] || users[0].status !== "ACTIVE") {
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW(), revoked_reason = 'ACCOUNT_INACTIVE'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [stored.user_id]
      );

      return { kind: "inactive" };
    }

    const refresh = generateRefreshToken(stored.family_id);

    const rotated = await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), revoked_reason = 'ROTATED'
       WHERE id = $1 AND revoked_at IS NULL`,
      [stored.id]
    );

    if (rotated.rowCount === 0) {
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW(), revoked_reason = 'REUSE_DETECTED'
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [stored.family_id]
      );

      return { kind: "reuse" };
    }

    await client.query(
      `INSERT INTO refresh_tokens
         (id, user_id, token_hash, family_id, expires_at, created_by_ip, user_agent, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())`,
      [
        stored.user_id,
        refresh.tokenHash,
        refresh.familyId,
        refresh.expiresAt,
        metadata.ip ?? null,
        metadata.userAgent ?? null
      ]
    );

    return { kind: "ok", userId: stored.user_id, refresh };
  });

  if (outcome.kind !== "ok") {
    throw new UnauthorizedError("The session is invalid or has expired");
  }

  const access = signAccessToken(outcome.userId);

  return {
    user: await getUserProfile(outcome.userId),
    tokens: {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: outcome.refresh.token,
      refreshTokenExpiresAt: outcome.refresh.expiresAt.toISOString()
    }
  };
}

export async function logout(rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);

  await query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW(), revoked_reason = 'LOGOUT'
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
}

export async function getCurrentUser(userId: string): Promise<UserProfile> {
  return getUserProfile(userId);
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<UserProfile> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  if (input.fullName !== undefined) {
    params.push(input.fullName);
    assignments.push(`full_name = $${params.length}`);
  }

  if (input.language !== undefined) {
    params.push(languageValue(input.language));
    assignments.push(`language = $${params.length}`);
  }

  if (input.email !== undefined) {
    params.push(input.email === null ? null : normalizeEmail(input.email));
    assignments.push(`email = $${params.length}`);
  }

  if (assignments.length > 0) {
    params.push(userId);

    try {
      await query(
        `UPDATE users
         SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE id = $${params.length}`,
        params
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError("This email address is already in use");
      }

      throw error;
    }
  }

  return getUserProfile(userId);
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput
): Promise<void> {
  const { rows } = await query<{
    id: string;
    password_hash: string;
    status: string;
  }>(`SELECT id, password_hash, status FROM users WHERE id = $1`, [userId]);
  const user = rows[0];

  if (!user || user.status !== "ACTIVE") {
    throw new UnauthorizedError("The account is not active");
  }

  const currentPasswordMatches = await verifyPassword(
    input.currentPassword,
    user.password_hash
  );

  if (!currentPasswordMatches) {
    throw new BadRequestError("The current password is incorrect", {
      field: "currentPassword"
    });
  }

  const passwordError = validatePassword(input.newPassword);

  if (passwordError) {
    throw new BadRequestError(passwordError, { field: "newPassword" });
  }

  const passwordHash = await hashPassword(input.newPassword);

  await transaction(async (client) => {
    await client.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = false, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, userId]
    );

    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), revoked_reason = 'PASSWORD_CHANGED'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  });
}
