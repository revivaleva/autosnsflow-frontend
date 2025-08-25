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

  // 追加: 有効期限(exp)を簡易チェック（署名検証なし、ミドルウェアで軽量判定）
  if (token) {
    try {
      const [, payload] = token.split(".");
      if (payload) {
        // base64url → base64
        const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
        const expSec = Number(json?.exp || 0);
        if (expSec && expSec * 1000 > Date.now()) {
          return NextResponse.next();
        }
      }
    } catch (_) {
      // 失敗時は通常のリダイレクト処理へフォールバック
    }
  }

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
