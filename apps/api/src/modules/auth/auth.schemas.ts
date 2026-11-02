import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../lib/password.js";

const phone = z.string().trim().min(7).max(30);
const email = z.string().trim().email().max(254);
const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .regex(/[A-Za-z]/, "Password must include at least one letter")
  .regex(/\d/, "Password must include at least one number");

const language = z.enum(["en", "ny"]).default("en");

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  phone,
  email: email.optional(),
  password,
  restaurantName: z.string().trim().min(2).max(150),
  restaurantPhone: phone.optional(),
  restaurantAddress: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  language
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH)
});

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(32).max(512)
});

export const logoutSchema = z.object({
  refreshToken: z.string().trim().min(32).max(512)
});

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(150).optional(),
    email: email.nullable().optional(),
    language: z.enum(["en", "ny"]).optional()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one profile field is required"
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: password
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "The new password must be different from the current password",
    path: ["newPassword"]
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
