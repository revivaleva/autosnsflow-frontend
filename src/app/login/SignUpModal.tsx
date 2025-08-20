// frontend/src/app/login/SignUpModal.tsx
"use client";

import { useState } from "react";
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// Cognito は公開値（NEXT_PUBLIC_…）で可
const region =
  process.env.NEXT_PUBLIC_AWS_REGION || process.env.NEXT_PUBLIC_COGNITO_REGION;
const client = new CognitoIdentityProviderClient({ region });

export default function SignUpModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"input" | "verify" | "done">("input");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    setLoading(true);
    setError("");
    try {
      if (!username || !password) {
        throw new Error("メールアドレスとパスワードを入力してください");
      }
      await client.send(
        new SignUpCommand({
          ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
          Username: username,
          Password: password,
        })
      );
      setStep("verify");
    } catch (e: any) {
      setError(e?.message || "登録に失敗しました");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      await client.send(
        new ConfirmSignUpCommand({
          ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
          Username: username,
          ConfirmationCode: code,
        })
      );
      setStep("done");
    } catch (e: any) {
      setError(e?.message || "認証コードが無効です");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {step === "input" && (
          <>
            <h2 className="mb-4 text-xl font-bold">アカウント作成</h2>
            <div className="space-y-3">
              <input
                className="w-full rounded-lg border p-2"
                placeholder="メールアドレス"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
              <input
                className="w-full rounded-lg border p-2"
                placeholder="パスワード"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                name="password"
                autoComplete="new-password"
                required
              />
              {error && (
                <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="mt-2 flex gap-3">
                <button
                  onClick={onClose}
                  className="rounded-lg border px-4 py-2 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSignUp}
                  disabled={loading}
                  className="rounded-lg bg-black px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? "登録中…" : "登録"}
                </button>
              </div>
            </div>
          </>
        )}

        {step === "verify" && (
          <>
            <h2 className="mb-4 text-xl font-bold">メール認証</h2>
            <input
              className="mb-3 w-full rounded-lg border p-2"
              placeholder="認証コード"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && (
              <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="rounded-lg border px-4 py-2 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="rounded-lg bg-black px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "認証中…" : "認証する"}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h2 className="mb-2 text-xl font-bold">登録完了！</h2>
            <p className="mb-4 text-sm">アカウントが作成されました。ログインしてください。</p>
            <div className="text-right">
              <button
                onClick={onClose}
                className="rounded-lg border px-4 py-2 hover:bg-gray-50"
              >
                閉じる
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
