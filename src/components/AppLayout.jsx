// /src/components/AppLayout.jsx
// [MOD] メニュー表示は localStorage のフラグを即時使用 → バックグラウンドで再検証
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
// [admin-flag] 追加
import { getAdminFlag, refreshAdminFlag, clearAdminFlag } from "@/lib/adminFlag";

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
  const [isAdmin, setIsAdmin] = useState(false);

  // デバッグDLG（?debugAuth=1）— 既存があればそのまま
  const [authDebugOpen, setAuthDebugOpen] = useState(false);
  const [authDebug, setAuthDebug] = useState(null);

  useEffect(() => {
    // 1) まずはローカルのフラグで即座にメニューを出す（初期描画が速い）
    setIsAdmin(getAdminFlag());

    // 2) 画面アクセス時にサーバで再検証 → 乖離あれば更新
    (async () => {
      const latest = await refreshAdminFlag();
      setIsAdmin(latest);

      const open =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("debugAuth") === "1";

      setAuthDebug({ source: "/api/auth/me", pathname, isAdmin: latest });
      if (open) setAuthDebugOpen(true);
      // eslint-disable-next-line no-console
      console.log("[auth-debug]", { source: "/api/auth/me", isAdmin: latest });
    })();

    // 3) 他タブ更新に追従（storageイベント）
    const onStorage = (e) => {
      if (e.key === "isAdmin") setIsAdmin(getAdminFlag());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [pathname]);

  // ログアウト時はフラグもクリア
  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch {}
    try {
      document.cookie = "id_token=; Max-Age=0; path=/;";
      document.cookie = "idToken=; Max-Age=0; path=/;";
      document.cookie = "accessToken=; Max-Age=0; path=/;";
      document.cookie = "refreshToken=; Max-Age=0; path=/;";
      window.localStorage.removeItem("id_token");
      window.localStorage.removeItem("idToken");
      window.localStorage.removeItem("accessToken");
      window.localStorage.removeItem("refreshToken");
      clearAdminFlag(); // [admin-flag] 追加
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
          {/* 管理メニュー：フラグで即時表示（サーバ再検証で後から整合） */}
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

        <div className="mt-auto pt-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 rounded bg-white/10 hover:bg白/20"
          >
            ログアウト
          </button>
        </div>
      </nav>

      <main className="flex-1 bg-gray-100 min-h-screen p-8">{children}</main>

      {/* デバッグDLG（任意） */}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
