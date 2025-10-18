import type { NextApiRequest, NextApiResponse } from "next";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest, assertAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import crypto from "crypto";

const ddb = createDynamoClient();
const TBL = process.env.TBL_LICENSE_TOKENS || "LicenseTokens";

function sha256hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const user = await verifyUserFromRequest(req);
    assertAdmin(user);

    const { remaining_quota, expires_at, metadata, token_plain, username } = req.body || {};
    if (typeof remaining_quota !== "number" || remaining_quota < 0) return res.status(400).json({ error: "invalid_remaining_quota" });

    const plain = token_plain && typeof token_plain === "string" ? token_plain : crypto.randomBytes(16).toString("hex");
    const token_id = sha256hex(plain);
    const now = Math.floor(Date.now() / 1000);

    const item: any = {
      token_id: { S: token_id },
      token_hash: { S: token_id },
      remaining_quota: { N: String(remaining_quota) },
      disabled: { BOOL: false },
      updated_at: { N: String(now) },
      created_at: { N: String(now) },
    };
    if (typeof expires_at === "number") item.expires_at = { N: String(expires_at) };
    if (metadata) item.metadata = { S: JSON.stringify(metadata) };
    if (username && typeof username === "string") item.username = { S: username };

    await ddb.send(new PutItemCommand({ TableName: TBL, Item: item }));

    return res.status(200).json({ ok: true, token_plain: plain, token_id, remaining_quota });
  } catch (e: any) {
    console.error(e);
    const code = e?.statusCode || 500;
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}


