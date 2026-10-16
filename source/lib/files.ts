import { put, list } from "@vercel/blob";
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

function blobStore(): FileStore {
  const token = process.env.BLOB_READ_WRITE_TOKEN!;
  return {
    async put(key, value, options) {
      await put(key, await toBuffer(value), {
        access: "public",
        token,
        contentType: options?.httpMetadata?.contentType || "application/octet-stream",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
    async get(key) {
      try {
        const { blobs } = await list({ prefix: key, limit: 20, token });
        const match =
          blobs.find((b) => b.pathname === key) ||
          blobs.find((b) => b.pathname.endsWith(`/${key}`)) ||
          blobs[0];
        if (!match) return null;
        const res = await fetch(match.url);
        if (!res.ok) return null;
        return { body: await res.arrayBuffer() };
      } catch {
        return null;
      }
    },
  };
}

export function getFiles(): FileStore | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStore();
  if (process.env.VERCEL) return undefined;
  return localStore();
}
