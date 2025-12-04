import type { NextApiRequest, NextApiResponse } from "next";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { verifyUserFromRequest } from "@/lib/auth";
import { env } from "@/lib/env";
import { getConfigValue } from "@/lib/config";
import crypto from "crypto";

let s3: S3Client | null = null;
let BUCKET: string | null = null;

async function getS3Client(): Promise<S3Client> {
  if (!s3) {
    const region = getConfigValue("S3_MEDIA_REGION") || env.S3_MEDIA_REGION || "ap-northeast-1";
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

async function getBucket(): Promise<string> {
  if (!BUCKET) {
    const fromEnv = env.S3_MEDIA_BUCKET;
    BUCKET = fromEnv || "";
  }
  return BUCKET;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
];
const SIGNED_URL_EXPIRY = 3600; // 1 hour

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

    const { fileName, fileSize, fileType } = req.body || {};

    // Validate inputs
    if (!fileName || !fileSize || !fileType) {
      return res.status(400).json({
        error: "missing_parameters",
        message: "fileName, fileSize, and fileType are required",
      });
    }

    // Validate file size
    if (typeof fileSize !== "number" || fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: "file_too_large",
        message: `File must be less than ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(fileType)) {
      return res.status(400).json({
        error: "unsupported_file_type",
        message: `File type ${fileType} is not supported`,
      });
    }

    const bucket = await getBucket();
    if (!bucket) {
      return res.status(500).json({ error: "s3_bucket_not_configured" });
    }

    // Generate S3 key
    const ext = fileName.split(".").pop() || "bin";
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(8).toString("hex");
    const s3Key = `media/${userId}/${timestamp}-${randomId}.${ext}`;

    // Generate presigned PUT URL
    const s3Client = await getS3Client();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: fileType,
      ServerSideEncryption: "AES256",
      Metadata: {
        "user-id": userId,
        "uploaded-at": new Date().toISOString(),
      },
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: SIGNED_URL_EXPIRY,
    });

    try {
      console.log("[get-s3-upload-url] generated signed URL", {
        userId,
        s3Key: s3Key.slice(0, 50),
        fileSize,
        fileType,
      });
    } catch (_) {}

    return res.status(200).json({
      ok: true,
      signedUrl,
      s3Key,
      s3Url: `s3://${bucket}/${s3Key}`,
    });
  } catch (e: any) {
    console.error("[get-s3-upload-url] error:", e?.stack || e);
    return res.status(500).json({ error: e?.message || "internal_error" });
  }
}

