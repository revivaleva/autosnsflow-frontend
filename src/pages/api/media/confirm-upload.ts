import type { NextApiRequest, NextApiResponse } from "next";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { verifyUserFromRequest } from "@/lib/auth";
import { env } from "@/lib/env";

let s3: S3Client | null = null;

async function getS3Client(): Promise<S3Client> {
  if (!s3) {
    const region = env.S3_MEDIA_REGION || "ap-northeast-1";
    s3 = new S3Client({
      region,
      credentials:
        env.AUTOSNSFLOW_ACCESS_KEY_ID && env.AUTOSNSFLOW_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.AUTOSNSFLOW_ACCESS_KEY_ID,
              secretAccessKey: env.AUTOSNSFLOW_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }
  return s3;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await verifyUserFromRequest(req).catch(() => null);
  if (!user?.sub) return res.status(401).json({ error: "unauthorized" });
  const userId = user.sub;

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const { s3Url, fileName, fileType, fileSize } = req.body || {};

    // Validate inputs
    if (!s3Url || !fileName) {
      return res.status(400).json({
        error: "missing_parameters",
        message: "s3Url and fileName are required",
      });
    }

    // Verify S3 URL format and extract bucket/key
    if (!s3Url.startsWith("s3://")) {
      return res.status(400).json({
        error: "invalid_s3_url",
        message: "s3Url must start with s3://",
      });
    }

    const parts = s3Url.slice(5).split("/");
    const bucket = parts[0];
    const key = parts.slice(1).join("/");

    // Verify that the key belongs to this user
    if (!key.startsWith(`media/${userId}/`)) {
      return res.status(403).json({
        error: "permission_denied",
        message: "You can only confirm uploads for your own media",
      });
    }

    // Verify object exists in S3
    const s3Client = await getS3Client();
    try {
      const headResp = await s3Client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      );

      try {
        console.log("[confirm-upload] verified S3 object", {
          userId,
          s3Key: key.slice(0, 50),
          size: headResp.ContentLength,
          contentType: headResp.ContentType,
        });
      } catch (_) {}

      return res.status(200).json({
        ok: true,
        s3Url,
        fileName,
        fileType: headResp.ContentType || fileType,
        fileSize: headResp.ContentLength || fileSize,
        confirmed: true,
      });
    } catch (e: any) {
      // Object not found or access denied
      if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({
          error: "s3_object_not_found",
          message: "Uploaded file not found in S3",
        });
      }
      throw e;
    }
  } catch (e: any) {
    console.error("[confirm-upload] error:", e?.stack || e);
    return res.status(500).json({ error: e?.message || "internal_error" });
  }
}

