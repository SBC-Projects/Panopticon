import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import type { Submission } from "./types.js";
import { injectHeadingIds } from "./structure.js";
import { renderPptxSlides } from "./pptx-render.js";

export interface SlideRef {
  /** 1-based, matches PowerPoint's UI numbering. */
  index: number;
  /** From the deck's title placeholder, or `Slide N` fallback. */
  title: string;
  /**
   * Relative API path the client appends `?v=<mtime>` to for
   * cache-busting. See `GET /api/preview/:id/slide/:n` in routes.ts.
   */
  image_path: string;
}

export type PreviewResult =
  | { type: "html"; html: string }
  | { type: "binary"; mime: string }
  | {
      type: "slides";
      slides: SlideRef[];
      /** `stale` = older PNGs on disk while a background re-render runs. */
      slides_cache: "fresh" | "stale";
      /** Cache-buster for slide PNG URLs (`mtime:size` of the rendered manifest). */
      slides_cache_key: string;
    }
  | {
      type: "empty";
      reason:
        | "not_downloaded"
        | "empty_body"
        | "render_unavailable"
        | "render_pending";
      message: string;
    }
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
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Read failed";
      console.warn(
        `[preview] read failed for ${path.basename(filePath)}: ${msg}`
      );
      return {
        type: "error",
        message: `Could not read Word file: ${msg}. Use Open in Word.`,
      };
    }

    if (buffer.length === 0) {
      return {
        type: "empty",
        reason: "not_downloaded",
        message:
          "OneDrive hasn't downloaded this file yet (0 bytes on disk). It should appear once sync catches up — or right-click it in Explorer → Always keep on this device.",
      };
    }

    try {
      const result = await mammoth.convertToHtml({ buffer });
      const html = result.value || "";
      const hasText = /\S/.test(html.replace(/<[^>]+>/g, ""));
      if (!hasText) {
        return {
          type: "empty",
          reason: "empty_body",
          message:
            "This document doesn't contain any text yet. The student may not have started, or Word's autosave hasn't pushed their latest edits to OneDrive yet.",
        };
      }
      return { type: "html", html: injectHeadingIds(html) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Conversion failed";
      console.warn(
        `[preview] mammoth failed for ${path.basename(filePath)}: ${msg}`
      );
      return {
        type: "error",
        message: `Could not preview Word file: ${msg}. Use Open in Word.`,
      };
    }
  }

  if (ext === ".pptx") {
    return buildPptxPreview(submission, filePath);
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

async function buildPptxPreview(
  submission: Submission,
  filePath: string
): Promise<PreviewResult> {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "stat failed";
    return {
      type: "error",
      message: `Could not read PowerPoint file: ${msg}. Use Open in PowerPoint.`,
    };
  }

  if (size === 0) {
    return {
      type: "empty",
      reason: "not_downloaded",
      message:
        "OneDrive hasn't downloaded this file yet (0 bytes on disk). It should appear once sync catches up — or right-click it in Explorer → Always keep on this device.",
    };
  }

  // Cached on disk by (mtime, size). First call per deck-version pays
  // the PowerPoint COM round-trip (~3–5 s); subsequent calls return
  // from the manifest in <100 ms.
  const render = await renderPptxSlides(
    submission.id,
    filePath,
    submission.last_modified_at,
    size
  );
  if (!render.ok) {
    return {
      type: "empty",
      reason: render.reason,
      message: render.message,
    };
  }

  if (render.manifest.slide_count === 0) {
    return {
      type: "empty",
      reason: "empty_body",
      message:
        "This deck has no slides yet. The student may not have added anything, or OneDrive hasn't pulled the latest SharePoint state yet.",
    };
  }

  const slides: SlideRef[] = render.manifest.titles.map((title, i) => ({
    index: i + 1,
    title,
    image_path: `/api/preview/${submission.id}/slide/${i + 1}`,
  }));
  return {
    type: "slides",
    slides,
    slides_cache: render.stale ? "stale" : "fresh",
    slides_cache_key: `${render.manifest.mtime_iso}:${render.manifest.size_bytes}`,
  };
}

export function getFileStream(submission: Submission): fs.ReadStream | null {
  if (!fs.existsSync(submission.absolute_path)) return null;
  return fs.createReadStream(submission.absolute_path);
}
