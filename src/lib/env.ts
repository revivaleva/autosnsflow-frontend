// /src/lib/env.ts
// [ADD] サーバ/クライアント共通の環境変数読み出し（サーバはNON-aws前綴りも許可）
export const env = {
  NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1",
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
  NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",

  COGNITO_USER_POOL_ID:
    process.env.COGNITO_USER_POOL_ID || process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
  COGNITO_CLIENT_ID:
    process.env.COGNITO_CLIENT_ID || process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
  AWS_REGION:
    process.env.COGNITO_AWS_REGION || process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1",

  AUTOSNSFLOW_ACCESS_KEY_ID: process.env.AUTOSNSFLOW_ACCESS_KEY_ID || "",
  AUTOSNSFLOW_SECRET_ACCESS_KEY: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY || "",
};
