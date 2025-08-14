// /src/lib/env.ts
// [MOD] env / getClientEnvStatus の整備
// - ClientEnvStatus に preview を追加
// - NEXT_PUBLIC_COGNITO_* と COGNITO_* の両方をサポート
// - 既定の管理者グループは "Admins"（ENV で上書き可能）

export const env = {
  // クライアント・サーバ双方から参照するリージョン
  AWS_REGION:
    process.env.NEXT_PUBLIC_AWS_REGION ||
    process.env.AWS_REGION ||
    "",

  // Cognito 設定（どちらのENV名でも可）
  COGNITO_USER_POOL_ID:
    process.env.COGNITO_USER_POOL_ID ||
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ||
    "",
  COGNITO_CLIENT_ID:
    process.env.COGNITO_CLIENT_ID ||
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ||
    "",

  // 管理者グループ名（未設定なら "Admins"）
  ADMIN_GROUP: (process.env.ADMIN_GROUP || "Admins").trim(),
} as const;

export type ClientEnvStatus = {
  ok: boolean;
  missing: string[];
  values: Record<string, string>;
  preview: boolean; // [ADD]
};

// クライアント側で参照したいENVの存在チェック
export function getClientEnvStatus(): ClientEnvStatus {
  // クライアントで使う（表示に必要な）値を列挙
  const values = {
    NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION ?? "",
    NEXT_PUBLIC_COGNITO_USER_POOL_ID:
      process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ??
      process.env.COGNITO_USER_POOL_ID ??
      "",
    NEXT_PUBLIC_COGNITO_CLIENT_ID:
      process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ??
      process.env.COGNITO_CLIENT_ID ??
      "",
    ADMIN_GROUP: process.env.ADMIN_GROUP ?? "Admins",
  };

  // 画面で必須としている “NEXT_PUBLIC_*” を中心に判定
  const requiredKeys = [
    "NEXT_PUBLIC_AWS_REGION",
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
    "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  ] as const;

  const missing = requiredKeys
    .filter((k) => !values[k])
    .map((k) => k as string);

  // プレビュー判定（任意）: true/1/on で有効
  const preview =
    ["1", "true", "on"].includes(
      String(
        process.env.NEXT_PUBLIC_PREVIEW ?? process.env.PREVIEW ?? ""
      ).toLowerCase()
    );

  return { ok: missing.length === 0, missing, values, preview };
}
