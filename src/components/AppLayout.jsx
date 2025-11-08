// /src/components/AppLayout.jsx
// [MOD] メニュー表示は localStorage のフラグを即時使用 → バックグラウンドで再検証
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
// [admin-flag] 追加
import { getAdminFlag, refreshAdminFlag, clearAdminFlag } from "@/lib/adminFlag";
import { getAuthReady, refreshAuthReady } from "@/lib/authReady";

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
  const [userIdDisplay, setUserIdDisplay] = useState(null);
  const [showX, setShowX] = useState(false);
  const [isDark, setIsDark] = useState(false);

  // デバッグDLG（?debugAuth=1）— 既存があればそのまま
  const [authDebugOpen, setAuthDebugOpen] = useState(false);
  const [authDebug, setAuthDebug] = useState(null);

  useEffect(() => {
    // 初期は非管理者非表示（ちらつき防止）。サーバ再検証後に表示を切り替える
    setIsAdmin(false);
    // 画面アクセス時にサーバで再検証 → 権限確認が取れたらメニューを表示
    (async () => {
      const latest = await refreshAdminFlag();
      setIsAdmin(latest);

      try {
        const ready = await refreshAuthReady();
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        setUserIdDisplay(data?.sub || null);
        // load per-user settings to determine whether to show X menu
        try {
          const s = await fetch('/api/user-settings', { credentials: 'include', cache: 'no-store' });
          if (s.ok) {
            const sj = await s.json().catch(() => ({}));
            const enable = !!(sj?.settings && sj.settings.enableX === true);
            setShowX(enable);
          }
        } catch (_) {}
      } catch {}

      const open =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("debugAuth") === "1";

      setAuthDebug({ source: "/api/auth/me", pathname, isAdmin: latest });
      if (open) setAuthDebugOpen(true);
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

  // Initialize theme from localStorage or prefers-color-scheme
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const stored = localStorage.getItem("theme");
      if (stored === "dark") {
        document.documentElement.classList.add("dark");
        setIsDark(true);
      } else if (stored === "light") {
        document.documentElement.classList.remove("dark");
        setIsDark(false);
      } else {
        const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (prefersDark) {
          document.documentElement.classList.add("dark");
          setIsDark(true);
        }
      }
    } catch (e) {}
  }, []);

  const handleToggleTheme = () => {
    try {
      const nowDark = document.documentElement.classList.toggle("dark");
      setIsDark(nowDark);
      localStorage.setItem("theme", nowDark ? "dark" : "light");
    } catch (e) {}
  };

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
      <nav className="fixed top-0 left-0 w-64 h-screen bg-gray-900 text-white flex flex-col py-6 px-4 overflow-y-auto z-40">
        <div className="mb-6 flex items-center justify-between">
          <div className="text-2xl font-bold">T-Booster</div>
          <button
            onClick={handleToggleTheme}
            aria-label="Toggle theme"
            className="ml-2 p-1 rounded hover:bg-gray-700/50"
          >
            {isDark ? "🌙" : "☀️"}
          </button>
        </div>
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
            <>
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
              <li>
                <Link
                  href="/admin/tokens"
                  className={`block px-3 py-2 rounded hover:bg-gray-700 ${
                    pathname === "/admin/tokens" ? "bg-gray-700 font-semibold" : ""
                  }`}
                >
                  管理（トークン一覧）
                </Link>
              </li>
            </>
          )}
          {/* Per-user X menu: show when user's settings.enableX is true */}
          {showX && (
            <>
              <li>
                <Link
                  href="/x/general"
                  className={`block px-3 py-2 rounded hover:bg-gray-700 ${
                    pathname === "/x/general" ? "bg-gray-700 font-semibold" : ""
                  }`}
                >
                  X：一般アカウント一覧
                </Link>
              </li>
              <li>
                <Link
                  href="/x/post-pool/general"
                  className={`block px-3 py-2 rounded hover:bg-gray-700 ${
                    pathname === "/x/post-pool/general" ? "bg-gray-700 font-semibold" : ""
                  }`}
                >
                  X：一般投稿プール
                </Link>
              </li>
              <li>
                <Link
                  href="/x/ero"
                  className={`block px-3 py-2 rounded hover:bg-gray-700 ${
                    pathname === "/x/ero" ? "bg-gray-700 font-semibold" : ""
                  }`}
                >
                  X: エロアカウント一覧
                </Link>
              </li>
              <li>
                <Link
                  href="/x/post-pool/ero"
                  className={`block px-3 py-2 rounded hover:bg-gray-700 ${
                    pathname === "/x/post-pool/ero" ? "bg-gray-700 font-semibold" : ""
                  }`}
                >
                  X: エロ投稿プール
                </Link>
              </li>
              <li>
                <Link
                  href="/x/saikyou"
                  className={`block px-3 py-2 rounded hover:bg-gray-700 ${
                    pathname === "/x/saikyou" ? "bg-gray-700 font-semibold" : ""
                  }`}
                >
                  X: 最強アカウント一覧
                </Link>
              </li>
              <li>
                <Link
                  href="/x/post-pool/saikyou"
                  className={`block px-3 py-2 rounded hover:bg-gray-700 ${
                    pathname === "/x/post-pool/saikyou" ? "bg-gray-700 font-semibold" : ""
                  }`}
                >
                  X: 最強投稿プール
                </Link>
              </li>
            </>
          )}
        </ul>

        <div className="mt-auto pt-4 border-t border-white/10">
          {userIdDisplay && (
            <div className="mb-3 text-xs text-gray-300 break-all">
              <div className="font-mono">ID: {userIdDisplay}</div>
              <button
                className="text-sm text-indigo-300 hover:underline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(userIdDisplay);
                    alert('userId copied');
                  } catch {
                    // ignore
                  }
                }}
              >
                クリックでコピー
              </button>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 rounded bg-white/10 hover:bg白/20"
          >
            ログアウト
          </button>
        </div>
      </nav>

      <main className="ml-64 min-h-screen p-8 bg-[var(--background)] text-[var(--foreground)]">{children}</main>

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
