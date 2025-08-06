// /src/components/AppLayout.jsx

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const menu = [
  { label: "ダッシュボード", href: "/dashboard" },
  { label: "SNSアカウント", href: "/accounts" },
  { label: "予約投稿", href: "/scheduled-posts" },
  { label: "リプライ管理", href: "/replies" },
  { label: "自動投稿グループ管理", href: "/auto-post-groups" },
  { label: "設定", href: "/settings" },
];

export default function AppLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // /loginページ自身ではリダイレクトしない
    if (pathname !== "/login" && !localStorage.getItem("userId")) {
      router.push("/login");
    }
  }, [pathname, router]);

  return (
    <div className="flex min-h-screen">
      <nav className="w-56 bg-gray-900 text-white flex flex-col py-6 px-4">
        <div className="mb-6 text-2xl font-bold">AutoSNSFlow</div>
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
        </ul>
      </nav>
      <main className="flex-1 bg-gray-100 min-h-screen p-8">{children}</main>
    </div>
  );
}
