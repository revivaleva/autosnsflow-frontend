// /src/app/login/page.tsx

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

const handleLogin = async (e) => {
  e.preventDefault();
  setError(""); // 追加
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError("通信エラー（API未定義 or サーバエラー）");
      return;
    }
    const data = await res.json();
    if (data.success) {
      localStorage.setItem("userId", data.userId);
      router.push("/dashboard");
    } else {
      setError("ログイン失敗（メールかパスワード不一致）");
    }
  } catch (e) {
    setError("ログイン時にエラーが発生しました");
    console.error(e);
  }
};

  return (
    <div className="flex items-center justify-center h-screen">
      <form className="bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4" onSubmit={handleLogin}>
        <h2 className="text-xl font-bold mb-4">ログイン</h2>
        <div className="mb-4">
          <input
            className="shadow appearance-none border rounded w-full py-2 px-3"
            type="email"
            placeholder="メールアドレス"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="mb-6">
          <input
            className="shadow appearance-none border rounded w-full py-2 px-3"
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded" type="submit">
          ログイン
        </button>
      </form>
    </div>
  );
}
