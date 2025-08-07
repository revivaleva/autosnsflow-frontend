// /src/app/login/SignUpModal.tsx

"use client";

import { useState } from "react";

// 必要なら amplify-jsや@aws-sdk/client-cognito-identity-providerをimport
import { CognitoIdentityProviderClient, SignUpCommand, ConfirmSignUpCommand } from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({ region: process.env.NEXT_PUBLIC_COGNITO_REGION });

export default function SignUpModal({ open, onClose }: { open: boolean; onClose: () => void; }) {
  const [step, setStep] = useState<"input" | "verify" | "done">("input");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // サインアップ
  const handleSignUp = async () => {
    setLoading(true);
    setError("");
    try {
      await client.send(new SignUpCommand({
        ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
        Username: username,
        Password: password,
      }));
      setStep("verify");
    } catch (e: any) {
      setError(e.message || "登録に失敗しました");
    }
    setLoading(false);
  };

  // 認証コード確認
  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      await client.send(new ConfirmSignUpCommand({
        ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
        Username: username,
        ConfirmationCode: code,
      }));
      setStep("done");
    } catch (e: any) {
      setError(e.message || "認証コードが無効です");
    }
    setLoading(false);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
      <div className="bg-white p-8 rounded-xl w-full max-w-md shadow">
        {step === "input" && (
          <>
            <h2 className="text-xl font-bold mb-4">アカウント作成</h2>
            <input
              className="w-full border rounded p-2 mb-2"
              placeholder="ユーザー名（メールアドレスでもOK）"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
            />
            <input
              className="w-full border rounded p-2 mb-2"
              type="password"
              placeholder="パスワード"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            {error && <div className="text-red-500 mb-2">{error}</div>}
            <div className="flex justify-between mt-4">
              <button
                className="px-4 py-2 bg-gray-300 rounded"
                onClick={onClose}
                disabled={loading}
              >キャンセル</button>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={handleSignUp}
                disabled={loading}
              >登録</button>
            </div>
          </>
        )}
        {step === "verify" && (
          <>
            <h2 className="text-xl font-bold mb-4">メール認証</h2>
            <input
              className="w-full border rounded p-2 mb-2"
              placeholder="認証コード（メールで受信）"
              value={code}
              onChange={e => setCode(e.target.value)}
            />
            {error && <div className="text-red-500 mb-2">{error}</div>}
            <div className="flex justify-between mt-4">
              <button
                className="px-4 py-2 bg-gray-300 rounded"
                onClick={onClose}
                disabled={loading}
              >キャンセル</button>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={handleConfirm}
                disabled={loading}
              >認証する</button>
            </div>
          </>
        )}
        {step === "done" && (
          <>
            <h2 className="text-xl font-bold mb-4">登録完了！</h2>
            <div className="mb-4">アカウントが作成されました。ログインしてください。</div>
            <div className="flex justify-end">
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={onClose}
              >閉じる</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
