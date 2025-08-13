// /src/app/admin/page.tsx
// [MOD] 管理用トップをシンプルにして一覧へ誘導（重複UIの混乱回避）
"use client";
import Link from "next/link";
export default function AdminTop() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-bold mb-4">管理メニュー</h1>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          <Link className="text-indigo-600 underline" href="/admin/users">
            ユーザー一覧（管理）
          </Link>
        </li>
      </ul>
    </main>
  );
}
