import express, { Router, type IRouter, type Request } from "express";
import { requireAuth } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rate-limit";
import { uploadExpenseAttachment, uploadProfilePhoto } from "../lib/storage";

const router: IRouter = Router();

const profileUpload = express.raw({
  type: "*/*",
  limit: "4mb",
});

const expenseUpload = express.raw({
  type: "*/*",
  limit: "8mb",
});

const uploadLimiter = rateLimit({
  name: "file-upload",
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many uploads. Please try again later.",
});

function isAllowedImageSignature(body: Uint8Array) {
  if (body.length >= 12) {
    const png = body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
    const webp = body[0] === 0x52 && body[1] === 0x49 && body[2] === 0x46 && body[3] === 0x46;
    if (png) {
      return true;
    }

    if (webp && body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50) {
      return true;
    }
  }

  const jpeg = body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  const gif87a =
    body.length >= 6 &&
    body[0] === 0x47 &&
    body[1] === 0x49 &&
    body[2] === 0x46 &&
    body[3] === 0x38 &&
    body[4] === 0x37 &&
    body[5] === 0x61;
  const gif89a =
    body.length >= 6 &&
    body[0] === 0x47 &&
    body[1] === 0x49 &&
    body[2] === 0x46 &&
    body[3] === 0x38 &&
    body[4] === 0x39 &&
    body[5] === 0x61;

  return jpeg || gif87a || gif89a;
}

function isAllowedPdfSignature(body: Uint8Array) {
  return body.length >= 5 && body[0] === 0x25 && body[1] === 0x50 && body[2] === 0x44 && body[3] === 0x46 && body[4] === 0x2d;
}

function readUploadRequestMeta(request: Request) {
  const fileNameHeader = request.header("x-file-name");
  const fileName = fileNameHeader ? decodeURIComponent(fileNameHeader) : "upload.bin";
  const contentType = request.header("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const body = request.body;

  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new Error("Upload body is empty.");
  }

  return { fileName, contentType, body: new Uint8Array(body) };
}

router.use(requireAuth);

router.post("/profile-photo", uploadLimiter, profileUpload, async (request, response) => {
  try {
    const { fileName, contentType, body } = readUploadRequestMeta(request);

    const allowedType = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(contentType);
    if (!allowedType || !isAllowedImageSignature(body)) {
      response.status(400).json({ message: "Profile photos must be image files." });
      return;
    }

    const uploaded = await uploadProfilePhoto({
      fileName,
      contentType,
      body,
      actorId: request.auth?.user.id ?? "unknown",
    });

    response.status(201).json(uploaded);
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : "Profile photo upload failed." });
  }
});

router.post("/expense-attachment", uploadLimiter, expenseUpload, async (request, response) => {
  try {
    const { fileName, contentType, body } = readUploadRequestMeta(request);

    const allowed =
      contentType === "application/pdf" ||
      contentType === "image/jpeg" ||
      contentType === "image/png" ||
      contentType === "image/gif" ||
      contentType === "image/webp";

    if ((contentType === "application/pdf" && !isAllowedPdfSignature(body)) || (contentType !== "application/pdf" && !isAllowedImageSignature(body))) {
      response.status(400).json({ message: "Expense attachments must be a valid image or PDF file." });
      return;
    }

    if (!allowed) {
      response.status(400).json({ message: "Expense attachments must be an image or PDF file." });
      return;
    }

    const uploaded = await uploadExpenseAttachment({
      fileName,
      contentType,
      body,
      actorId: request.auth?.user.id ?? "unknown",
    });

    response.status(201).json(uploaded);
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : "Expense attachment upload failed." });
  }
});

export default router;
