// /src/lib/aws-creds.ts
// [ADD] サーバー専用の静的クレデンシャル取得（存在しなければ undefined を返す）
import type { AwsCredentialIdentity } from "@aws-sdk/types";
import { env } from "./env";

export function getServerAwsCredentials(): AwsCredentialIdentity | undefined {
  if (env.AUTOSNSFLOW_ACCESS_KEY_ID && env.AUTOSNSFLOW_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: env.AUTOSNSFLOW_ACCESS_KEY_ID,
      secretAccessKey: env.AUTOSNSFLOW_SECRET_ACCESS_KEY,
    };
  }
  // 未設定なら SDK のデフォルトプロバイダに委ねる
  return undefined;
}
