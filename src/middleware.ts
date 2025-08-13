// /src/middleware.ts
// [ADD] 認証必須ページをCookie存在で判定し、未ログインは /login へ誘導
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/", "/dashboard", "/settings", "/accounts",
  "/scheduled-posts", "/replies", "/admin",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) =>
    pathname === p || pathname.startsWith(p + "/")
  );
  if (!needsAuth) return NextResponse.next();

  const hasId = req.cookies.get("idToken");
  if (!hasId) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
