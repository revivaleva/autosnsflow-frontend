// /src/components/AppLayout.jsx
// [MOD] 管理者判定を "Admins"（または NEXT_PUBLIC_ADMIN_GROUP）に統一
//      ?debugAuth=1 で権限デバッグDLGを表示できるようにした

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
// [admin-menu] 追記のため変更: useState を追加（既存 import 行の最小変更）
import { useEffect, useState } from "react";

const menu = [
  { label: "ダッシュボード", href: "/dashboard" },
  { label: "アカウント", href: "/accounts" }, 
  { label: "予約投稿", href: "/scheduled-posts" },
  { label: "リプライ管理", href: "/replies" },
  { label: "投稿グループ管理", href: "/auto-post-groups" }, 
  { label: "設定", href: "/settings" },
];

export default function AppLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false); // [admin-menu] 追記: 管理者判定state

  // [admin-menu] 追記: デバッグ用
  const [authDebugOpen, setAuthDebugOpen] = useState(false);
  const [authDebug, setAuthDebug] = useState(null);

  // [admin-menu] 追記: Cookie取得（最小ユーティリティ）
  function getCookie(name) {
    if (typeof document === "undefined") return "";
    const m = document.cookie.split("; ").find((row) => row.startsWith(name + "="));
    return m ? decodeURIComponent(m.split("=")[1]) : "";
  }

  // [admin-menu] 追記: JWT payload decode（base64url対応）
  function decodeJwtPayload(token) {
    try {
      const part = token.split(".")[1];
      if (!part) return null;
      const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(base64));
    } catch {
      return null;
    }
  }

  // [admin-menu] 追記: adminグループ判定（id_token を LocalStorage/Cookie から取得）
  useEffect(() => {
    try {
      const ADMIN_GROUP =
        process.env.NEXT_PUBLIC_ADMIN_GROUP || "Admins"; // [MOD] 既定Admins

      const ls = typeof window !== "undefined" ? window.localStorage : null;
      const tokenFromLS = (ls && (ls.getItem("id_token") || ls.getItem("idToken"))) || "";
      const tokenFromCookie = getCookie("id_token") || getCookie("idToken");
      const token = tokenFromLS || tokenFromCookie;

      const payload = token ? decodeJwtPayload(token) : null;
      const groups = (payload && payload["cognito:groups"]) || [];
      const admin = Array.isArray(groups) && groups.includes(ADMIN_GROUP);

      setIsAdmin(Boolean(admin));

      // ▼デバッグ（?debugAuth=1 でDLG表示）
      const qs =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : undefined;
      const open = qs?.get("debugAuth") === "1";
      const dbg = {
        tokenSource: tokenFromLS ? "localStorage" : tokenFromCookie ? "cookie" : "none",
        adminGroupExpected: ADMIN_GROUP,
        isAdmin: Boolean(admin),
        groups,
        payload,
        hasToken: Boolean(token),
        pathname,
      };
      setAuthDebug(dbg);
      if (open) setAuthDebugOpen(true);
      // コンソールにも出す（確認しやすいように）
      // eslint-disable-next-line no-console
      console.log("[auth-debug]", dbg);
    } catch (e) {
      setIsAdmin(false);
    }
  }, [pathname]);

  // [admin-menu] 追記: ログアウト処理（API叩いてからクライアント側でもクッキー/LSをクリア）
  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch {}
    try {
      document.cookie = "id_token=; Max-Age=0; path=/;";
      document.cookie = "idToken=; Max-Age=0; path=/;";
      document.cookie = "accessToken=; Max-Age=0; path=/;";
      document.cookie = "refreshToken=; Max-Age=0; path=/;";
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("id_token");
        window.localStorage.removeItem("idToken");
        window.localStorage.removeItem("accessToken");
        window.localStorage.removeItem("refreshToken");
      }
    } catch {}
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-56 bg-gray-900 text-white flex flex-col py-6 px-4">
        <div className="mb-6 text-2xl font-bold">T-Booster</div>
        <ul className="space-y-2">
          {menu.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`block px-3 py-2 rounded hover:bg-gray-700 ${
                  pathname === item.href ? "bg-gray-700 font-semibold" : ""
                }`}
              >
                {item.label}
              </Link>
            </li>
          ))}

          {/* [admin-menu] 追記: 管理者のみ表示するメニュー */}
          {isAdmin && (
            <li>
              <Link
                href="/admin/users"
                className={`block px-3 py-2 rounded hover:bg-gray-700 ${
                  pathname === "/admin/users" ? "bg-gray-700 font-semibold" : ""
                }`}
              >
                管理（ユーザー一覧）
              </Link>
            </li>
          )}
        </ul>

        {/* [admin-menu] 追記: メニュー下部のログアウトボタン */}
        <div className="mt-auto pt-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 rounded bg-white/10 hover:bg-white/20"
          >
            ログアウト
          </button>
        </div>
      </nav>
      <main className="flex-1 bg-gray-100 min-h-screen p-8">{children}</main>

      {/* [admin-menu] 追記: 権限デバッグDLG（?debugAuth=1 で自動表示） */}
      {authDebugOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setAuthDebugOpen(false)}
          />
          <div className="absolute inset-0 p-4 flex items-center justify-center">
            <div
              className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold">権限デバッグ</h3>
                <button
                  className="text-gray-500 hover:text-gray-800"
                  onClick={() => setAuthDebugOpen(false)}
                >
                  ×
                </button>
              </div>
              <pre className="text-xs whitespace-pre-wrap break-all bg-gray-50 p-3 rounded max-h-[70vh] overflow-auto">
                {JSON.stringify(authDebug, null, 2)}
              </pre>
              <p className="text-xs text-gray-500 mt-2">
                ※ このDLGはURLに <code>?debugAuth=1</code> を付けると自動で開きます
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
