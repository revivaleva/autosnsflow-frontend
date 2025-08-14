// /src/lib/auth.ts
// [ADD] API Route からだけ使うCognito検証（Cookie or Bearer）
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { env } from "./env";

export type VerifiedUser = JWTPayload & {
  sub: string;
  email?: string;
  "cognito:groups"?: string[] | string; // [MOD] 文字列も許容（Cognitoの出方に揺れがあるため）
};

function getIdTokenFromReq(req: any): string | null {
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
  const issuer = `https://cognito-idp.${env.AWS_REGION}.amazonaws.com/${env.COGNITO_USER_POOL_ID}`;
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
    const msg = String(err?.message || "");
    const e: any = new Error(msg.includes("Expected 200 OK") ? "jwks_fetch_failed" : "token_verify_failed");
    e.statusCode = msg.includes("Expected 200 OK") ? 500 : 401;
    e.detail = msg;
    throw e;
  }
}

export function assertAdmin(user: VerifiedUser) {
  const groups = (user["cognito:groups"] as string[]) || [];
  const expected = env.ADMIN_GROUP || "Admins"; // [MOD]
  if (!groups.includes(expected)) {
    const e: any = new Error("forbidden");
    e.statusCode = 403;
    throw e;
  }
}
