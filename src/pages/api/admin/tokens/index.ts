import type { NextApiRequest, NextApiResponse } from "next";
import { ScanCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest, assertAdmin } from "@/lib/auth";
import { env } from "@/lib/env";

const ddb = createDynamoClient();
const TBL = process.env.TBL_LICENSE_TOKENS || "LicenseTokens";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

    const user = await verifyUserFromRequest(req);
    assertAdmin(user);

    const { page = "1", size = "50", query = "" } = req.query as any;
    const pageNum = Math.max(1, Number(page) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(size) || 50));

    // Simple scan with client-side paging/filtering for now. If dataset grows, switch to queries/GSI.
    const scanResp = await ddb.send(new ScanCommand({ TableName: TBL, Limit: 1000 }));
    const items = (scanResp.Items || []).map((it: any) => {
      const fromAttr = (k: string) => {
        if (!it[k]) return null;
        if (it[k].S !== undefined) return it[k].S;
        if (it[k].N !== undefined) return Number(it[k].N);
        if (it[k].BOOL !== undefined) return Boolean(it[k].BOOL);
        return null;
      };
      return {
        token_id: fromAttr("token_id") || fromAttr("token_hash") || "",
        remaining_quota: Number(fromAttr("remaining_quota") || 0),
        expires_at: Number(fromAttr("expires_at") || 0) || null,
        disabled: Boolean(fromAttr("disabled") || false),
        bound_device_id: fromAttr("bound_device_id") || null,
        updated_at: Number(fromAttr("updated_at") || 0) || null,
        username: fromAttr("username") || null,
        current_container_count: Number(fromAttr("current_container_count") || 0),
        container_count_updated_at: Number(fromAttr("container_count_updated_at") || 0) || null,
      };
    });

    // basic query filter support: naive contains on token_id or metadata.plan
    const filtered = items.filter((it: any) => {
      if (!query) return true;
      const q = String(query).toLowerCase();
      if ((it.token_id || "").toLowerCase().includes(q)) return true;
      return false;
    });

    const start = (pageNum - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    return res.status(200).json({ items: pageItems, page: pageNum, size: pageSize, total: filtered.length });
  } catch (e: any) {
    console.error(e);
    const code = e?.statusCode || 500;
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}


