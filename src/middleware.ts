// /middleware.ts
// [MOD] 認証Cookie名を 'idToken' に統一（移行フォールバックで 'session' も許可）
//      既存コメントは変更せず、追記コメントのみ追加

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED = ["/settings", "/admin"]; // ここだけ保護
const COOKIE_NAME = "idToken"; // [MOD] 参照するCookie名を統一

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // [MOD] 'idToken' を参照。移行期間のみ 'session' もフォールバックで許容
  const token =
    req.cookies.get(COOKIE_NAME)?.value ||
    req.cookies.get("session")?.value; // [ADD] 移行フォールバック（不要になったら削除可）

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
