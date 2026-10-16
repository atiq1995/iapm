import {
  db,
  digest,
  hash,
  sameOrigin,
  identity,
  sessionCookie,
  clearSessionCookie,
} from "@/lib/auth";

export async function POST(req: Request) {
  if (!sameOrigin(req))
    return Response.json({ error: "Request rejected" }, { status: 403 });
  try {
    const b: any = await req.json();
    const now = Date.now();

    if (b.action === "logout") {
      const token = req.headers.get("cookie")?.match(/ri_session=([^;]+)/)?.[1];
      const user = await identity();
      if (token && user) {
        await db()
          .prepare("DELETE FROM sessions WHERE id=? AND owner=?")
          .bind(await digest(token), user.userId)
          .run();
      } else if (token) {
        await db()
          .prepare("DELETE FROM sessions WHERE id=?")
          .bind(await digest(token))
          .run();
      }
      return Response.json(
        { ok: true },
        { headers: { "Set-Cookie": clearSessionCookie() } },
      );
    }

    const email =
      typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@"))
      return Response.json(
        { error: "Enter a valid email address." },
        { status: 400 },
      );

    const attemptKey = email;
    const a = await db()
      .prepare("SELECT * FROM attempts WHERE id=?")
      .bind(attemptKey)
      .first<{ count: number; until: number }>();
    if (a && a.until > now && a.count >= 5)
      return Response.json(
        {
          error:
            "Sign-in unavailable. Please try again in 15 minutes.",
        },
        { status: 429 },
      );
    await db()
      .prepare(
        "INSERT INTO attempts(id,count,until) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END, until=CASE WHEN until<? THEN excluded.until ELSE until END",
      )
      .bind(attemptKey, now + 900000, now, now)
      .run();

    const p = typeof b.password === "string" ? b.password : "";
    const account = await db()
      .prepare("SELECT * FROM accounts WHERE lower(email)=?")
      .bind(email)
      .first<{ id: string; hash: string; salt: string; email: string }>();

    if (!account && b.action === "setup") {
      const existing = await db()
        .prepare("SELECT COUNT(*) AS n FROM accounts")
        .first<{ n: number }>();
      const allowOpenSetup =
        process.env.ALLOW_OWNER_SETUP === "true" ||
        Number(existing?.n ?? 0) === 0;
      if (!allowOpenSetup)
        return Response.json(
          { error: "Unable to sign in with these credentials." },
          { status: 401 },
        );
      if (p.length < 12 || p.length > 128)
        return Response.json(
          { error: "Use a password of 12–128 characters." },
          { status: 400 },
        );
      const ownerId =
        process.env.OWNER_ID?.trim() || crypto.randomUUID();
      const salt = crypto.randomUUID();
      await db()
        .prepare(
          "INSERT INTO accounts(id,email,hash,salt) VALUES(?,?,?,?)",
        )
        .bind(ownerId, email, await hash(p, salt), salt)
        .run();
      const token = crypto.randomUUID() + crypto.randomUUID();
      await db().batch([
        db().prepare("DELETE FROM attempts WHERE id=?").bind(attemptKey),
        db()
          .prepare(
            "INSERT INTO sessions(id,owner,expires) VALUES(?,?,?)",
          )
          .bind(await digest(token), ownerId, now + 28800000),
      ]);
      return Response.json(
        { ok: true },
        {
          headers: {
            "Set-Cookie": sessionCookie(token, 28800),
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (!account || (await hash(p, account.salt)) !== account.hash)
      return Response.json(
        { error: "Unable to sign in with these credentials." },
        { status: 401 },
      );

    const token = crypto.randomUUID() + crypto.randomUUID();
    await db().batch([
      db().prepare("DELETE FROM attempts WHERE id=?").bind(attemptKey),
      db()
        .prepare("INSERT INTO sessions(id,owner,expires) VALUES(?,?,?)")
        .bind(await digest(token), account.id, now + 28800000),
    ]);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": sessionCookie(token, 28800),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "Sign-in service unavailable. Your input has been retained.",
      },
      { status: 503 },
    );
  }
}
