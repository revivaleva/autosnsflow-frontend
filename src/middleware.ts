// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED = ["/settings", "/admin"]; // ここだけ保護

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  if (!PROTECTED.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("session")?.value; // ← クッキー名を統一
  if (token) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set(
    "next",
    pathname + (searchParams.toString() ? `?${searchParams}` : "")
  );
  return NextResponse.redirect(url);
}

// /api は巻き込まない。静的や_nextも除外
export const config = {
  matcher: ["/((?!_next/|favicon.ico|assets/|api/).*)"],
};
