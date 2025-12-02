// /src/lib/env.ts
// [MOD] env / getClientEnvStatus の整備
// - [ADD] AUTOSNSFLOW_ACCESS_KEY_ID / AUTOSNSFLOW_SECRET_ACCESS_KEY を追加（サーバ専用）
// - preview は { clientIdHead, userPoolIdHead, region } のまま（前回修正を踏襲）

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

  ADMIN_GROUP:
    process.env.ADMIN_GROUP ||
    process.env.NEXT_PUBLIC_ADMIN_GROUP || // クライアントと合わせて参照できるように
    "Admins",

  // [ADD] サーバ用の固定クレデンシャル（Amplify側で .env.production に入れている想定）
  AUTOSNSFLOW_ACCESS_KEY_ID:
    process.env.AUTOSNSFLOW_ACCESS_KEY_ID || "",       // [ADD]
  AUTOSNSFLOW_SECRET_ACCESS_KEY:
    process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY || "",   // [ADD]

  // [ADD] S3 media storage
  S3_MEDIA_BUCKET:
    process.env.S3_MEDIA_BUCKET || "",
  S3_MEDIA_REGION:
    process.env.S3_MEDIA_REGION ||
    process.env.AWS_REGION ||
    "",
} as const;

// Helper: normalize environment variable retrieval
// Treat undefined, empty string, or literal "undefined" (string) as not set
export function getEnvVar(name: string): string | undefined {
  const v = process.env[name as keyof NodeJS.ProcessEnv];
  if (!v) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (s.toLowerCase() === "undefined") return undefined;
  return s;
}

export type ClientEnvStatus = {
  ok: boolean;
  missing: string[];
  values: Record<string, string>;
  preview: {
    clientIdHead: string;
    userPoolIdHead: string;
    region: string;
  };
  previewEnabled: boolean;
};

// クライアント側で参照したいENVの存在チェック（秘密値は含めない）
export function getClientEnvStatus(): ClientEnvStatus {
  const region =
    process.env.NEXT_PUBLIC_AWS_REGION ??
    process.env.AWS_REGION ??
    "";

  const userPoolId =
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ??
    process.env.COGNITO_USER_POOL_ID ??
    "";

  const clientId =
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ??
    process.env.COGNITO_CLIENT_ID ??
    "";

  const values = {
    NEXT_PUBLIC_AWS_REGION: region,
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: userPoolId,
    NEXT_PUBLIC_COGNITO_CLIENT_ID: clientId,
    ADMIN_GROUP: process.env.ADMIN_GROUP ?? "Admins",
    // ※ [意図的に除外] AUTOSNSFLOW_* はフロントへ表示しない
  };

  const requiredKeys = [
    "NEXT_PUBLIC_AWS_REGION",
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
    "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  ] as const;

  const missing = requiredKeys.filter((k) => !values[k]);

  const previewEnabled =
    ["1", "true", "on"].includes(
      String(process.env.NEXT_PUBLIC_PREVIEW ?? process.env.PREVIEW ?? "")
        .toLowerCase()
    );

  const head = (s: string, n = 6) => (s ? s.slice(0, n) : "");
  const preview = {
    clientIdHead: head(clientId),
    userPoolIdHead: head(userPoolId),
    region,
  };

  return {
    ok: missing.length === 0,
    missing,
    values,
    preview,
    previewEnabled,
  };
}
