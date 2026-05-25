import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import type { Submission } from "./types.js";
import { injectHeadingIds } from "./structure.js";

export type PreviewResult =
  | { type: "html"; html: string }
  | { type: "binary"; mime: string }
  | { type: "unsupported"; message: string }
  | { type: "error"; message: string };

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
};

export async function buildPreview(
  submission: Submission
): Promise<PreviewResult> {
  const filePath = submission.absolute_path;

  if (!fs.existsSync(filePath)) {
    return {
      type: "error",
      message:
        "File not available locally yet. OneDrive may still be syncing — try again shortly.",
    };
  }

  const ext = submission.extension || path.extname(filePath).toLowerCase();

  if (ext === ".docx") {
    try {
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.convertToHtml({ buffer });
      return { type: "html", html: injectHeadingIds(result.value) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Conversion failed";
      return {
        type: "error",
        message: `Could not preview Word file: ${msg}. Use Open in Word.`,
      };
    }
  }

  const mime = MIME[ext];
  if (mime) {
    return { type: "binary", mime };
  }

  return {
    type: "unsupported",
    message: `Preview not available for ${ext || "this file type"}. Use Open in Word or download from the synced folder.`,
  };
}

export function getFileStream(submission: Submission): fs.ReadStream | null {
  if (!fs.existsSync(submission.absolute_path)) return null;
  return fs.createReadStream(submission.absolute_path);
}
