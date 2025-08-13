// /src/lib/auth.ts
// [MOD] 環境変数の参照を env.ts に統一し、JWKS取得エラーの扱いを明確化
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { env } from "@/lib/env"; // [ADD]

export type VerifiedUser = JWTPayload & {
  sub: string;
  email?: string;
  "cognito:groups"?: string[];
};

function getIdTokenFromReq(req: any): string | null {
  // [KEEP] Authorization: Bearer / Cookie(idToken) の両対応
  const auth = req.headers?.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const cookie = req.headers?.cookie || "";
  const m = cookie.match(/(?:^|;\s*)idToken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function verifyUserFromRequest(req: any): Promise<VerifiedUser> {
  const token = getIdTokenFromReq(req);
  if (!token) {
    const e: any = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  // [MOD] env.ts から取得（COGNITO_* を優先、なければ NEXT_PUBLIC_*）
  const REGION = env.AWS_REGION;
  const USER_POOL_ID = env.COGNITO_USER_POOL_ID;
  if (!USER_POOL_ID) {
    const e: any = new Error("Cognito UserPoolId is missing");
    e.statusCode = 500;
    throw e;
  }
  const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

  try {
    const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, JWKS, { issuer });
    if (!payload.sub) {
      const e: any = new Error("Invalid token");
      e.statusCode = 401;
      throw e;
    }
    return payload as VerifiedUser;
  } catch (err: any) {
    // [ADD] jose の JWKS 取得エラーを 401 or 500 に整理
    const msg = String(err?.message || "");
    const e: any = new Error(
      msg.includes("Expected 200 OK") ? "jwks_fetch_failed" : "token_verify_failed"
    );
    e.statusCode = msg.includes("Expected 200 OK") ? 500 : 401;
    e.detail = msg; // ログ用
    throw e;
  }
}

export function assertAdmin(user: VerifiedUser) {
  const groups = (user["cognito:groups"] as string[]) || [];
  if (!groups.includes("admin")) {
    const e: any = new Error("forbidden");
    e.statusCode = 403;
    throw e;
  }
}
