import dns from "node:dns";
import net from "node:net";
import { Pool, types, type PoolClient, type QueryResult } from "pg";

// Node's Happy Eyeballs can stall connections when an IPv6 route is advertised
// but unreachable; prefer IPv4 and fall back to sequential attempts.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Return DATE columns as the raw ISO date string so business dates never shift
// because of the server's local timezone.
types.setTypeParser(1082, (value: string) => value);

const requiresSsl =
  process.env.DATABASE_SSL === "true" ||
  /sslmode=(require|verify-ca|verify-full)/i.test(connectionString) ||
  /[?&]ssl=true/i.test(connectionString);

export const pool = new Pool({
  connectionString,
  ...(requiresSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

export type DbClient = PoolClient;

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params) as Promise<QueryResult<T>>;
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures; surface the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
