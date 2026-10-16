import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

export function getDb() {
  const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
  if (!url) {
    throw new Error(
      "Database unavailable. Set TURSO_DATABASE_URL (or LIBSQL_URL) before using the database.",
    );
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN,
  });

  return drizzle(client, { schema });
}
