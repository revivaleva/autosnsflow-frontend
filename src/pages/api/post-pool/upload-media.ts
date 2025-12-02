import type { NextApiRequest, NextApiResponse } from "next";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { verifyUserFromRequest } from "@/lib/auth";
import { env } from "@/lib/env";
import crypto from "crypto";

const s3 = new S3Client({
  region: env.S3_MEDIA_REGION,
  credentials:
    env.AUTOSNSFLOW_ACCESS_KEY_ID && env.AUTOSNSFLOW_SECRET_ACCESS_KEY
      ? {
          accessKeyId: env.AUTOSNSFLOW_ACCESS_KEY_ID,
          secretAccessKey: env.AUTOSNSFLOW_SECRET_ACCESS_KEY,
        }
      : undefined,
});

const BUCKET = env.S3_MEDIA_BUCKET;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_FILES = 4;

interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

type BodyType = Record<string, unknown>;

function safeBody(body: unknown): BodyType {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as BodyType;
    } catch {
      return {};
    }
  }
  return (body as BodyType) || {};
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
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

  console.log(`[upload-media] request method=${req.method} user=${userId}`);

  try {
    if (!BUCKET) {
      return res
        .status(500)
        .json({ error: "s3_bucket_not_configured" });
    }

    if (req.method === "POST") {
      // Handle multipart/form-data uploads via multipart parsing
      // For now, accept base64-encoded image data via JSON
      const body = safeBody(req.body);
      const files = body.files as Array<{ data: string; type: string; name: string }> || [];

      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: "no_files_provided" });
      }

      if (files.length > MAX_FILES) {
        return res
          .status(400)
          .json({
            error: `too_many_files`,
            message: `Max ${MAX_FILES} files allowed`,
          });
      }

      const uploadedUrls: string[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        try {
          // Validate file type
          if (!ALLOWED_TYPES.includes(file.type)) {
            errors.push({
              file: file.name,
              error: "unsupported_file_type",
            });
            continue;
          }

          // Decode base64 data
          let buffer: Buffer;
          try {
            const base64Data = file.data.replace(
              /^data:image\/[a-z]+;base64,/,
              ""
            );
            buffer = Buffer.from(base64Data, "base64");
          } catch (e) {
            errors.push({
              file: file.name,
              error: "invalid_base64_data",
            });
            continue;
          }

          // Validate file size
          if (buffer.length > MAX_FILE_SIZE) {
            errors.push({
              file: file.name,
              error: `file_too_large (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`,
            });
            continue;
          }

          // Generate S3 key
          const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
          const timestamp = Date.now();
          const randomId = crypto.randomBytes(8).toString("hex");
          const s3Key = `media/${userId}/${timestamp}-${randomId}.${ext}`;

          // Upload to S3
          await s3.send(
            new PutObjectCommand({
              Bucket: BUCKET,
              Key: s3Key,
              Body: buffer,
              ContentType: file.type,
              ServerSideEncryption: "AES256",
              Metadata: {
                "user-id": userId,
                "uploaded-at": new Date().toISOString(),
              },
            })
          );

          const url = `s3://${BUCKET}/${s3Key}`;
          uploadedUrls.push(url);
          console.log(`[upload-media] uploaded ${s3Key} user=${userId}`);
        } catch (e: any) {
          console.error(`[upload-media] upload failed for ${file.name}:`, e);
          errors.push({
            file: file.name,
            error: String(e?.message || "upload_failed"),
          });
        }
      }

      if (uploadedUrls.length === 0 && errors.length > 0) {
        return res.status(400).json({
          error: "all_files_failed",
          errors,
        });
      }

      return res.status(200).json({
        ok: true,
        urls: uploadedUrls,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e: any) {
    console.error("[upload-media] error:", e?.stack || e);
    return res
      .status(e?.statusCode || 500)
      .json({ error: e?.message || "internal_error" });
  }
}

