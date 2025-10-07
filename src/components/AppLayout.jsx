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
      // debug log removed from client. Use ALLOW_DEBUG_EXEC_LOGS guarded logs on server if necessary.
    })();

    // 3) 他タブ更新に追従（storageイベント）
    const onStorage = (e) => {
      if (e.key === "isAdmin") setIsAdmin(getAdminFlag());
    };
    window.addEventListener("storage", onStorage);
    // 4) ユーザー操作でセッションキープアライブ
    let lastActivity = Date.now();
    const updateActivity = () => { lastActivity = Date.now(); };
    const keepAlive = async () => {
      try {
        const idle = Date.now() - lastActivity;
        // アクティブなら毎5分ごとにkeepaliveを叩く
        if (idle < 5 * 60 * 1000) {
          await fetch('/api/auth/keepalive', { method: 'POST', credentials: 'include' }).catch(() => {});
        }
      } catch {}
    };
    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('touchstart', updateActivity);
    const kaInterval = setInterval(keepAlive, 5 * 60 * 1000);
    return () => window.removeEventListener("storage", onStorage);
    // cleanup
    window.removeEventListener('mousemove', updateActivity);
    window.removeEventListener('keydown', updateActivity);
    window.removeEventListener('touchstart', updateActivity);
    clearInterval(kaInterval);
  }, [pathname]);

  // これがログアウトボタンの onClick で呼ばれる想定
  async function handleLogout() {
    try {
      // 1) サーバー側 (HttpOnly / domain付き) クッキーの無効化
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});

      // 2) クライアント側のクッキー/LSを念のため全削除（domain あり/なし両対応）
      const clearCookie = (name) => {
        try {
          const host = location.hostname;
          // host-only
          document.cookie = `${name}=; Max-Age=0; path=/;`;
          // domain付き（.example.com）
          document.cookie = `${name}=; Max-Age=0; path=/; domain=.${host};`;
          // 可能な場合は Secure/SameSite も付けて上書き（無視されてもOK）
          document.cookie = `${name}=; Max-Age=0; path=/; domain=.${host}; Secure; SameSite=None;`;
        } catch {}
      };

      [
        "idToken", "id_token",
        "accessToken", "access_token",
        "refreshToken", "refresh_token"
      ].forEach(clearCookie);

      try {
        ["id_token","idToken","access_token","refresh_token","tb_is_admin"].forEach((k) => {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
      } catch {}
      // 4) アプリのログイン画面へ
      router.replace("/login");
    } catch {
      router.replace("/login");
    }
  }

  return (
    <div className="min-h-screen">
      <nav className="fixed top-0 left-0 w-56 h-screen bg-gray-900 text-white flex flex-col py-6 px-4 overflow-y-auto z-40">
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

      <main className="ml-56 min-h-screen p-8 bg-[var(--background)] text-[var(--foreground)]">{children}</main>

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
