// /src/lib/env.ts
// [ADD] クライアント/サーバ共通の環境変数読取ユーティリティ（再掲）
export const env = {
  // クライアントでもサーバでも使える値
  NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
  NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1",

  // サーバ用: Amplify Hosting では AWS_ プレフィックスが使えないので NEXT_PUBLIC_* をフォールバック
  COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID || process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
  AWS_REGION: process.env.COGNITO_AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1", // ← AWS_REGION の代替
};

export function getClientEnvStatus() {
  // [ADD] 画面に値を出して診断できるようにする
  const missing = {
    clientId: !env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
    userPoolId: !env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  };
  return { missing };
}
