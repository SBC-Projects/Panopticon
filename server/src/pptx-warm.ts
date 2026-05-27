import fs from "node:fs";
import type { SubmissionStore } from "./db.js";
import type { Submission } from "./types.js";
import { schedulePptxRender } from "./pptx-render.js";

/** Queue a background PNG render when a .pptx file was added or changed on disk. */
export function warmPptxIfChanged(
  submission: Pick<
    Submission,
    "id" | "filename" | "absolute_path" | "last_modified_at" | "size_bytes"
  >,
  contentChanged: boolean
): void {
  if (!contentChanged) return;
  if (!submission.filename.toLowerCase().endsWith(".pptx")) return;

  let sizeBytes = submission.size_bytes;
  try {
    sizeBytes = fs.statSync(submission.absolute_path).size;
  } catch {
    return;
  }

  schedulePptxRender(
    submission.id,
    submission.absolute_path,
    submission.last_modified_at,
    sizeBytes
  );
}

/** After a boot scan, pre-warm slide PNGs for every tracked .pptx (serialized COM queue). */
export function warmAllPptxSubmissions(store: SubmissionStore): void {
  for (const sub of store.list()) {
    if (sub.extension !== ".pptx") continue;
    warmPptxIfChanged(sub, true);
  }
}
