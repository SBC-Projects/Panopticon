import { Router } from "express";
import open from "open";
import path from "node:path";
import type { SubmissionStore } from "./db.js";
import { buildPreview, getFileStream } from "./preview.js";
import { scanWatchRoots } from "./scanner.js";
import type { AppConfig } from "./types.js";
import type { EventBus } from "./events.js";

export function createRouter(
  store: SubmissionStore,
  config: AppConfig,
  events: EventBus
): Router {
  const router = Router();

  router.get("/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: ready\ndata: {}\n\n`);

    const unsubscribe = events.on((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const keepalive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 25_000);

    req.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/config", (_req, res) => {
    res.json({
      watch_roots: config.watch_roots.map((r) => ({
        label: r.label,
        path: r.path,
        kind: r.kind,
      })),
    });
  });

  router.get("/summary", (_req, res) => {
    res.json(store.getSummary());
  });

  router.get("/submissions", (req, res) => {
    const list = store.list({
      status: req.query.status as string | undefined,
      assignment: req.query.assignment as string | undefined,
      watch_root_label: req.query.class as string | undefined,
      student: req.query.student as string | undefined,
      kind: req.query.kind as string | undefined,
    });
    res.json(list);
  });

  router.get("/submissions/:id", (req, res) => {
    const row = store.getById(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  });

  router.post("/submissions/mark-seen", (_req, res) => {
    const count = store.markAllSeen();
    res.json({ marked: count });
  });

  router.post("/submissions/:id/mark-seen", (req, res) => {
    store.markSeen(req.params.id);
    res.json({ ok: true });
  });

  router.post("/scan", (_req, res) => {
    const result = scanWatchRoots(config.watch_roots, store);
    res.json(result);
  });

  router.get("/preview/:id", async (req, res) => {
    const row = store.getById(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const preview = await buildPreview(row);
    res.json({ ...preview, last_modified_at: row.last_modified_at });
  });

  router.get("/file/:id", (req, res) => {
    const row = store.getById(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const stream = getFileStream(row);
    if (!stream) {
      res.status(404).json({ error: "File not on disk" });
      return;
    }

    const ext = row.extension || path.extname(row.filename).toLowerCase();
    const mime =
      ext === ".pdf"
        ? "application/pdf"
        : ext.match(/\.(png|jpe?g|gif|webp)$/)
          ? `image/${ext.slice(1) === "jpg" ? "jpeg" : ext.slice(1)}`
          : "application/octet-stream";

    res.setHeader("Content-Type", mime);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(row.filename)}"`
    );
    stream.pipe(res);
  });

  router.post("/open/:id", async (req, res) => {
    const row = store.getById(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      await open(row.absolute_path);
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to open";
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
