import { isWhitelistedEmail } from "@/lib/edge-config";
import { conn } from "@/lib/planetscale";
import { ratelimit } from "@/lib/upstash";
import { LOCALHOST_IP } from "@dub/utils";
import { ipAddress } from "@vercel/edge";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const ip = ipAddress(req) || LOCALHOST_IP;
  const { success } = await ratelimit(5, "1 m").limit(ip);
  if (!success) {
    return new Response("Don't DDoS me pls 🥺", { status: 429 });
  }

  const { email } = (await req.json()) as { email: string };

  if (!process.env.DATABASE_URL) {
    return new Response("Database connection not established", {
      status: 500,
    });
  }

  if (!process.env.NEXT_PUBLIC_IS_DUB) {
    return NextResponse.json({ exists: true });
  }

  const user = await conn
    .execute("SELECT email FROM User WHERE email = ?", [email])
    .then((res) => res.rows[0]);

  if (user) {
    return NextResponse.json({ exists: true });
  }

  const whitelisted = await isWhitelistedEmail(email);
  if (whitelisted) {
    return NextResponse.json({ exists: true });
  }

  return NextResponse.json({ exists: false });
}
