import bcrypt from "bcryptjs";
import { Prisma, type User } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AppError, BadRequestError, ConflictError, UnauthorizedError } from "../../lib/errors.js";
import { hashPassword, validatePassword, verifyPassword } from "../../lib/password.js";
import { normalizeEmail, normalizePhone } from "../../lib/phone.js";
import { signAccessToken } from "../../lib/jwt.js";
import { resolvePermissions } from "../../lib/permissions.js";
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

const userProfileSelect = {
  id: true,
  phone: true,
  email: true,
  fullName: true,
  language: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  memberships: {
    where: {
      status: "ACTIVE",
      restaurant: { status: "ACTIVE" }
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
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
  }
} satisfies Prisma.UserSelect;

type UserProfileRecord = Prisma.UserGetPayload<{ select: typeof userProfileSelect }>;

function serializeProfile(user: UserProfileRecord): UserProfile {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    fullName: user.fullName,
    language: user.language === "NY" ? "ny" : "en",
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    memberships: user.memberships.map((membership) => ({
      id: membership.id,
      status: membership.status,
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
    }))
  };
}

function languageValue(language: "en" | "ny"): "EN" | "NY" {
  return language === "ny" ? "NY" : "EN";
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function getUserProfile(userId: string): Promise<UserProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userProfileSelect
  });

  if (!user || user.status !== "ACTIVE") {
    throw new UnauthorizedError("The account is not active");
  }

  return serializeProfile(user);
}

async function issueSession(userId: string, metadata: RequestMetadata): Promise<SessionTokens> {
  const refresh = generateRefreshToken();
  const access = signAccessToken(userId);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: refresh.tokenHash,
      familyId: refresh.familyId,
      expiresAt: refresh.expiresAt,
      createdByIp: metadata.ip,
      userAgent: metadata.userAgent
    }
  });

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt.toISOString()
  };
}

async function findUserByIdentifier(identifier: string): Promise<User | null> {
  if (identifier.includes("@")) {
    return prisma.user.findUnique({
      where: { email: normalizeEmail(identifier) }
    });
  }

  try {
    return prisma.user.findUnique({
      where: { phone: normalizePhone(identifier) }
    });
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
    userId = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.user.findFirst({
        where: {
          OR: [
            { phone },
            ...(email ? [{ email }] : [])
          ]
        },
        select: { id: true }
      });

      if (existing) {
        throw new ConflictError("A user with this phone number or email already exists");
      }

      const ownerRole = await transaction.role.findUnique({
        where: { key: "OWNER" },
        select: { id: true }
      });

      if (!ownerRole) {
        throw new AppError(
          500,
          "SETUP_REQUIRED",
          "The OWNER role is missing. Run the database seed before registering users."
        );
      }

      const user = await transaction.user.create({
        data: {
          phone,
          email,
          fullName: input.fullName,
          passwordHash,
          language: languageValue(input.language),
          lastLoginAt: new Date()
        },
        select: { id: true }
      });

      const restaurant = await transaction.restaurant.create({
        data: {
          name: input.restaurantName,
          phone: restaurantPhone,
          email,
          addressLine: input.restaurantAddress,
          city: input.city
        },
        select: { id: true }
      });

      await transaction.restaurantUser.create({
        data: {
          restaurantId: restaurant.id,
          userId: user.id,
          roleId: ownerRole.id
        }
      });

      return user.id;
    }, {
      maxWait: 10_000,
      timeout: 20_000
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

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);

  if (!passwordMatches || user.status !== "ACTIVE") {
    throw new UnauthorizedError("Invalid phone/email or password");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

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

  const outcome: RefreshOutcome = await prisma.$transaction(async (transaction) => {
    const stored = await transaction.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true
      }
    });

    if (!stored) {
      return { kind: "invalid" };
    }

    if (stored.revokedAt) {
      await transaction.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: "REUSE_DETECTED"
        }
      });

      return { kind: "reuse" };
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      await transaction.refreshToken.update({
        where: { id: stored.id },
        data: {
          revokedAt: new Date(),
          revokedReason: "EXPIRED"
        }
      });

      return { kind: "expired" };
    }

    const user = await transaction.user.findUnique({
      where: { id: stored.userId },
      select: { status: true }
    });

    if (!user || user.status !== "ACTIVE") {
      await transaction.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: "ACCOUNT_INACTIVE"
        }
      });

      return { kind: "inactive" };
    }

    const refresh = generateRefreshToken(stored.familyId);

    const rotated = await transaction.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: "ROTATED"
      }
    });

    if (rotated.count === 0) {
      await transaction.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: "REUSE_DETECTED"
        }
      });

      return { kind: "reuse" };
    }

    await transaction.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: refresh.tokenHash,
        familyId: refresh.familyId,
        expiresAt: refresh.expiresAt,
        createdByIp: metadata.ip,
        userAgent: metadata.userAgent
      }
    });

    return { kind: "ok", userId: stored.userId, refresh };
  }, {
    maxWait: 10_000,
    timeout: 20_000
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

  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: {
      revokedAt: new Date(),
      revokedReason: "LOGOUT"
    }
  });
}

export async function getCurrentUser(userId: string): Promise<UserProfile> {
  return getUserProfile(userId);
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<UserProfile> {
  const data: Prisma.UserUpdateInput = {};

  if (input.fullName !== undefined) {
    data.fullName = input.fullName;
  }

  if (input.language !== undefined) {
    data.language = languageValue(input.language);
  }

  if (input.email !== undefined) {
    data.email = input.email === null ? null : normalizeEmail(input.email);
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("This email address is already in use");
    }

    throw error;
  }

  return getUserProfile(userId);
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, status: true }
  });

  if (!user || user.status !== "ACTIVE") {
    throw new UnauthorizedError("The account is not active");
  }

  const currentPasswordMatches = await verifyPassword(
    input.currentPassword,
    user.passwordHash
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

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false }
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: "PASSWORD_CHANGED"
      }
    })
  ]);
}
