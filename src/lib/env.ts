// /src/lib/env.ts
// [ADD] サーバー/クライアント双方で使う環境変数ヘルパー（named export）
// 既存コードは `import { env } from "@/lib/env"` / `import { getClientEnvStatus } from "@/lib/env"` のままでOK

// 必要な値を“named export”でまとめる
export const env = {
  // サーバー側もクライアント側も参照できるように優先順位を調整
  AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION || process.env.AWS_REGION || "",
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || "",
  COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID || "",
  // 管理者グループ名（未設定なら Admins）
  ADMIN_GROUP: (process.env.ADMIN_GROUP || "Admins").trim(),
} as const;

// [ADD] クライアント用の簡易診断（login/page.tsx から参照）
export type ClientEnvStatus = {
  ok: boolean;
  missing: string[];
  values: Record<string, string>;
};

// Next.js はビルド時に process.env.* を静的展開する。
// フロントから確認したい値のみ列挙（機密値は含めない）
export function getClientEnvStatus(): ClientEnvStatus {
  const values = {
    NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION ?? "",
    COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID ?? "",
    COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID ?? "",
    ADMIN_GROUP: process.env.ADMIN_GROUP ?? "Admins",
  };
  const missing = Object.entries(values)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return { ok: missing.length === 0, missing, values };
}
