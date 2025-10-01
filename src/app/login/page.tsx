// /src/app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SignUpModal from "./SignUpModal"; // [ADD] アカウント作成モーダル
import { getClientEnvStatus } from "@/lib/env"; // [ADD] 環境変数の簡易診断

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [signupOpen, setSignupOpen] = useState(false); // [ADD]
  const router = useRouter();
  const [loggingIn, setLoggingIn] = useState(false);

  // 環境変数の表示（不足があれば画面に出す）
  const { missing, preview } = getClientEnvStatus();
  const isClientIdMissing = missing.includes("NEXT_PUBLIC_COGNITO_CLIENT_ID");
  const isUserPoolIdMissing = missing.includes("NEXT_PUBLIC_COGNITO_USER_POOL_ID");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (loggingIn) return;
    setLoggingIn(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include", // [ADD] Set-Cookie（idToken）受領のため
    });

    if (res.ok) {
      // ?next=... があればそこに遷移（同一オリジンなら許容）、なければ "/"
      try {
        const params = new URLSearchParams(window.location.search);
        const nextRaw = params.get("next");
        let target = "/";
        if (nextRaw) {
          try {
            const u = new URL(nextRaw, window.location.origin);
            // ignore if target would be login/logout/auth/callback to avoid loops
            if (u.origin === window.location.origin && !u.pathname.startsWith('/login') && !u.pathname.startsWith('/logout') && !u.pathname.startsWith('/auth/callback')) {
              target = u.pathname + u.search + u.hash;
            }
          } catch (_) {
            // invalid URL -> ignore
          }
        }
        router.push(target);
      } catch (err) {
        router.push("/");
      }
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "ログイン失敗");
    }
    setLoggingIn(false);
  };

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-bold">ログイン</h1>

      {(isClientIdMissing || isUserPoolIdMissing) && (
        <div className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
          <div className="font-semibold">環境変数が不足しています:</div>
          <ul className="list-inside list-disc">
            {isClientIdMissing && <li>Cognito ClientId is missing</li>}
            {isUserPoolIdMissing && <li>Cognito UserPoolId is missing</li>}
          </ul>
          <div className="mt-2 text-xs opacity-80">
            clientId: {preview.clientIdHead || "(empty)"}... / userPoolId:{" "}
            {preview.userPoolIdHead || "(empty)"}... / region: {preview.region || "(empty)"}
          </div>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm">メールアドレス</label>
          <input
            className="w-full rounded-lg border p-2"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm">パスワード</label>
          <input
            className="w-full rounded-lg border p-2"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            name="password"
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loggingIn}
          className={`w-full rounded-lg px-4 py-2 font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${loggingIn ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400'}`}
        >
          {loggingIn ? "ログイン中…" : "ログイン"}
        </button>

        {/* [ADD] アカウント作成 */}
        <button
          type="button"
          onClick={() => setSignupOpen(true)}
          className="w-full rounded-lg border px-4 py-2 font-medium hover:bg-gray-50"
        >
          アカウントを作成
        </button>
      </form>

      {/* [ADD] サインアップモーダル */}
      <SignUpModal open={signupOpen} onClose={() => setSignupOpen(false)} />
    </div>
  );
}
