// /src/app/login/page.tsx
"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// [ADD] /login はSSG対象にしない（Prerenderエラー回避）
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      {/* [ADD] useSearchParams を使う子を Suspense で包む */}
      <Suspense fallback={<div className="text-gray-600">読み込み中...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

// [ADD] 実際のフォーム（ここで useSearchParams を使用）
function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextPath = sp?.get("next") ?? "/settings"; // [FIX] null セーフ

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "ログインに失敗しました");
      router.replace(nextPath);
    } catch (e: any) {
      setErr(e?.message || "ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="w-full max-w-md bg-white shadow rounded-xl p-6">
      <h1 className="text-xl font-semibold mb-4">ログイン</h1>
      {err && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {err}
        </div>
      )}

      <label className="block text-sm text-gray-600">メールアドレス</label>
      <input
        className="mt-1 w-full border rounded-md px-3 py-2"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />

      <label className="block text-sm text-gray-600 mt-4">パスワード</label>
      <input
        className="mt-1 w-full border rounded-md px-3 py-2"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      <button
        type="submit"
        disabled={loading}
        className="mt-6 w-full bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
