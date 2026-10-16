import { createClient, type Client, type InArgs } from "@libsql/client";

type Bound = {
  bind(...values: unknown[]): Bound;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number }; changes: number }>;
  readonly sql: string;
  readonly args: unknown[];
};

let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  hash text NOT NULL,
  salt text NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id text PRIMARY KEY NOT NULL,
  count integer NOT NULL,
  until integer NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id text PRIMARY KEY NOT NULL,
  owner text NOT NULL,
  kind text NOT NULL,
  body text NOT NULL,
  updated integer NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY NOT NULL,
  owner text NOT NULL,
  expires integer NOT NULL
);
`;

function getClient(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
  if (!url) {
    throw new Error(
      "Database unavailable. Set TURSO_DATABASE_URL (or LIBSQL_URL) for Vercel/Turso.",
    );
  }
  client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN,
  });
  return client;
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const c = getClient();
      for (const statement of SCHEMA.split(";")
        .map((s) => s.trim())
        .filter(Boolean)) {
        await c.execute(statement);
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function prepare(sql: string): Bound {
  let args: unknown[] = [];
  const stmt: Bound = {
    sql,
    get args() {
      return args;
    },
    bind(...values: unknown[]) {
      args = values;
      return stmt;
    },
    async first<T = Record<string, unknown>>() {
      await ensureSchema();
      const result = await getClient().execute({
        sql,
        args: args as InArgs,
      });
      return (result.rows[0] as T) ?? null;
    },
    async all<T = Record<string, unknown>>() {
      await ensureSchema();
      const result = await getClient().execute({
        sql,
        args: args as InArgs,
      });
      return { results: result.rows as T[] };
    },
    async run() {
      await ensureSchema();
      const result = await getClient().execute({
        sql,
        args: args as InArgs,
      });
      const changes = Number(result.rowsAffected ?? 0);
      return { meta: { changes }, changes };
    },
  };
  return stmt;
}

export type D1Compat = {
  prepare(sql: string): Bound;
  batch(statements: Bound[]): Promise<unknown[]>;
};

export function getD1(): D1Compat {
  return {
    prepare,
    async batch(statements: Bound[]) {
      await ensureSchema();
      const c = getClient();
      const results = await c.batch(
        statements.map((s) => ({
          sql: s.sql,
          args: s.args as InArgs,
        })),
      );
      return results.map((r) => {
        const changes = Number(r.rowsAffected ?? 0);
        return { meta: { changes }, changes };
      });
    },
  };
}
