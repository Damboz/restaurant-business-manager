import type { RequestHandler } from "express";
import { verifyAccessToken } from "../lib/jwt.js";
import { UnauthorizedError } from "../lib/errors.js";
import { query } from "../lib/db.js";

type UserRow = {
  id: string;
  phone: string;
  email: string | null;
  full_name: string;
  language: "EN" | "NY";
  status: string;
};

export const requireAuth: RequestHandler = async (request, _response, next) => {
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

  try {
    const { rows } = await query<UserRow>(
      `SELECT id, phone, email, full_name, language, status
       FROM users
       WHERE id = $1`,
      [userId]
    );
    const user = rows[0];

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedError("The account is not active");
    }

    request.user = {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.full_name,
      language: user.language === "NY" ? "ny" : "en"
    };

    next();
  } catch (error) {
    next(error);
  }
};
