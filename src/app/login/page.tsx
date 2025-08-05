// frontend/src/app/login/page.tsx
"use client";

import LoginFormCreateForm from "./LoginFormCreateForm";  
// もし index.js 経由でまとめてエクスポートしているなら

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <LoginFormCreateForm
        onSubmit={(fields) => {
          // フォーム送信時に呼ばれます
          console.log("ログイン情報:", fields);
          // ここで Cognito signIn を呼んだり、トークン管理など実装してください
          return fields;
        }}
      />
    </div>
  );
}
