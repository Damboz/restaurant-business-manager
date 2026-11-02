import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.js";
import { UnauthorizedError } from "./errors.js";

const ISSUER = "restaurant-business-manager-api";
const AUDIENCE = "restaurant-business-manager-app";
const ALGORITHM = "HS256" as const;

export type AccessToken = {
  token: string;
  expiresAt: Date;
};

type ValidatedAccessToken = {
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

export function signAccessToken(userId: string): AccessToken {
  const token = jwt.sign(
    { tokenType: "access" },
    env.accessTokenSecret,
    {
      algorithm: ALGORITHM,
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: env.accessTokenTtlSeconds
    }
  );

  const decoded = jwt.decode(token);

  if (!decoded || typeof decoded === "string" || typeof decoded.exp !== "number") {
    throw new Error("Unable to determine access token expiry");
  }

  return {
    token,
    expiresAt: new Date(decoded.exp * 1000)
  };
}

export function verifyAccessToken(token: string): ValidatedAccessToken {
  try {
    const payload = jwt.verify(token, env.accessTokenSecret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE
    }) as JwtPayload;

    if (
      payload.tokenType !== "access" ||
      typeof payload.sub !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      throw new UnauthorizedError("The access token is invalid");
    }

    return {
      userId: payload.sub,
      issuedAt: payload.iat,
      expiresAt: payload.exp
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }

    throw new UnauthorizedError("The access token is invalid or expired");
  }
}
