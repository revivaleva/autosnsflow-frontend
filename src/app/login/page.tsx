// /src/app/login/page.tsx
"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md p-6">
      <Suspense fallback={<div>読み込み中...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextPath = sp?.get("next") ?? "/settings";

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
    <form className="space-y-4" onSubmit={onSubmit}>
      <h1 className="text-xl font-bold">ログイン</h1>
      {err && <div className="rounded bg-red-50 p-3 text-red-700">{err}</div>}

      <div>
        <label className="block text-sm text-gray-600">メールアドレス</label>
        <input
          className="mt-1 w-full rounded border px-3 py-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="block text-sm text-gray-600">パスワード</label>
        <input
          type="password"
          className="mt-1 w-full rounded border px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
