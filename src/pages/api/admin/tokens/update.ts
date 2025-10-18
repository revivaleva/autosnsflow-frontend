import type { NextApiRequest, NextApiResponse } from "next";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest, assertAdmin } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL = process.env.TBL_LICENSE_TOKENS || "LicenseTokens";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const user = await verifyUserFromRequest(req);
    assertAdmin(user);

    const { token_id, remaining_quota, expires_at, disabled, username } = req.body || {};
    if (!token_id) return res.status(400).json({ error: "missing_token_id" });

    const sets: string[] = [];
    const values: Record<string, any> = { ":u": { N: String(Math.floor(Date.now() / 1000)) } };

    if (typeof remaining_quota === "number") { sets.push("remaining_quota = :rq"); values[":rq"] = { N: String(remaining_quota) }; }
    if (typeof expires_at === "number") { sets.push("expires_at = :ea"); values[":ea"] = { N: String(expires_at) }; }
    if (typeof disabled === "boolean") { sets.push("disabled = :dis"); values[":dis"] = { BOOL: disabled }; }
    if (typeof username === "string") { sets.push("username = :un"); values[":un"] = { S: username }; }


    if (sets.length === 0) return res.status(400).json({ error: "no_fields" });

    sets.push("updated_at = :u");

    await ddb.send(new UpdateItemCommand({
      TableName: TBL,
      Key: { token_id: { S: token_id } },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeValues: values,
    }));

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error(e);
    const code = e?.statusCode || 500;
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}


