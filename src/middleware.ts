// /src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// [KEEP] 認証保護の対象
const PROTECTED = ["/settings", "/admin"]; // ここだけ保護

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // [MOD] ログイン済みで /login に来た場合は "/" へリダイレクト（要件B）
  if (pathname.startsWith("/login")) {
    const tokenOnLogin = req.cookies.get("idToken")?.value;
    if (tokenOnLogin) {
      const to = req.nextUrl.clone();
      to.pathname = "/";
      to.search = "";
      return NextResponse.redirect(to);
    }
  }

  // [ADD] ログイン/ログアウト/認証コールバックは常に素通し（ループ防止）
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/logout") ||
    pathname.startsWith("/auth/callback")
  ) {
    return NextResponse.next();
  }

  // [MOD] "/" も保護対象に含める
  if (!(pathname === "/" || PROTECTED.some((p) => pathname.startsWith(p)))) {
    return NextResponse.next();
  }

  // [KEEP] Cookie名は "idToken"
  const token = req.cookies.get("idToken")?.value;
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
