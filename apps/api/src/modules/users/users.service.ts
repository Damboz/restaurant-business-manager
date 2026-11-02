import { Prisma } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError
} from "../../lib/errors.js";
import {
  hashPassword,
  validatePassword
} from "../../lib/password.js";
import { resolvePermissions } from "../../lib/permissions.js";
import { normalizeEmail, normalizePhone } from "../../lib/phone.js";
import { prisma } from "../../lib/prisma.js";
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

const memberSelect = {
  id: true,
  status: true,
  joinedAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      language: true,
      status: true,
      mustChangePassword: true,
      lastLoginAt: true
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
} satisfies Prisma.RestaurantUserSelect;

type MemberRecord = Prisma.RestaurantUserGetPayload<{ select: typeof memberSelect }>;

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

function serializeMember(member: MemberRecord): MemberProfile {
  const overrides = member.permissionOverrides.map((override) => ({
    key: override.permission.key,
    effect: override.effect
  }));

  return {
    id: member.id,
    status: member.status,
    joinedAt: member.joinedAt.toISOString(),
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    user: {
      ...member.user,
      language: member.user.language === "NY" ? "ny" : "en",
      lastLoginAt: member.user.lastLoginAt?.toISOString() ?? null
    },
    role: {
      key: member.role.key,
      name: member.role.name
    },
    permissions: resolvePermissions(
      member.role.permissions.map(({ permission }) => permission.key),
      overrides
    ),
    permissionOverrides: overrides
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function findMember(
  restaurantId: string,
  membershipId: string
): Promise<MemberRecord> {
  const member = await prisma.restaurantUser.findFirst({
    where: { id: membershipId, restaurantId },
    select: memberSelect
  });

  if (!member) {
    throw new NotFoundError("The team member was not found");
  }

  return member;
}

async function assertOwnerRemains(
  client: Prisma.TransactionClient,
  restaurantId: string,
  excludedMembershipId: string
): Promise<void> {
  const ownerRole = await client.role.findUnique({
    where: { key: "OWNER" },
    select: { id: true }
  });

  if (!ownerRole) {
    throw new BadRequestError("The OWNER role is not configured");
  }

  const remainingOwners = await client.restaurantUser.count({
    where: {
      restaurantId,
      roleId: ownerRole.id,
      status: "ACTIVE",
      id: { not: excludedMembershipId }
    }
  });

  if (remainingOwners === 0) {
    throw new BadRequestError("The restaurant must keep at least one active owner");
  }
}

export async function listMembers(
  restaurantId: string,
  query: ListMembersQuery
): Promise<MemberProfile[]> {
  const search = query.search;

  const members = await prisma.restaurantUser.findMany({
    where: {
      restaurantId,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            user: {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
                { email: { contains: search, mode: "insensitive" } }
              ]
            }
          }
        : {})
    },
    orderBy: [{ status: "asc" }, { joinedAt: "asc" }],
    select: memberSelect
  });

  return members.map(serializeMember);
}

export async function getMember(
  restaurantId: string,
  membershipId: string
): Promise<MemberProfile> {
  return serializeMember(await findMember(restaurantId, membershipId));
}

export async function createMember(
  restaurantId: string,
  actor: MembershipActor,
  input: CreateMemberInput,
  metadata: RequestMetadata
): Promise<MemberProfile> {
  const phone = normalizePhone(input.phone);
  const email = input.email ? normalizeEmail(input.email) : null;

  let membership: MemberRecord;

  try {
    membership = await prisma.$transaction(
      async (transaction) => {
        const role = await transaction.role.findUnique({
          where: { key: input.roleKey },
          select: { id: true, key: true }
        });

        if (!role) {
          throw new BadRequestError("The selected role does not exist", {
            field: "roleKey"
          });
        }

        if (role.key === "OWNER" && actor.roleKey !== "OWNER") {
          throw new ForbiddenError("Only an owner can add another owner");
        }

        const existingUser = await transaction.user.findFirst({
          where: {
            OR: [{ phone }, ...(email ? [{ email }] : [])]
          },
          select: { id: true, status: true }
        });

        let userId: string;

        if (existingUser) {
          if (existingUser.status !== "ACTIVE") {
            throw new ForbiddenError("This account is not active");
          }

          const existingMembership = await transaction.restaurantUser.findUnique({
            where: {
              restaurantId_userId: {
                restaurantId,
                userId: existingUser.id
              }
            },
            select: { id: true }
          });

          if (existingMembership) {
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

          const user = await transaction.user.create({
            data: {
              phone,
              email,
              fullName: input.fullName,
              passwordHash: await hashPassword(input.password),
              language: input.language === "ny" ? "NY" : "EN",
              mustChangePassword: true
            },
            select: { id: true }
          });

          userId = user.id;
        }

        const created = await transaction.restaurantUser.create({
          data: {
            restaurantId,
            userId,
            roleId: role.id,
            status: "ACTIVE",
            invitedByUserId: actor.userId,
            invitedAt: new Date(),
            acceptedAt: new Date()
          },
          select: memberSelect
        });

        await recordAudit(transaction, {
          restaurantId,
          actorUserId: actor.userId,
          action: existingUser ? "MEMBERSHIP_ADDED" : "USER_CREATED",
          entityType: "RestaurantUser",
          entityId: created.id,
          after: {
            userId,
            roleKey: role.key,
            status: created.status
          },
          ip: metadata.ip,
          userAgent: metadata.userAgent
        });

        return created;
      },
      { maxWait: 10_000, timeout: 20_000 }
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("This person is already a member of the restaurant");
    }

    throw error;
  }

  return serializeMember(membership);
}

export async function updateMember(
  restaurantId: string,
  actor: MembershipActor,
  membershipId: string,
  input: UpdateMemberInput,
  metadata: RequestMetadata
): Promise<MemberProfile> {
  const target = await prisma.restaurantUser.findFirst({
    where: { id: membershipId, restaurantId },
    select: {
      id: true,
      userId: true,
      status: true,
      role: { select: { id: true, key: true } },
      user: { select: { fullName: true, phone: true } }
    }
  });

  if (!target) {
    throw new NotFoundError("The team member was not found");
  }

  if (target.id === actor.membershipId && (input.roleKey || input.status)) {
    throw new BadRequestError("You cannot change your own role or status");
  }

  const role = input.roleKey
    ? await prisma.role.findUnique({
        where: { key: input.roleKey },
        select: { id: true, key: true }
      })
    : null;

  if (input.roleKey && !role) {
    throw new BadRequestError("The selected role does not exist", {
      field: "roleKey"
    });
  }

  if (role?.key === "OWNER" && actor.roleKey !== "OWNER") {
    throw new ForbiddenError("Only an owner can assign the owner role");
  }

  const ownerIsBeingRemoved =
    target.role.key === "OWNER" &&
    ((role && role.key !== "OWNER") ||
      (input.status !== undefined && input.status !== "ACTIVE"));

  const overrides = input.permissionOverrides;

  if (overrides) {
    const permissionKeys = overrides.map((override) => override.key);
    const existingPermissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true, key: true }
    });

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

    const before = await prisma.restaurantUserPermission.findMany({
      where: { restaurantUserId: target.id },
      select: {
        effect: true,
        permission: { select: { key: true } }
      }
    });

    await prisma.$transaction(
      async (transaction) => {
        if (ownerIsBeingRemoved) {
          await assertOwnerRemains(transaction, restaurantId, target.id);
        }

        await transaction.restaurantUser.update({
          where: { id: target.id },
          data: {
            ...(role ? { roleId: role.id } : {}),
            ...(input.status ? { status: input.status } : {})
          }
        });

        await transaction.restaurantUserPermission.deleteMany({
          where: { restaurantUserId: target.id }
        });

        if (overrides.length > 0) {
          await transaction.restaurantUserPermission.createMany({
            data: overrides.map((override) => ({
              restaurantUserId: target.id,
              permissionId: permissionIdByKey.get(override.key)!,
              effect: override.effect
            }))
          });
        }

        await recordAudit(transaction, {
          restaurantId,
          actorUserId: actor.userId,
          action: "MEMBERSHIP_UPDATED",
          entityType: "RestaurantUser",
          entityId: target.id,
          before: {
            roleKey: target.role.key,
            status: target.status,
            permissionOverrides: before.map((override) => ({
              key: override.permission.key,
              effect: override.effect
            }))
          },
          after: {
            roleKey: role?.key ?? target.role.key,
            status: input.status ?? target.status,
            permissionOverrides: overrides
          },
          ip: metadata.ip,
          userAgent: metadata.userAgent
        });
      },
      { maxWait: 10_000, timeout: 20_000 }
    );

    return serializeMember(await findMember(restaurantId, target.id));
  }

  await prisma.$transaction(
    async (transaction) => {
      if (ownerIsBeingRemoved) {
        await assertOwnerRemains(transaction, restaurantId, target.id);
      }

      await transaction.restaurantUser.update({
        where: { id: target.id },
        data: {
          ...(role ? { roleId: role.id } : {}),
          ...(input.status ? { status: input.status } : {})
        }
      });

      await recordAudit(transaction, {
        restaurantId,
        actorUserId: actor.userId,
        action: "MEMBERSHIP_UPDATED",
        entityType: "RestaurantUser",
        entityId: target.id,
        before: {
          roleKey: target.role.key,
          status: target.status
        },
        after: {
          roleKey: role?.key ?? target.role.key,
          status: input.status ?? target.status
        },
        ip: metadata.ip,
        userAgent: metadata.userAgent
      });
    },
    { maxWait: 10_000, timeout: 20_000 }
  );

  return serializeMember(await findMember(restaurantId, target.id));
}

export async function removeMember(
  restaurantId: string,
  actor: MembershipActor,
  membershipId: string,
  metadata: RequestMetadata
): Promise<void> {
  const target = await prisma.restaurantUser.findFirst({
    where: { id: membershipId, restaurantId },
    select: {
      id: true,
      userId: true,
      status: true,
      role: { select: { key: true } }
    }
  });

  if (!target) {
    throw new NotFoundError("The team member was not found");
  }

  if (target.id === actor.membershipId) {
    throw new BadRequestError("You cannot remove yourself from the restaurant");
  }

  await prisma.$transaction(
    async (transaction) => {
      if (target.role.key === "OWNER") {
        await assertOwnerRemains(transaction, restaurantId, target.id);
      }

      await transaction.restaurantUser.update({
        where: { id: target.id },
        data: { status: "REMOVED" }
      });

      await recordAudit(transaction, {
        restaurantId,
        actorUserId: actor.userId,
        action: "MEMBERSHIP_REMOVED",
        entityType: "RestaurantUser",
        entityId: target.id,
        before: { status: target.status, roleKey: target.role.key },
        after: { status: "REMOVED" },
        ip: metadata.ip,
        userAgent: metadata.userAgent
      });
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
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
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({
      orderBy: { name: "asc" },
      select: {
        key: true,
        name: true,
        description: true,
        isSystem: true,
        permissions: {
          select: {
            permission: { select: { key: true } }
          }
        }
      }
    }),
    prisma.permission.findMany({
      orderBy: [{ module: "asc" }, { key: "asc" }],
      select: { key: true, module: true, description: true }
    })
  ]);

  return {
    roles: roles.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.permissions
        .map(({ permission }) => permission.key)
        .sort()
    })),
    permissions
  };
}
