import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { authRateLimiter, refreshRateLimiter } from "../../middleware/rate-limit.js";
import { validateBody } from "../../middleware/validate.js";
import {
  changePassword,
  getCurrentUser,
  login,
  logout,
  refreshSession,
  register,
  updateProfile
} from "./auth.service.js";
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  updateProfileSchema
} from "./auth.schemas.js";

export const authRouter = Router();

function requestMetadata(request: Request): { ip?: string; userAgent?: string } {
  return {
    ip: request.ip,
    userAgent: request.get("user-agent")
  };
}

authRouter.post(
  "/register",
  authRateLimiter,
  validateBody(registerSchema),
  asyncHandler(async (request, response) => {
    const result = await register(request.body, requestMetadata(request));
    response.status(201).json({ data: result });
  })
);

authRouter.post(
  "/login",
  authRateLimiter,
  validateBody(loginSchema),
  asyncHandler(async (request, response) => {
    const result = await login(request.body, requestMetadata(request));
    response.json({ data: result });
  })
);

authRouter.post(
  "/refresh",
  refreshRateLimiter,
  validateBody(refreshSchema),
  asyncHandler(async (request, response) => {
    const result = await refreshSession(request.body.refreshToken, requestMetadata(request));
    response.json({ data: result });
  })
);

authRouter.post(
  "/logout",
  refreshRateLimiter,
  validateBody(logoutSchema),
  asyncHandler(async (request, response) => {
    await logout(request.body.refreshToken);
    response.status(204).send();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (request, response) => {
    const user = await getCurrentUser(request.user!.id);
    response.json({ data: { user } });
  })
);

authRouter.patch(
  "/me",
  requireAuth,
  validateBody(updateProfileSchema),
  asyncHandler(async (request, response) => {
    const user = await updateProfile(request.user!.id, request.body);
    response.json({ data: { user } });
  })
);

authRouter.post(
  "/change-password",
  requireAuth,
  authRateLimiter,
  validateBody(changePasswordSchema),
  asyncHandler(async (request, response) => {
    await changePassword(request.user!.id, request.body);
    response.status(204).send();
  })
);
