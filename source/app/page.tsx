import { db, identity } from "@/lib/auth";
import { redirect } from "next/navigation";
import Welcome from "./welcome";

export const dynamic = "force-dynamic";

export default async function Page() {
  let setup = false;
  let error = false;
  try {
    if (await identity()) redirect("/workbench");
    const existing = await db()
      .prepare("SELECT COUNT(*) AS n FROM accounts")
      .first<{ n: number }>();
    setup =
      process.env.ALLOW_OWNER_SETUP === "true" ||
      Number(existing?.n ?? 0) === 0;
  } catch (e) {
    if ((e as any)?.digest?.includes("NEXT_REDIRECT")) throw e;
    error = true;
  }
  return <Welcome email="" setup={setup} error={error} />;
}
