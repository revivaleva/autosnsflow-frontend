// /src/lib/env.ts
// [ADD] クライアント/サーバ共通の環境変数読取ユーティリティ（再掲）
export const env = {
  NEXT_PUBLIC_COGNITO_CLIENT_ID:
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
  NEXT_PUBLIC_COGNITO_USER_POOL_ID:
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
  NEXT_PUBLIC_AWS_REGION:
    process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1",

  // サーバ側フォールバック（本番では COGNITO_* を推奨）
  COGNITO_CLIENT_ID:
    process.env.COGNITO_CLIENT_ID ||
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ||
    "",
  COGNITO_USER_POOL_ID:
    process.env.COGNITO_USER_POOL_ID ||
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ||
    "",
  AWS_REGION:
    process.env.AWS_REGION ||
    process.env.NEXT_PUBLIC_AWS_REGION ||
    "ap-northeast-1",
};

export function getClientEnvStatus() {
  // [ADD] 画面に値を出して診断できるようにする
  const missing = {
    clientId: !env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
    userPoolId: !env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  };
  return { missing };
}
