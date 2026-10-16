import { cookies } from "next/headers";
import { getD1 } from "@/lib/d1-compat";

export type AppUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export function db() {
  return getD1();
}

export const hex = (a: ArrayBuffer) =>
  Array.from(new Uint8Array(a), (b) => b.toString(16).padStart(2, "0")).join("");

export async function digest(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

export async function hash(p: string, s: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(p),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode(s),
        iterations: 100000,
        hash: "SHA-256",
      },
      k,
      256,
    ),
  );
}

export async function identity(): Promise<AppUser | null> {
  const c = (await cookies()).get("ri_session")?.value;
  if (!c) return null;
  const session = await db()
    .prepare("SELECT owner FROM sessions WHERE id=? AND expires>?")
    .bind(await digest(c), Date.now())
    .first<{ owner: string }>();
  if (!session) return null;
  const account = await db()
    .prepare("SELECT id,email FROM accounts WHERE id=?")
    .bind(session.owner)
    .first<{ id: string; email: string }>();
  if (!account) return null;
  return {
    userId: account.id,
    email: account.email,
    displayName: account.email,
    fullName: null,
  };
}

export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(req.url).origin;
}

export function sessionCookie(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  const parts = [
    `ri_session=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  return `ri_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}
