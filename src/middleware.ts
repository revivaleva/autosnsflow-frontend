// /src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// [MOD] 認証不要なパス（これ以外はすべて保護対象）
const PUBLIC_PATHS = ["/login", "/logout", "/auth/callback"];

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

  // [MOD] 認証不要なパスは素通し（ループ防止）
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // [MOD] すべてのパス（PUBLIC_PATHS以外）を保護対象とする

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

// /api、静的ファイル、_nextなどを除外
export const config = {
  matcher: [
    /*
     * すべてのパスにマッチするが、以下を除外:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - assets (静的ファイル)
     * - images (画像ファイル)
     * - .*\\.png$ (png画像)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|assets|images|.*\\.png$).*)",
  ],
};
