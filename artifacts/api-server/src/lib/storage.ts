import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getAppUrl, getSupabaseStorageConfig } from "./env";
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

function localStorageRoot() {
  return path.resolve(process.cwd(), "..", "..", ".tmp", "storage");
}

function localApiBaseUrl() {
  const appUrl = getAppUrl();
  try {
    const parsed = new URL(appUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      parsed.port = "3001";
      parsed.pathname = "/api";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    // Fall back below.
  }

  return "http://127.0.0.1:3001/api";
}

function localSalarySlipDownloadUrl(objectPath: string) {
  return `${localApiBaseUrl()}/business/salary-slips/local/${Buffer.from(objectPath).toString("base64url")}`;
}

async function writeLocalObject(objectPath: string, body: Uint8Array) {
  const absolutePath = path.join(localStorageRoot(), objectPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, body);
}

async function readLocalObject(objectPath: string) {
  const root = localStorageRoot();
  const absolutePath = path.resolve(root, objectPath);
  if (!absolutePath.startsWith(root + path.sep)) {
    throw new Error("Invalid local storage path.");
  }
  return readFile(absolutePath);
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

async function deleteObject(bucket: string, objectPath: string) {
  const config = requireStorageConfig();
  const response = await fetch(
    `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
      },
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase Storage delete failed (${response.status}): ${detail || "Unknown error"}`);
  }
}

export async function deleteResumeObject(objectPath: string) {
  const config = getSupabaseStorageConfig();
  if (!config) {
    return;
  }
  await deleteObject(config.resumesBucket, objectPath);
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

export async function uploadFundReceipt(input: {
  fileName: string;
  contentType: string;
  body: Uint8Array;
  actorId: string;
}) : Promise<UploadedFileRef> {
  const config = requireStorageConfig();
  const objectPath = buildObjectPath(`funds/${input.actorId}`, input.fileName);
  await uploadObject(config.fundReceiptsBucket, objectPath, input.body, input.contentType);

  return {
    fileName: sanitizeFileName(input.fileName),
    path: objectPath,
    url: await signedObjectUrl(config.fundReceiptsBucket, objectPath),
  };
}

export async function uploadResume(input: {
  fileName: string;
  contentType: string;
  body: Uint8Array;
  actorId: string;
}) : Promise<UploadedFileRef> {
  const config = requireStorageConfig();
  const objectPath = buildObjectPath(`resumes/${input.actorId}`, input.fileName);
  await uploadObject(config.resumesBucket, objectPath, input.body, input.contentType);

  return {
    fileName: sanitizeFileName(input.fileName),
    path: objectPath,
    url: await signedObjectUrl(config.resumesBucket, objectPath),
  };
}

export async function uploadSalarySlip(input: {
  fileName: string;
  body: Uint8Array;
  tenantId: string;
  employeeId: string;
}) : Promise<UploadedFileRef> {
  const objectPath = buildObjectPath(
    `salary-slips/${input.tenantId}/${input.employeeId}`,
    input.fileName,
  );
  const config = getSupabaseStorageConfig();
  if (!config) {
    await writeLocalObject(objectPath, input.body);
    return {
      fileName: sanitizeFileName(input.fileName),
      path: objectPath,
      url: localSalarySlipDownloadUrl(objectPath),
    };
  }

  await uploadObject(config.salarySlipsBucket, objectPath, input.body, "application/pdf");

  return {
    fileName: sanitizeFileName(input.fileName),
    path: objectPath,
    url: await signedObjectUrl(config.salarySlipsBucket, objectPath),
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

export async function resolveFundReceiptUrl(objectPath?: string | null) {
  if (!objectPath) {
    return undefined;
  }

  const config = getSupabaseStorageConfig();
  if (!config) {
    return undefined;
  }

  try {
    return await signedObjectUrl(config.fundReceiptsBucket, objectPath);
  } catch {
    return undefined;
  }
}

export async function resolveResumeUrl(objectPath?: string | null) {
  if (!objectPath) {
    return undefined;
  }

  const config = getSupabaseStorageConfig();
  if (!config) {
    return undefined;
  }

  try {
    return await signedObjectUrl(config.resumesBucket, objectPath);
  } catch {
    return undefined;
  }
}

export async function resolveSalarySlipUrl(objectPath?: string | null) {
  if (!objectPath) {
    return undefined;
  }

  const config = getSupabaseStorageConfig();
  if (!config) {
    return localSalarySlipDownloadUrl(objectPath);
  }

  try {
    return await signedObjectUrl(config.salarySlipsBucket, objectPath);
  } catch {
    return undefined;
  }
}

export async function readLocalSalarySlipByToken(token: string) {
  const objectPath = Buffer.from(token, "base64url").toString("utf8");
  if (!objectPath.startsWith("salary-slips/")) {
    throw new Error("Invalid salary slip path.");
  }
  return readLocalObject(objectPath);
}
