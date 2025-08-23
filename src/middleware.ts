// /src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 認証不要なページ（ログイン関連のみ）
const PUBLIC_PAGES = ["/login", "/logout", "/auth/callback"];

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

  // 認証不要ページは素通し（ループ防止）
  if (PUBLIC_PAGES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 全ページを認証保護の対象とする（PUBLIC_PAGES以外）

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
