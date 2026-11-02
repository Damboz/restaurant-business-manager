import type { RequestHandler } from "express";
import { verifyAccessToken } from "../lib/jwt.js";
import { UnauthorizedError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export const requireAuth: RequestHandler = (request, _response, next) => {
  const match = /^Bearer\s+(.+)$/i.exec(request.header("authorization") ?? "");

  if (!match?.[1]) {
    next(new UnauthorizedError("An access token is required"));
    return;
  }

  let userId: string;

  try {
    userId = verifyAccessToken(match[1]).userId;
  } catch (error) {
    next(error);
    return;
  }

  prisma.user
    .findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        fullName: true,
        language: true,
        status: true
      }
    })
    .then((user) => {
      if (!user || user.status !== "ACTIVE") {
        throw new UnauthorizedError("The account is not active");
      }

      request.user = {
        id: user.id,
        phone: user.phone,
        email: user.email,
        fullName: user.fullName,
        language: user.language === "NY" ? "ny" : "en"
      };

      next();
    })
    .catch(next);
};
