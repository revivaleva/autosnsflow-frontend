// /src/lib/env.ts
// [ADD] サーバ/クライアント共通の環境変数読み出し（サーバはNON-aws前綴りも許可）
export const env = {
  // [KEEP or ADD] クライアント/サーバ共通の環境変数取得（サーバはフォールバックあり）
  NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1",
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
  NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",

  // サーバ側優先。未設定なら NEXT_PUBLIC_* をフォールバック
  COGNITO_USER_POOL_ID:
    process.env.COGNITO_USER_POOL_ID || process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
  COGNITO_CLIENT_ID:
    process.env.COGNITO_CLIENT_ID || process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
  AWS_REGION:
    process.env.COGNITO_AWS_REGION ||
    process.env.AWS_REGION ||
    process.env.NEXT_PUBLIC_AWS_REGION ||
    "ap-northeast-1",

  // （暫定運用）固定アクセスキーがあればサーバ側で使用。将来はロール利用へ移行予定。
  AUTOSNSFLOW_ACCESS_KEY_ID: process.env.AUTOSNSFLOW_ACCESS_KEY_ID || "",
  AUTOSNSFLOW_SECRET_ACCESS_KEY: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY || "",
};

// [ADD] クライアントで使う環境変数の有無をUIで表示するためのユーティリティ
// [MOD] 戻り値の型を付与し、process.env を Record にキャストして型エラーを回避
export function getClientEnvStatus(): {
  missing: string[];
  present: string[];
  preview: { clientIdHead: string; userPoolIdHead: string; region: string };
} {
  // クライアントに埋め込まれるのは NEXT_PUBLIC_* のみ
  const requiredKeys = [
    "NEXT_PUBLIC_COGNITO_CLIENT_ID",
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
    "NEXT_PUBLIC_AWS_REGION",
  ] as const;

  // [MOD] 型の都合でキャスト
  const penv = process.env as Record<string, string | undefined>;

  const missing = requiredKeys.filter((k) => !penv[k]); // [MOD]
  const present = requiredKeys.filter((k) => !!penv[k]); // [MOD]

  // 画面に出しても安全な“先頭数文字プレビュー”
  const preview = {
    clientIdHead: (penv.NEXT_PUBLIC_COGNITO_CLIENT_ID || "").slice(0, 6), // [MOD]
    userPoolIdHead: (penv.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "").slice(0, 6), // [MOD]
    region: penv.NEXT_PUBLIC_AWS_REGION || "",
  };

  return { missing, present, preview };
}
