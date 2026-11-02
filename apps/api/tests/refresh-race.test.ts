import { beforeEach, describe, expect, it, vi } from "vitest";

const { transaction, prismaMock } = vi.hoisted(() => {
  const transaction = {
    refreshToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn()
    },
    user: {
      findUnique: vi.fn()
    }
  };

  return {
    transaction,
    prismaMock: {
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction)
      )
    }
  };
});

vi.mock("../src/lib/prisma.js", () => ({ prisma: prismaMock }));

import { refreshSession } from "../src/modules/auth/auth.service.js";

describe("refresh token rotation race", () => {
  beforeEach(() => {
    transaction.refreshToken.findUnique.mockReset();
    transaction.refreshToken.updateMany.mockReset();
    transaction.refreshToken.update.mockReset();
    transaction.refreshToken.create.mockReset();
    transaction.user.findUnique.mockReset();

    transaction.refreshToken.findUnique.mockResolvedValue({
      id: "refresh-1",
      userId: "user-1",
      familyId: "00000000-0000-0000-0000-000000000001",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null
    });
    transaction.user.findUnique.mockResolvedValue({ status: "ACTIVE" });
  });

  it("revokes the family when another request wins the rotation race", async () => {
    transaction.refreshToken.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(
      refreshSession("a".repeat(64), { ip: "127.0.0.1" })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED"
    });

    expect(transaction.refreshToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "refresh-1", revokedAt: null },
      data: expect.objectContaining({ revokedReason: "ROTATED" })
    });
    expect(transaction.refreshToken.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        familyId: "00000000-0000-0000-0000-000000000001",
        revokedAt: null
      },
      data: expect.objectContaining({ revokedReason: "REUSE_DETECTED" })
    });
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
  });
});
