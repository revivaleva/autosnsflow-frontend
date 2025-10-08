// /src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 認証不要なページ（ログイン関連のみ）
const PUBLIC_PAGES = ["/login", "/logout", "/auth/callback"];

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // 簡易JWT有効チェック（署名検証は行わない）
  const isValidToken = (tok?: string | null): boolean => {
    if (!tok) return false;
    try {
      const [, payload] = tok.split(".");
      if (!payload) return false;
      const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      // Edge Runtime 対応: Buffer が無い環境でも動くように atob を優先
      const jsonStr = typeof atob === "function"
        ? atob(b64)
        : (globalThis as any).Buffer
          ? (globalThis as any).Buffer.from(b64, "base64").toString("utf8")
          : "{}";
      const json = JSON.parse(jsonStr);
      const expSec = Number(json?.exp || 0);
      return !!expSec && expSec * 1000 > Date.now();
    } catch (_) {
      return false;
    }
  };

  // [MOD] ログイン済みで /login に来た場合は "/" へリダイレクト（要件B）
  if (pathname.startsWith("/login")) {
    const tokenOnLogin = req.cookies.get("idToken")?.value;
    if (isValidToken(tokenOnLogin)) {
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
  if (isValidToken(token)) {
    return NextResponse.next();
  }

  // Diagnostic logging for unexpected redirect loops
  try {
    const allowDebug = (process.env.ALLOW_DEBUG_EXEC_LOGS === 'true' || process.env.ALLOW_DEBUG_EXEC_LOGS === '1');
    if (allowDebug) { /* debug removed */ }
  } catch (_) {}

  const url = req.nextUrl.clone();
  url.pathname = "/login";

  // Do not include `next` parameter to avoid redirect loops when session times out.
  return NextResponse.redirect(url);
}

// /api は巻き込まない。静的や_nextも除外
export const config = {
  matcher: ["/((?!_next/|favicon.ico|assets/|api/).*)"],
};
