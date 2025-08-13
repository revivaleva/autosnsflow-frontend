// /src/lib/auth.ts
// [ADD] CognitoのIdTokenを検証し、ユーザー情報(JWTペイロード)を返す共通関数
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

const REGION = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

export type VerifiedUser = JWTPayload & {
  sub: string;
  email?: string;
  "cognito:groups"?: string[];
};

function getIdTokenFromReq(req: any): string | null {
  // [ADD] Authorization: Bearer または Cookie(idToken) のどちらでも受理
  const auth = req.headers?.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const cookie = req.headers?.cookie || "";
  const m = cookie.match(/(?:^|;\s*)idToken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function verifyUserFromRequest(req: any): Promise<VerifiedUser> {
  const token = getIdTokenFromReq(req);
  if (!token) throw new Error("Unauthorized");

  const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
  const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  const { payload } = await jwtVerify(token, JWKS, { issuer });
  if (!payload.sub) throw new Error("Invalid token");
  return payload as VerifiedUser;
}

export function assertAdmin(user: VerifiedUser) {
  const groups = (user["cognito:groups"] as string[]) || [];
  if (!groups.includes("admin")) {
    const e: any = new Error("forbidden");
    e.statusCode = 403;
    throw e;
  }
}
