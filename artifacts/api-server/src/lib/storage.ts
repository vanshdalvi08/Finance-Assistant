import path from "node:path";
import { randomUUID } from "node:crypto";
import { getSupabaseStorageConfig } from "./env";
import { Buffer } from "node:buffer";

export interface UploadedFileRef {
  fileName: string;
  path: string;
  url: string;
}

export interface ParsedDataUrl {
  contentType: string;
  bytes: Buffer;
  extensionHint?: string;
}

function requireStorageConfig() {
  const config = getSupabaseStorageConfig();
  if (!config) {
    throw new Error(
      "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before uploading files.",
    );
  }

  return config;
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim() || "upload";
  const extension = path.extname(trimmed).replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  const baseName = path
    .basename(trimmed, extension)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${baseName || "file"}${extension.slice(0, 10)}`;
}

function buildObjectPath(prefix: string, fileName: string) {
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${prefix}/${year}/${month}/${randomUUID()}-${sanitizeFileName(fileName)}`;
}

function encodeObjectPath(objectPath: string) {
  return objectPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function parseDataUrl(value: string): ParsedDataUrl | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(value.trim());
  if (!match) {
    return null;
  }

  const contentType = match[1] || "application/octet-stream";
  const payload = match[2] || "";
  return {
    contentType,
    bytes: Buffer.from(payload, "base64"),
    extensionHint: contentType.split("/")[1]?.split("+")[0],
  };
}

async function uploadObject(
  bucket: string,
  objectPath: string,
  body: Uint8Array,
  contentType: string,
) {
  const config = requireStorageConfig();
  const response = await fetch(
    `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
        "Content-Type": contentType,
        "x-upsert": "false",
      },
      body,
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase Storage upload failed (${response.status}): ${detail || "Unknown error"}`);
  }
}

function publicObjectUrl(bucket: string, objectPath: string) {
  const config = requireStorageConfig();
  return `${config.url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`;
}

async function signedObjectUrl(bucket: string, objectPath: string, expiresIn = 3600) {
  const config = requireStorageConfig();
  const response = await fetch(
    `${config.url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase Storage signed URL failed (${response.status}): ${detail || "Unknown error"}`);
  }

  const payload = (await response.json()) as { signedURL?: string; signedUrl?: string };
  const relative = payload.signedURL ?? payload.signedUrl;
  if (!relative) {
    throw new Error("Supabase Storage did not return a signed URL.");
  }

  if (relative.startsWith("http")) {
    return relative;
  }

  if (relative.startsWith("/storage/")) {
    return `${config.url}${relative}`;
  }

  return `${config.url}/storage/v1${relative.startsWith("/") ? relative : `/${relative}`}`;
}

export async function uploadProfilePhoto(input: {
  fileName: string;
  contentType: string;
  body: Uint8Array;
  actorId: string;
}) : Promise<UploadedFileRef> {
  const config = requireStorageConfig();
  const objectPath = buildObjectPath(`avatars/${input.actorId}`, input.fileName);
  await uploadObject(config.avatarsBucket, objectPath, input.body, input.contentType);

  return {
    fileName: sanitizeFileName(input.fileName),
    path: objectPath,
    url: publicObjectUrl(config.avatarsBucket, objectPath),
  };
}

export async function uploadProfilePhotoDataUrl(input: {
  dataUrl: string;
  fileName: string;
  actorId: string;
}) : Promise<UploadedFileRef> {
  const parsed = parseDataUrl(input.dataUrl);
  if (!parsed) {
    throw new Error("Invalid profile photo data URL");
  }

  const fileName = input.fileName || `profile-photo.${parsed.extensionHint ?? "png"}`;
  return uploadProfilePhoto({
    fileName,
    contentType: parsed.contentType,
    body: parsed.bytes,
    actorId: input.actorId,
  });
}

export async function uploadExpenseAttachment(input: {
  fileName: string;
  contentType: string;
  body: Uint8Array;
  actorId: string;
}) : Promise<UploadedFileRef> {
  const config = requireStorageConfig();
  const objectPath = buildObjectPath(`expenses/${input.actorId}`, input.fileName);
  await uploadObject(config.expenseAttachmentsBucket, objectPath, input.body, input.contentType);

  return {
    fileName: sanitizeFileName(input.fileName),
    path: objectPath,
    url: await signedObjectUrl(config.expenseAttachmentsBucket, objectPath),
  };
}

export async function resolveExpenseAttachmentUrl(objectPath?: string | null) {
  if (!objectPath) {
    return undefined;
  }

  const config = getSupabaseStorageConfig();
  if (!config) {
    return undefined;
  }

  try {
    return await signedObjectUrl(config.expenseAttachmentsBucket, objectPath);
  } catch {
    return undefined;
  }
}
