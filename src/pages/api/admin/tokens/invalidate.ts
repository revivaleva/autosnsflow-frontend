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

    const { token_id, action } = req.body || {};
    if (!token_id || !action) return res.status(400).json({ error: "missing_fields" });

    if (action === "disable") {
      await ddb.send(new UpdateItemCommand({
        TableName: TBL,
        Key: { token_id: { S: token_id } },
        UpdateExpression: "SET disabled = :t, updated_at = :u",
        ExpressionAttributeValues: { ":t": { BOOL: true }, ":u": { N: String(Math.floor(Date.now() / 1000)) } },
      }));
      return res.status(200).json({ ok: true });
    }

    if (action === "clear_binding") {
      await ddb.send(new UpdateItemCommand({
        TableName: TBL,
        Key: { token_id: { S: token_id } },
        UpdateExpression: "REMOVE bound_device_id, bound_at SET updated_at = :u",
        ExpressionAttributeValues: { ":u": { N: String(Math.floor(Date.now() / 1000)) } },
      }));
      return res.status(200).json({ ok: true });
    }

    if (action === "delete") {
      // deletion handled separately via DeleteItem (add permission required)
      const { DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
      await ddb.send(new DeleteItemCommand({ TableName: TBL, Key: { token_id: { S: token_id } } }));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "unknown_action" });
  } catch (e: any) {
    console.error(e);
    const code = e?.statusCode || 500;
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}


