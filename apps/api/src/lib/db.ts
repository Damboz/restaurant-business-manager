import { Pool, type QueryResult } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("❌ DATABASE_URL environment variable is required");
}

export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.query("SELECT 1 as test").then(() => {
  console.log("✅ PostgreSQL connected via pg (Neon DB)");
}).catch((err) => {
  console.error("❌ PostgreSQL connection failed:", err.message);
  process.exit(1);
});

export type { QueryResult } from "pg";

export async function query(
  text: string,
  params?: any[]
): Promise<QueryResult<any>> {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } catch (error) {
    console.error("❌ Query error:", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function transaction<T>(
  fn: (client: any) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}