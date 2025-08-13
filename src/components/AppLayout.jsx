// /src/components/AppLayout.jsx

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
      const ls = typeof window !== "undefined" ? window.localStorage : null;
      const tokenFromLS = (ls && (ls.getItem("id_token") || ls.getItem("idToken"))) || "";
      const tokenFromCookie = getCookie("id_token") || getCookie("idToken");
      const token = tokenFromLS || tokenFromCookie;

      if (!token) {
        setIsAdmin(false);
        return;
      }

      const payload = decodeJwtPayload(token);
      const groups = (payload && payload["cognito:groups"]) || [];
      setIsAdmin(Array.isArray(groups) && groups.includes("admin"));
    } catch {
      setIsAdmin(false);
    }
  }, []);

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
          <li>
            <a className="block px-3 py-2 hover:bg-gray-100 rounded" href="/admin/users">
              管理（ユーザー一覧）
            </a>
          </li>
        </ul>
      </nav>
      <main className="flex-1 bg-gray-100 min-h-screen p-8">{children}</main>
    </div>
  );
}
