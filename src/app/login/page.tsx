// /src/app/login/page.tsx
// [MOD] 環境変数診断の参照方法を修正（missing.* → missing.includes(...)）
//      既存コメントは変更せず、追記コメントのみ追加

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SignUpModal from "./SignUpModal";

// [ADD] 環境変数診断ユーティリティの導入
import { getClientEnvStatus } from "@/lib/env"; // [ADD]

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const [signupOpen, setSignupOpen] = useState(false);

  // [ADD] クライアント環境変数の状態を取得
  const { missing, preview } = getClientEnvStatus(); // [ADD]
  const isClientIdMissing = missing.includes("NEXT_PUBLIC_COGNITO_CLIENT_ID"); // [ADD]
  const isUserPoolIdMissing = missing.includes("NEXT_PUBLIC_COGNITO_USER_POOL_ID"); // [ADD]

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      router.push("/"); // トップページ等へリダイレクト
    } else {
      const data = await res.json();
      setError(data.error || "ログイン失敗");
    }
  };

  return (
    <div className="mx-auto max-w-md p-6">
      <h2 className="text-2xl font-bold mb-4">ログイン</h2>

      {/* [ADD] 環境変数の診断結果を常時表示（先頭数文字だけ） */}
      {(isClientIdMissing || isUserPoolIdMissing) && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold mb-1">
            {isClientIdMissing ? "Cognito ClientId is missing" : null}
          </p>
          <p className="font-semibold mb-1">
            {isUserPoolIdMissing ? "Cognito UserPoolId is missing" : null}
          </p>
          <div className="mt-1 text-xs text-red-600/80">
            <div>clientId: {preview.clientIdHead || "(empty)"}...</div>
            <div>userPoolId: {preview.userPoolIdHead || "(empty)"}...</div>
            <div>region: {preview.region || "(empty)"}</div>
          </div>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">メールアドレス</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-2 border rounded-lg"
            type="email"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm mb-1">パスワード</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 border rounded-lg"
            type="password"
            required
          />
        </div>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="w-full rounded-lg border px-4 py-2 font-medium hover:bg-gray-50"
        >
          ログイン
        </button>

        <button
          type="button"
          onClick={() => setSignupOpen(true)}
          className="w-full rounded-lg border px-4 py-2 font-medium hover:bg-gray-50"
        >
          アカウントを作成
        </button>
      </form>

      <SignUpModal open={signupOpen} onClose={() => setSignupOpen(false)} />
    </div>
  );
}
