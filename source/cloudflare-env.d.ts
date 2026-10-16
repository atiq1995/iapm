// Legacy Cloudflare typings retained for reference only.
// Vercel runtime uses process.env + Turso + Vercel Blob (see lib/runtime.ts).
declare namespace Cloudflare {
  interface Env {
    DB?: unknown;
    BUCKET?: unknown;
    FILES?: unknown;
  }
}
