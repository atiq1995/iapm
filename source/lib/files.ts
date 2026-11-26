import { put, get as blobGet } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredObject = { body: ArrayBuffer };

export type FileStore = {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
};

const localRoot = path.join(process.cwd(), ".data", "files");

function toBuffer(value: ArrayBuffer | Uint8Array | Blob): Promise<Buffer> | Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value.arrayBuffer().then((b) => Buffer.from(b));
}

function localStore(): FileStore {
  return {
    async put(key, value, options) {
      const full = path.join(localRoot, key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, await toBuffer(value));
      if (options?.httpMetadata?.contentType) {
        await writeFile(`${full}.ctype`, options.httpMetadata.contentType, "utf8");
      }
    },
    async get(key) {
      try {
        const bytes = await readFile(path.join(localRoot, key));
        return { body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      } catch {
        return null;
      }
    },
  };
}

/** Read-write token: the classic name, or a custom-prefixed one (e.g. IAPM_READ_WRITE_TOKEN). */
function blobToken(): string | undefined {
  const classic = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (classic) return classic;
  for (const [name, value] of Object.entries(process.env))
    if (name.endsWith("_READ_WRITE_TOKEN") && value?.trim().startsWith("vercel_blob_rw_")) return value.trim();
  return undefined;
}

/** Newer Vercel Blob connections use BLOB_STORE_ID + Vercel's built-in OIDC sign-in instead of a token. */
function blobConfigured() {
  return !!blobToken() || !!process.env.BLOB_STORE_ID?.trim();
}

type Access = "private" | "public";
// Files are stored privately and served only through the signed-in API. A store created as
// public refuses private writes, so fall back to public once and remember it.
let storeAccess: Access = "private";

function blobStore(): FileStore {
  const token = blobToken();
  const auth = token ? { token } : {};
  return {
    async put(key, value, options) {
      const body = await toBuffer(value);
      const write = (access: Access) =>
        put(key, body, {
          access,
          ...auth,
          contentType: options?.httpMetadata?.contentType || "application/octet-stream",
          addRandomSuffix: false,
          allowOverwrite: true,
        });
      try {
        await write(storeAccess);
      } catch (first) {
        const other: Access = storeAccess === "private" ? "public" : "private";
        try {
          await write(other);
        } catch {
          console.error("Blob upload failed:", (first as Error)?.message);
          throw first;
        }
        storeAccess = other;
      }
    },
    async get(key) {
      for (const access of [storeAccess, storeAccess === "private" ? "public" : "private"] as Access[]) {
        try {
          const r = await blobGet(key, { access, ...auth });
          if (r?.statusCode === 200 && r.stream) return { body: await new Response(r.stream).arrayBuffer() };
        } catch {
          /* try the other access type */
        }
      }
      return null;
    },
  };
}

export function getFiles(): FileStore | undefined {
  if (blobConfigured()) return blobStore();
  if (process.env.VERCEL) return undefined;
  return localStore();
}
