import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/lib/phone.js";
import {
  hashPassword,
  validatePassword,
  verifyPassword
} from "../src/lib/password.js";
import { signAccessToken, verifyAccessToken } from "../src/lib/jwt.js";
import {
  generateRefreshToken,
  hashRefreshToken
} from "../src/lib/refresh-tokens.js";

describe("Malawi phone normalization", () => {
  it("normalizes local and international formats to E.164", () => {
    expect(normalizePhone("0991 234 567")).toBe("+265991234567");
    expect(normalizePhone("+265 991 234 567")).toBe("+265991234567");
  });

  it("rejects invalid numbers", () => {
    expect(() => normalizePhone("123")).toThrow();
  });
});

describe("password policy", () => {
  it("accepts a strong password", () => {
    expect(validatePassword("Restaurant2026")).toBeNull();
  });

  it("requires letters and numbers", () => {
    expect(validatePassword("onlyletters")).not.toBeNull();
    expect(validatePassword("1234567890")).not.toBeNull();
  });

  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("Restaurant2026");

    expect(hash).not.toBe("Restaurant2026");
    await expect(verifyPassword("Restaurant2026", hash)).resolves.toBe(true);
    await expect(verifyPassword("WrongPassword1", hash)).resolves.toBe(false);
  });
});

describe("access tokens", () => {
  it("round-trips a valid token", () => {
    const access = signAccessToken("user-id");
    const payload = verifyAccessToken(access.token);

    expect(payload.userId).toBe("user-id");
    expect(access.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered token", () => {
    const access = signAccessToken("user-id");
    const tampered = `${access.token.slice(0, -2)}aa`;

    expect(() => verifyAccessToken(tampered)).toThrow();
  });
});

describe("refresh tokens", () => {
  it("hashes deterministically without storing the raw token", () => {
    const generated = generateRefreshToken();

    expect(generated.tokenHash).toHaveLength(64);
    expect(generated.tokenHash).toBe(hashRefreshToken(generated.token));
    expect(generated.tokenHash).not.toContain(generated.token);
  });

  it("generates unique tokens and respects the family id", () => {
    const first = generateRefreshToken("00000000-0000-0000-0000-000000000001");
    const second = generateRefreshToken("00000000-0000-0000-0000-000000000001");

    expect(first.token).not.toBe(second.token);
    expect(first.familyId).toBe(second.familyId);
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
