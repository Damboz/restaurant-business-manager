import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { env } from "../config/env.js";

export type GeneratedRefreshToken = {
  token: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
};

export function hashRefreshToken(token: string): string {
  return createHmac("sha256", env.refreshTokenPepper).update(token, "utf8").digest("hex");
}

export function generateRefreshToken(familyId: string = randomUUID()): GeneratedRefreshToken {
  const token = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  return {
    token,
    tokenHash: hashRefreshToken(token),
    familyId,
    expiresAt
  };
}
