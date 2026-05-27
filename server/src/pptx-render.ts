import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractPptxSlideTitles } from "./pptx.js";

/**
 * Render every slide of a .pptx to PNG via PowerPoint COM. Results live on
 * disk under `data/pptx-cache/<submission_id>/` so repeat previews are
 * instant. Renders are serialized (one COM job at a time) and can be
 * queued in the background when a file changes.
 *
 * Cache layout:
 *   data/pptx-cache/<id>/
 *     manifest.json
 *     slide-001.png …
 *     .rendering/          (in-flight render; promoted atomically on success)
 */

export interface RenderManifest {
  mtime_iso: string;
  size_bytes: number;
  slide_count: number;
  titles: string[];
}

export type RenderResult =
  | { ok: true; cache_dir: string; manifest: RenderManifest; stale?: boolean }
  | { ok: false; reason: "render_unavailable"; message: string }
  | { ok: false; reason: "render_pending"; message: string };

export interface RenderPptxOptions {
  /**
   * When there is no cached PNG set yet, block until the first render
   * finishes (preview endpoint). Background pre-warm passes false.
   */
  wait_if_missing?: boolean;
  /** Serve the previous PNG set while a newer version renders. Default true. */
  allow_stale?: boolean;
}

const CACHE_ROOT = path.resolve("data", "pptx-cache");
const RENDERING_SUBDIR = ".rendering";
const RENDER_SCRIPT = path.resolve("scripts", "render-pptx-slides.ps1");
const RENDER_TIMEOUT_MS = 60_000;

const RENDER_UNAVAILABLE_MESSAGE =
  "PowerPoint rendering unavailable on this machine. Make sure PowerPoint is installed, or use Open in PowerPoint to view the slides.";

const RENDER_PENDING_MESSAGE =
  "Slide images are still rendering. They should appear shortly — try Refresh in a few seconds.";

/** One COM render at a time — parallel PowerShell sessions fight over PowerPoint. */
let renderChain: Promise<void> = Promise.resolve();

type PendingRender = {
  absolutePath: string;
  mtimeIso: string;
  sizeBytes: number;
  waiters: ((result: RenderResult) => void)[];
  scheduled: boolean;
};

const pendingRenders = new Map<string, PendingRender>();

export function pptxCacheDir(submissionId: string): string {
  return path.join(CACHE_ROOT, submissionId);
}

export function pptxSlidePath(submissionId: string, n: number): string {
  return path.join(pptxCacheDir(submissionId), slideFilename(n));
}

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

function isManifestFresh(
  manifest: RenderManifest,
  mtimeIso: string,
  sizeBytes: number
): boolean {
  return manifest.mtime_iso === mtimeIso && manifest.size_bytes === sizeBytes;
}

function slidesExist(dir: string, slideCount: number): boolean {
  if (slideCount < 1) return false;
  for (let i = 1; i <= slideCount; i++) {
    if (!fs.existsSync(path.join(dir, slideFilename(i)))) return false;
  }
  return true;
}

function getUsableCache(
  dir: string,
  mtimeIso: string,
  sizeBytes: number
): { manifest: RenderManifest; stale: boolean } | null {
  const manifest = readManifest(dir);
  if (!manifest || !slidesExist(dir, manifest.slide_count)) return null;
  if (isManifestFresh(manifest, mtimeIso, sizeBytes)) {
    return { manifest, stale: false };
  }
  return { manifest, stale: true };
}

/**
 * Queue a background render after a file add/change. Safe to call often —
 * coalesces per submission id and runs COM jobs one at a time.
 */
export function schedulePptxRender(
  submissionId: string,
  absolutePath: string,
  mtimeIso: string,
  sizeBytes: number
): void {
  const dir = pptxCacheDir(submissionId);
  const cached = getUsableCache(dir, mtimeIso, sizeBytes);
  if (cached && !cached.stale) return;

  requestPptxRender(submissionId, absolutePath, mtimeIso, sizeBytes, false);
}

function requestPptxRender(
  submissionId: string,
  absolutePath: string,
  mtimeIso: string,
  sizeBytes: number,
  wait: boolean
): Promise<RenderResult> | void {
  let pending = pendingRenders.get(submissionId);
  if (!pending) {
    pending = {
      absolutePath,
      mtimeIso,
      sizeBytes,
      waiters: [],
      scheduled: false,
    };
    pendingRenders.set(submissionId, pending);
  } else {
    pending.absolutePath = absolutePath;
    pending.mtimeIso = mtimeIso;
    pending.sizeBytes = sizeBytes;
  }

  let promise: Promise<RenderResult> | undefined;
  if (wait) {
    promise = new Promise((resolve) => {
      pending!.waiters.push(resolve);
    });
  }

  if (!pending.scheduled) {
    pending.scheduled = true;
    renderChain = renderChain
      .then(() => runQueuedRender(submissionId))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[pptx-render] render queue error: ${msg}`);
      });
  }

  return promise;
}

async function runQueuedRender(submissionId: string): Promise<void> {
  const pending = pendingRenders.get(submissionId);
  if (!pending) return;

  pendingRenders.delete(submissionId);
  const { absolutePath, mtimeIso, sizeBytes, waiters } = pending;

  if (!fs.existsSync(absolutePath)) {
    const missing: RenderResult = {
      ok: false,
      reason: "render_unavailable",
      message: RENDER_UNAVAILABLE_MESSAGE,
    };
    for (const done of waiters) done(missing);
    return;
  }

  const dir = pptxCacheDir(submissionId);
  const cached = getUsableCache(dir, mtimeIso, sizeBytes);
  let result: RenderResult;
  if (cached && !cached.stale) {
    result = { ok: true, cache_dir: dir, manifest: cached.manifest };
  } else {
    result = await renderPptxSlidesToDisk(
      submissionId,
      absolutePath,
      mtimeIso,
      sizeBytes
    );
    if (result.ok) {
      console.log(
        `[pptx-render] cached ${result.manifest.slide_count} slides for ${path.basename(absolutePath)}`
      );
    }
  }

  for (const done of waiters) done(result);

  const rescheduled = pendingRenders.get(submissionId);
  if (rescheduled && !rescheduled.scheduled) {
    rescheduled.scheduled = true;
    renderChain = renderChain.then(() => runQueuedRender(submissionId));
  }
}

export async function renderPptxSlides(
  submissionId: string,
  absolutePath: string,
  mtimeIso: string,
  sizeBytes: number,
  options: RenderPptxOptions = {}
): Promise<RenderResult> {
  const waitIfMissing = options.wait_if_missing !== false;
  const allowStale = options.allow_stale !== false;
  const dir = pptxCacheDir(submissionId);

  const cached = getUsableCache(dir, mtimeIso, sizeBytes);
  if (cached && !cached.stale) {
    return { ok: true, cache_dir: dir, manifest: cached.manifest };
  }

  if (cached?.stale && allowStale) {
    schedulePptxRender(submissionId, absolutePath, mtimeIso, sizeBytes);
    return {
      ok: true,
      cache_dir: dir,
      manifest: cached.manifest,
      stale: true,
    };
  }

  if (waitIfMissing) {
    const waited = requestPptxRender(
      submissionId,
      absolutePath,
      mtimeIso,
      sizeBytes,
      true
    );
    if (waited) return waited;
  }

  schedulePptxRender(submissionId, absolutePath, mtimeIso, sizeBytes);
  return {
    ok: false,
    reason: "render_pending",
    message: RENDER_PENDING_MESSAGE,
  };
}

export function invalidatePptxCache(submissionId: string): void {
  pendingRenders.delete(submissionId);
  fs.rmSync(pptxCacheDir(submissionId), { recursive: true, force: true });
}

async function renderPptxSlidesToDisk(
  submissionId: string,
  absolutePath: string,
  mtimeIso: string,
  sizeBytes: number
): Promise<RenderResult> {
  const dir = pptxCacheDir(submissionId);
  const fresh = getUsableCache(dir, mtimeIso, sizeBytes);
  if (fresh && !fresh.stale) {
    return { ok: true, cache_dir: dir, manifest: fresh.manifest };
  }

  fs.mkdirSync(dir, { recursive: true });
  const tmpDir = path.join(dir, RENDERING_SUBDIR);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  let slideCount: number;
  try {
    slideCount = await runRenderScript(absolutePath, tmpDir);
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[pptx-render] COM render failed for ${path.basename(absolutePath)}: ${msg}`
    );
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

  fs.writeFileSync(manifestPath(tmpDir), JSON.stringify(manifest, null, 2));
  promoteRenderingDir(dir, tmpDir);

  return { ok: true, cache_dir: dir, manifest };
}

/** Move `.rendering/` contents into the cache dir without deleting old PNGs first. */
function promoteRenderingDir(cacheDir: string, tmpDir: string): void {
  for (const name of fs.readdirSync(tmpDir)) {
    const from = path.join(tmpDir, name);
    const to = path.join(cacheDir, name);
    if (name.endsWith(".png")) {
      fs.rmSync(to, { force: true });
    }
    fs.renameSync(from, to);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Drop slide PNGs from a previous version that had more slides.
  const manifest = readManifest(cacheDir);
  if (!manifest) return;
  for (const name of fs.readdirSync(cacheDir)) {
    const m = /^slide-(\d+)\.png$/.exec(name);
    if (!m) continue;
    if (Number(m[1]) > manifest.slide_count) {
      fs.rmSync(path.join(cacheDir, name), { force: true });
    }
  }
}

async function readTitles(
  absolutePath: string,
  slideCount: number
): Promise<string[]> {
  try {
    const buffer = fs.readFileSync(absolutePath);
    const extracted = await extractPptxSlideTitles(buffer);
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
