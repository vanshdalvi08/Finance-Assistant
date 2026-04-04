import express, { Router, type IRouter, type Request } from "express";
import { requireAuth } from "../middlewares/auth";
import { uploadExpenseAttachment, uploadProfilePhoto } from "../lib/storage";

const router: IRouter = Router();

const rawUpload = express.raw({
  type: "*/*",
  limit: "6mb",
});

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

router.post("/profile-photo", rawUpload, async (request, response) => {
  try {
    const { fileName, contentType, body } = readUploadRequestMeta(request);

    if (!contentType.startsWith("image/")) {
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

router.post("/expense-attachment", rawUpload, async (request, response) => {
  try {
    const { fileName, contentType, body } = readUploadRequestMeta(request);

    const allowed =
      contentType === "application/pdf" ||
      contentType.startsWith("image/");

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
