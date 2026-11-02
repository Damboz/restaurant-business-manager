import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../lib/password.js";

const roleKey = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[A-Z][A-Z_]*$/, "Role key must be uppercase");

const permissionKey = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, "Invalid permission key");

export const membershipIdParamsSchema = z.object({
  membershipId: z.string().uuid()
});

export const listMembersQuerySchema = z.object({
  status: z.enum(["ACTIVE", "INVITED", "SUSPENDED", "REMOVED"]).optional(),
  search: z.string().trim().max(150).optional()
});

export const createMemberSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(254).optional(),
  roleKey,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH)
    .max(PASSWORD_MAX_LENGTH)
    .optional(),
  language: z.enum(["en", "ny"]).default("en")
});

export const updateMemberSchema = z
  .object({
    roleKey: roleKey.optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    permissionOverrides: z
      .array(
        z.object({
          key: permissionKey,
          effect: z.enum(["ALLOW", "DENY"])
        })
      )
      .max(200)
      .refine(
        (overrides) =>
          new Set(overrides.map((override) => override.key)).size ===
          overrides.length,
        { message: "Permission overrides must not contain duplicates" }
      )
      .optional()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field is required"
  });

export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
