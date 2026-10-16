# Reliability Intelligence (iAPM)

Private synthetic APM demonstration, adapted for **Vercel** hosting.

## Stack
- Next.js App Router + React/TypeScript
- Turso (libSQL) for SQLite-compatible persistence (accounts, sessions, records)
- Vercel Blob for historical PDF archive storage
- Email/password application sessions (HttpOnly cookie, 8 hours)

See [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) for environment setup and deploy steps.

## Local development
```bash
cp .env.example .env.local
# Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
# or LIBSQL_URL=file:./.data/local.db for offline SQLite
pnpm install
pnpm dev
```

First visit creates the owner account when no accounts exist (or `ALLOW_OWNER_SETUP=true`).

## Validation
```bash
node tests/domain.test.mjs
node tests/api.test.mjs
```

## Product modules
- `lib/domain.ts`: deterministic synthetic data and shared economics
- `lib/models.ts`: model family comparisons
- `lib/validation.ts`: server record constraints
- `docs/functional-parity.md`: implemented/partial statuses
