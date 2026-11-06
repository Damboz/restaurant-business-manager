import "dotenv/config";
import dns from "node:dns";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

const sqlDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql");
const files = ["001_init.sql", "002_business_core.sql"];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

const client = await pool.connect();

try {
  for (const file of files) {
    const sql = (await readFile(join(sqlDirectory, file), "utf8")).replace(/^\uFEFF/, "");
    await client.query(sql);
    console.log(`Applied ${file}`);
  }
} finally {
  client.release();
  await pool.end();
}
