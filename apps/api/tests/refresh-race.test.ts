import { beforeEach, describe, expect, it, vi } from "vitest";

const { transaction, client } = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    transaction: vi.fn(
      async (callback: (queryClient: typeof client) => unknown) =>
        callback(client)
    )
  };
});

vi.mock("../src/lib/db.js", () => ({
  transaction,
  query: vi.fn(),
  pool: { query: vi.fn() },
  closePool: vi.fn()
}));

import { refreshSession } from "../src/modules/auth/auth.service.js";

describe("refresh token rotation race", () => {
  beforeEach(() => {
    client.query.mockReset();
    transaction.mockClear();
  });

  it("revokes the family when another request wins the rotation race", async () => {
    client.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "refresh-1",
            user_id: "user-1",
            family_id: "00000000-0000-0000-0000-000000000001",
            expires_at: new Date(Date.now() + 60_000),
            revoked_at: null
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [{ status: "ACTIVE" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(
      refreshSession("a".repeat(64), { ip: "127.0.0.1" })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED"
    });

    const calls = client.query.mock.calls;
    expect(calls[2]?.[0]).toContain("revoked_reason = 'ROTATED'");
    expect(calls[2]?.[1]).toEqual(["refresh-1"]);
    expect(calls[3]?.[0]).toContain("REUSE_DETECTED");
    expect(calls[3]?.[1]).toEqual([
      "00000000-0000-0000-0000-000000000001"
    ]);
    expect(calls).toHaveLength(4);
  });
});
