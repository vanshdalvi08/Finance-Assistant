import { requestBinary } from "@/auth/http-client";

export interface UploadedAsset {
  url: string;
  path?: string;
  fileName: string;
  mimeType?: string;
  size?: number;
}

type UploadKind = "profile-photo" | "expense-attachment" | "fund-receipt" | "resume";

const DEFAULT_UPLOAD_PATHS: Record<UploadKind, string> = {
  "profile-photo": "/uploads/profile-photo",
  "expense-attachment": "/uploads/expense-attachment",
  "fund-receipt": "/uploads/fund-receipt",
  resume: "/uploads/resume",
};

function toUploadPath(kind: UploadKind) {
  const key =
    kind === "profile-photo"
      ? "VITE_UPLOAD_PROFILE_PHOTO_PATH"
      : kind === "expense-attachment"
        ? "VITE_UPLOAD_EXPENSE_ATTACHMENT_PATH"
        : kind === "fund-receipt"
          ? "VITE_UPLOAD_FUND_RECEIPT_PATH"
          : "VITE_UPLOAD_RESUME_PATH";
  const env = import.meta.env as Record<string, string | undefined>;
  return env[key]?.trim() || DEFAULT_UPLOAD_PATHS[kind];
}

function normalizeUploadResponse(payload: unknown, file: File): UploadedAsset {
  if (typeof payload === "string" && payload.trim()) {
    return {
      url: payload.trim(),
      fileName: file.name,
      mimeType: file.type || undefined,
      size: file.size,
    };
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const url =
      (typeof record.url === "string" && record.url.trim()) ||
      (typeof record.publicUrl === "string" && record.publicUrl.trim()) ||
      (typeof record.fileUrl === "string" && record.fileUrl.trim()) ||
      (typeof record.path === "string" && record.path.trim()) ||
      (typeof record.storagePath === "string" && record.storagePath.trim()) ||
      "";

    return {
      url,
      path:
        (typeof record.path === "string" && record.path.trim()) ||
        (typeof record.storagePath === "string" && record.storagePath.trim()) ||
        undefined,
      fileName:
        (typeof record.fileName === "string" && record.fileName.trim()) ||
        (typeof record.name === "string" && record.name.trim()) ||
        file.name,
      mimeType:
        (typeof record.mimeType === "string" && record.mimeType.trim()) ||
        (typeof record.contentType === "string" && record.contentType.trim()) ||
        file.type ||
        undefined,
      size: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : file.size,
    };
  }

  return {
    url: "",
    fileName: file.name,
    mimeType: file.type || undefined,
    size: file.size,
  };
}

async function uploadFile(kind: UploadKind, file: File): Promise<UploadedAsset> {
  const response = await requestBinary<unknown>(toUploadPath(kind), file, {
    "x-file-name": encodeURIComponent(file.name),
  });
  return normalizeUploadResponse(response, file);
}

export async function uploadProfilePhoto(file: File): Promise<UploadedAsset> {
  return uploadFile("profile-photo", file);
}

export async function uploadExpenseAttachment(file: File): Promise<UploadedAsset> {
  return uploadFile("expense-attachment", file);
}

export async function uploadFundReceipt(file: File): Promise<UploadedAsset> {
  return uploadFile("fund-receipt", file);
}

export async function uploadResume(file: File): Promise<UploadedAsset> {
  return uploadFile("resume", file);
}
