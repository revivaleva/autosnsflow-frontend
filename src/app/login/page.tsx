// /src/app/login/page.tsx
// [MOD] 直接 return で止めず、フォームは出しつつ上部に赤帯で警告を出す
"use client";

import { useState } from "react";
import { env, getClientEnvStatus } from "@/lib/env"; // [ADD]

export default function LoginPage() {
  const { missing } = getClientEnvStatus(); // [ADD]

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const resp = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return setError(data?.error || "ログインに失敗しました");
    location.href = "/";
  };

  return (
    <main className="min-h-screen grid place-items-center">
      <div className="w-[360px] rounded-2xl border p-6 bg-white shadow">
        <h1 className="text-xl font-bold mb-4">ログイン</h1>

        {/* [ADD] 環境変数の診断結果を常時表示（先頭数文字だけ） */}
        {(missing.clientId || missing.userPoolId) && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-semibold mb-1">
              {missing.clientId ? "Cognito ClientId is missing" : null}
              {missing.clientId && missing.userPoolId ? " / " : null}
              {missing.userPoolId ? "Cognito UserPoolId is missing" : null}
            </p>
            <p className="text-[11px] text-gray-600">
              NEXT_PUBLIC_COGNITO_CLIENT_ID / NEXT_PUBLIC_COGNITO_USER_POOL_ID を
              Amplify Hosting の環境変数に設定後、再デプロイしてください。
            </p>
          </div>
        )}

        <div className="text-[10px] text-gray-500 mb-3">
          <div>Region: {env.NEXT_PUBLIC_AWS_REGION}</div>
          <div>UserPoolId: {env.NEXT_PUBLIC_COGNITO_USER_POOL_ID?.slice(0, 10)}•••</div>
          <div>ClientId: {env.NEXT_PUBLIC_COGNITO_CLIENT_ID?.slice(0, 6)}•••</div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm">メールアドレス</span>
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className="text-sm">パスワード</span>
            <input
              type="password"
              className="mt-1 w-full rounded border px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button
            type="submit"
            className="w-full rounded bg-blue-600 text-white py-2 hover:bg-blue-700"
            disabled={missing.clientId || missing.userPoolId} // [ADD] 認証に必要な値が空なら送信不可に
          >
            ログイン
          </button>
        </form>

        <a href="#" className="text-blue-600 text-sm underline mt-4 inline-block">
          アカウントを作成
        </a>
      </div>
    </main>
  );
}
