# Deploy iAPM to Vercel

This package was originally Cloudflare Workers + D1 + R2. The Vercel adapter keeps the same screens, calculations, and API contracts, and replaces hosting dependencies as follows:

| Original | Vercel replacement |
|---|---|
| Vinext / Workers | Next.js App Router |
| Cloudflare D1 | Turso (libSQL / SQLite) |
| Cloudflare R2 | Vercel Blob |
| ChatGPT platform headers | Email + password sessions |

## 1. Create Turso database

```bash
# https://docs.turso.tech
turso db create iapm
turso db show iapm --url
turso db tokens create iapm
```

Apply schema (also auto-applied on first request):

```bash
turso db shell iapm < drizzle/0000_far_eternals.sql
```

## 2. Create Vercel project

1. Push the `source/` folder as the repository root (or set Root Directory to `source` in Vercel).
2. Framework preset: **Next.js**
3. Install command: `pnpm install --frozen-lockfile`
4. Build command: `pnpm build`
5. Node.js: **22.x**

## 3. Environment variables (Vercel → Settings → Environment Variables)

| Name | Required | Notes |
|---|---|---|
| `TURSO_DATABASE_URL` | yes | libsql://… |
| `TURSO_AUTH_TOKEN` | yes | Turso token |
| `BLOB_READ_WRITE_TOKEN` | yes for PDF archive | From Vercel Blob store |
| `ALLOW_OWNER_SETUP` | first deploy only | `true` until owner account exists, then remove |
| `OWNER_ID` | optional | Stable UUID if importing snapshot data |
| `OPENAI_API_KEY` | optional | Live AI only |
| `OPENAI_MODEL` | optional | Live AI only |

## 4. First login

1. Open the deployment URL.
2. Create the owner email + password (12–128 characters) while `ALLOW_OWNER_SETUP=true`.
3. Remove `ALLOW_OWNER_SETUP` from Vercel and redeploy (or leave unset).

## 5. Optional data migration

Follow `START_HERE_AGENT_INSTRUCTIONS.md` for snapshot export → `migration/snapshot-to-sql.py` → import into Turso, and upload PDFs into Blob using the **original snapshot file keys**.

## 6. Local development

```bash
cp .env.example .env.local
# Set TURSO_DATABASE_URL / token, or LIBSQL_URL=file:./.data/local.db
pnpm install
pnpm dev
```

Without `BLOB_READ_WRITE_TOKEN`, PDFs are stored under `.data/files/` locally.
