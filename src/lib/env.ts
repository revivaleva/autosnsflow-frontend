// /src/lib/env.ts
// [MOD] login/page.tsx が参照する preview.* に合わせて型と返却値を修正
//      - preview: { clientIdHead, userPoolIdHead, region } に変更
//      - 互換のため previewEnabled(boolean) を追加

export const env = {
  AWS_REGION:
    process.env.NEXT_PUBLIC_AWS_REGION ||
    process.env.AWS_REGION ||
    "",
  COGNITO_USER_POOL_ID:
    process.env.COGNITO_USER_POOL_ID ||
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ||
    "",
  COGNITO_CLIENT_ID:
    process.env.COGNITO_CLIENT_ID ||
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ||
    "",
  ADMIN_GROUP: (process.env.ADMIN_GROUP || "Admins").trim(),
} as const;

export type ClientEnvStatus = {
  ok: boolean;
  missing: string[];
  values: Record<string, string>;
  preview: {                       // [MOD] boolean → オブジェクト
    clientIdHead: string;
    userPoolIdHead: string;
    region: string;
  };
  previewEnabled: boolean;         // [ADD] 旧booleanの互換用
};

export function getClientEnvStatus(): ClientEnvStatus {
  // 画面で使う公開ENV（NEXT_PUBLIC_*）を優先、なければサーバー側ENVをフォールバック
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
  };

  const requiredKeys = [
    "NEXT_PUBLIC_AWS_REGION",
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
    "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  ] as const;

  const missing = requiredKeys.filter((k) => !values[k]);

  // [ADD] 旧booleanの互換フラグ（ON/OFF表示等で使う想定）
  const previewEnabled =
    ["1", "true", "on"].includes(
      String(process.env.NEXT_PUBLIC_PREVIEW ?? process.env.PREVIEW ?? "")
        .toLowerCase()
    );

  // [MOD] login/page.tsx が参照する preview.* を生成（頭数文字だけ見せる）
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
    preview,           // [MOD]
    previewEnabled,    // [ADD]
  };
}
