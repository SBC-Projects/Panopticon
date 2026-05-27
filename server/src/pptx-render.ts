import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractPptxSlideTitles } from "./pptx.js";

/**
 * Render every slide of a .pptx to PNG via PowerPoint COM, driven from
 * `scripts/render-pptx-slides.ps1`. Results are cached on disk under
 * `data/pptx-cache/<submission_id>/` so a single deck is only rendered
 * once per (mtime, size) — same invalidation rule the docx-stats cache
 * uses, for the same reason (OneDrive 0-byte → real-bytes transitions
 * change size without touching mtime).
 *
 * Cache layout:
 *   data/pptx-cache/<id>/
 *     manifest.json     { mtime_iso, size_bytes, slide_count, titles }
 *     slide-001.png
 *     slide-002.png
 *     ...
 *
 * COM is Windows + Office only. When PowerShell isn't on PATH, the
 * script errors out, or PowerPoint isn't installed, we return
 * `{ok: false, reason: "render_unavailable", message}` so the preview
 * endpoint can surface that as an empty-state with "Open in
 * PowerPoint" — cards still get text + titles via the pure-JS path in
 * `pptx.ts`.
 *
 * No `*.test.ts` — this module shells out to PowerShell + Office and
 * is exercised by the manual recipe in
 * `docs/features/powerpoint-support.md` §6.
 */

export interface RenderManifest {
  mtime_iso: string;
  size_bytes: number;
  slide_count: number;
  titles: string[];
}

export type RenderResult =
  | { ok: true; cache_dir: string; manifest: RenderManifest }
  | { ok: false; reason: "render_unavailable"; message: string };

const CACHE_ROOT = path.resolve("data", "pptx-cache");
const RENDER_SCRIPT = path.resolve("scripts", "render-pptx-slides.ps1");
const RENDER_TIMEOUT_MS = 60_000;

const RENDER_UNAVAILABLE_MESSAGE =
  "PowerPoint rendering unavailable on this machine. Make sure PowerPoint is installed, or use Open in PowerPoint to view the slides.";

export function pptxCacheDir(submissionId: string): string {
  return path.join(CACHE_ROOT, submissionId);
}

export function pptxSlidePath(submissionId: string, n: number): string {
  return path.join(pptxCacheDir(submissionId), slideFilename(n));
}

/**
 * Stream a single rendered slide PNG, or null if the file isn't on
 * disk (deck wasn't rendered, render failed, or slide index is out of
 * range). Mirrors `getFileStream` from `preview.ts` so routes.ts has a
 * consistent shape for "serve a binary or 404".
 */
export function pptxSlideStream(
  submissionId: string,
  n: number
): fs.ReadStream | null {
  if (!Number.isInteger(n) || n < 1) return null;
  const p = pptxSlidePath(submissionId, n);
  if (!fs.existsSync(p)) return null;
  return fs.createReadStream(p);
}

function slideFilename(n: number): string {
  return `slide-${String(n).padStart(3, "0")}.png`;
}

function manifestPath(dir: string): string {
  return path.join(dir, "manifest.json");
}

function readManifest(dir: string): RenderManifest | null {
  try {
    const raw = fs.readFileSync(manifestPath(dir), "utf8");
    const parsed = JSON.parse(raw) as RenderManifest;
    if (
      typeof parsed.mtime_iso !== "string" ||
      typeof parsed.size_bytes !== "number" ||
      typeof parsed.slide_count !== "number" ||
      !Array.isArray(parsed.titles)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function renderPptxSlides(
  submissionId: string,
  absolutePath: string,
  mtimeIso: string,
  sizeBytes: number
): Promise<RenderResult> {
  const dir = pptxCacheDir(submissionId);

  const existing = readManifest(dir);
  if (
    existing &&
    existing.mtime_iso === mtimeIso &&
    existing.size_bytes === sizeBytes
  ) {
    return { ok: true, cache_dir: dir, manifest: existing };
  }

  // Cache miss (or stale). Wipe before re-rendering so a partial /
  // crashed render can't leak old PNGs into the new manifest.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  let slideCount: number;
  try {
    slideCount = await runRenderScript(absolutePath, dir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[pptx-render] COM render failed for ${path.basename(absolutePath)}: ${msg}`
    );
    // Leave the empty dir for the next attempt to retry into.
    return {
      ok: false,
      reason: "render_unavailable",
      message: RENDER_UNAVAILABLE_MESSAGE,
    };
  }

  const titles = await readTitles(absolutePath, slideCount);
  const manifest: RenderManifest = {
    mtime_iso: mtimeIso,
    size_bytes: sizeBytes,
    slide_count: slideCount,
    titles,
  };
  fs.writeFileSync(manifestPath(dir), JSON.stringify(manifest, null, 2));
  return { ok: true, cache_dir: dir, manifest };
}

export function invalidatePptxCache(submissionId: string): void {
  fs.rmSync(pptxCacheDir(submissionId), { recursive: true, force: true });
}

async function readTitles(
  absolutePath: string,
  slideCount: number
): Promise<string[]> {
  try {
    const buffer = fs.readFileSync(absolutePath);
    const extracted = await extractPptxSlideTitles(buffer);
    // Index by slide number so we don't depend on extractor ordering
    // (we already sort numerically there, but be defensive).
    const byIndex = new Map(extracted.map((t) => [t.index, t.title]));
    return Array.from(
      { length: slideCount },
      (_, i) => byIndex.get(i + 1) ?? `Slide ${i + 1}`
    );
  } catch {
    return Array.from({ length: slideCount }, (_, i) => `Slide ${i + 1}`);
  }
}

interface ScriptResult {
  ok: boolean;
  slide_count: number;
  width: number;
  height: number;
}

function runRenderScript(
  inputPath: string,
  outputDir: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        RENDER_SCRIPT,
        "-InputPath",
        inputPath,
        "-OutputDir",
        outputDir,
      ],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    proc.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`render timed out after ${RENDER_TIMEOUT_MS}ms`));
    }, RENDER_TIMEOUT_MS);

    proc.on("error", (err) => {
      clearTimeout(timeout);
      // Most common cause on non-Windows or stripped environments:
      // powershell.exe is not on PATH.
      reject(new Error(`could not spawn powershell.exe: ${err.message}`));
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const out = stderr.trim() || stdout.trim() || "no output";
        reject(new Error(`exit ${code}: ${out}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as ScriptResult;
        if (!parsed.ok || typeof parsed.slide_count !== "number") {
          throw new Error(`unexpected script output: ${stdout}`);
        }
        resolve(parsed.slide_count);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(
          new Error(`could not parse script output: ${msg}; stdout=${stdout}`)
        );
      }
    });
  });
}
