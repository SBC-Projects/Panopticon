<script lang="ts">
  import { untrack } from "svelte";
  import {
    fetchPreview,
    fileUrl,
    openInApp,
    formatDate,
    slideUrl,
    type Submission,
    type PreviewResponse,
  } from "$lib/api";

  interface Props {
    submission: Submission | null;
    /** Optional: scroll the preview to a heading id (set on h1–h3 via data-heading-id). */
    scrollToHeading?: string | null;
  }

  let { submission, scrollToHeading = null }: Props = $props();

  let previewHtmlEl: HTMLDivElement | null = $state(null);

  let preview = $state<PreviewResponse | null>(null);
  let initialLoading = $state(false);
  let silentReloading = $state(false);
  let error = $state<string | null>(null);
  let justUpdated = $state(false);

  /** Per-slide PNG load state (after the preview JSON returns). */
  let slideImagesLoaded = $state<Record<number, boolean>>({});

  /** Track what we currently have loaded so we don't refetch identical content. */
  let loadedId = $state<string | null>(null);
  let loadedMtime = $state<string | null>(null);
  let updatedTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: { id: string; mtime: string } | null = null;

  $effect(() => {
    const current = submission;
    if (!current) {
      untrack(() => {
        preview = null;
        loadedId = null;
        loadedMtime = null;
        error = null;
      });
      return;
    }

    const idChanged = current.id !== loadedId;
    const mtimeChanged = current.last_modified_at !== loadedMtime;

    if (!idChanged && !mtimeChanged) return;

    void loadPreview(current.id, current.last_modified_at, idChanged);
  });

  async function loadPreview(id: string, mtime: string, isInitial: boolean) {
    if (inFlight && inFlight.id === id && inFlight.mtime === mtime) return;
    inFlight = { id, mtime };

    if (isInitial) {
      initialLoading = true;
      error = null;
    } else {
      silentReloading = true;
    }

    try {
      const result = await fetchPreview(id);

      // Stale request guard: a newer fetch superseded this one.
      if (!inFlight || inFlight.id !== id || inFlight.mtime !== mtime) return;

      preview = result;
      loadedId = id;
      loadedMtime = result.last_modified_at;
      error = null;

      if (!isInitial) {
        justUpdated = true;
        if (updatedTimer) clearTimeout(updatedTimer);
        updatedTimer = setTimeout(() => (justUpdated = false), 1600);
      }
    } catch (e) {
      if (isInitial) {
        error = e instanceof Error ? e.message : "Preview failed";
        preview = null;
      }
    } finally {
      if (inFlight && inFlight.id === id && inFlight.mtime === mtime) {
        inFlight = null;
      }
      initialLoading = false;
      silentReloading = false;
    }
  }

  async function handleOpen() {
    if (!submission) return;
    try {
      await openInApp(submission.id);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not open";
    }
  }

  function manualRefresh() {
    if (!submission) return;
    loadedMtime = null;
    void loadPreview(submission.id, submission.last_modified_at, false);
  }

  $effect(() => {
    const heading = scrollToHeading;
    void preview;
    void loadedMtime;
    if (!heading || !previewHtmlEl) return;
    const target = previewHtmlEl.querySelector<HTMLElement>(
      `[data-heading-id="${CSS.escape(heading)}"]`
    );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  // Which "Open in <app>" copy to show. Driven by extension so a future
  // file type slots in without touching the markup.
  const openAppLabel = $derived.by(() => {
    const ext = submission?.extension?.toLowerCase() ?? "";
    if (ext === ".pptx") return "Open in PowerPoint";
    if (ext === ".docx") return "Open in Word";
    return "Open externally";
  });

  const isPptx = $derived(
    submission?.extension?.toLowerCase() === ".pptx"
  );

  const loadingMessage = $derived(
    isPptx
      ? "Rendering slides from PowerPoint…"
      : "Loading preview…"
  );

  function markSlideImageLoaded(index: number) {
    if (slideImagesLoaded[index]) return;
    slideImagesLoaded = { ...slideImagesLoaded, [index]: true };
  }

  $effect(() => {
    if (preview?.type !== "slides") {
      slideImagesLoaded = {};
      return;
    }
    slideImagesLoaded = {};
    void preview.slides.length;
  });
</script>

{#if !submission}
  <div class="preview-empty">
    <p>Select a submission to preview</p>
  </div>
{:else}
  <div class="preview-header">
    <div>
      <h2>
        {submission.student}
        <span class="kind-badge kind-{submission.kind}">
          {submission.kind === "working" ? "DRAFT" : "TURNED IN"}
        </span>
        {#if silentReloading}
          <span class="status-pill reloading">syncing…</span>
        {:else if justUpdated}
          <span class="status-pill updated">updated</span>
        {/if}
      </h2>
      <p class="meta">{submission.assignment} · {submission.filename}</p>
      <p class="meta muted">
        {submission.watch_root_label} · modified {formatDate(submission.last_modified_at)}
      </p>
    </div>
    <div class="actions">
      <button type="button" onclick={handleOpen}>{openAppLabel}</button>
      <button type="button" onclick={manualRefresh}>Refresh</button>
    </div>
  </div>

  {#if initialLoading}
    <div class="preview-loading" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <p>{loadingMessage}</p>
    </div>
  {:else if error}
    <p class="error">{error}</p>
  {:else if preview?.type === "html"}
    <div class="preview-html" bind:this={previewHtmlEl}>
      {@html preview.html}
    </div>
  {:else if preview?.type === "slides"}
    <div class="preview-slides-wrap">
      {#if silentReloading}
        <div class="slides-sync-banner" role="status" aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          <span>Updating slides…</span>
        </div>
      {/if}
      <div class="preview-slides" bind:this={previewHtmlEl}>
        {#each preview.slides as slide (slide.index)}
          <figure class="slide" data-heading-id={`slide-${slide.index}`}>
            <div class="slide-media">
              {#if !slideImagesLoaded[slide.index]}
                <div class="slide-media-loading" aria-hidden="true">
                  <span class="spinner"></span>
                </div>
              {/if}
              <img
                class="slide-image"
                class:loaded={slideImagesLoaded[slide.index]}
                src={slideUrl(slide.image_path, loadedMtime ?? "")}
                alt={`Slide ${slide.index}: ${slide.title}`}
                loading="eager"
                onload={() => markSlideImageLoaded(slide.index)}
                onerror={() => markSlideImageLoaded(slide.index)}
              />
            </div>
            <figcaption class="slide-caption">
              Slide {slide.index} — {slide.title}
            </figcaption>
          </figure>
        {/each}
      </div>
    </div>
  {:else if preview?.type === "binary"}
    {#if preview.mime.startsWith("image/")}
      <img
        class="preview-image"
        src={`${fileUrl(submission.id)}?v=${encodeURIComponent(loadedMtime ?? "")}`}
        alt={submission.filename}
      />
    {:else}
      <iframe
        class="preview-frame"
        title={submission.filename}
        src={`${fileUrl(submission.id)}?v=${encodeURIComponent(loadedMtime ?? "")}`}
      ></iframe>
    {/if}
  {:else if preview?.type === "empty"}
    <div class="empty-state" class:not-synced={preview.reason === "not_downloaded"}>
      <p>{preview.message}</p>
      <div class="empty-actions">
        <button type="button" onclick={manualRefresh}>Re-check file</button>
        <button type="button" class="primary" onclick={handleOpen}>{openAppLabel}</button>
      </div>
    </div>
  {:else if preview?.type === "unsupported" || preview?.type === "error"}
    <p class="muted">{preview.message}</p>
    <button type="button" class="primary" onclick={handleOpen}>{openAppLabel}</button>
  {/if}
{/if}

<style>
  .preview-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
  }

  .preview-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .preview-header h2 {
    margin: 0 0 0.25rem;
    font-size: 1.25rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .kind-badge {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    border: 1px solid transparent;
  }

  .kind-submitted {
    background: rgba(61, 139, 253, 0.12);
    color: var(--accent);
    border-color: rgba(61, 139, 253, 0.4);
  }

  .kind-working {
    background: rgba(251, 191, 36, 0.12);
    color: #fbbf24;
    border-color: rgba(251, 191, 36, 0.4);
  }

  .status-pill {
    font-size: 0.65rem;
    font-weight: 600;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    letter-spacing: 0.02em;
  }

  .status-pill.reloading {
    background: var(--surface2);
    color: var(--muted);
  }

  .status-pill.updated {
    background: var(--new-bg);
    color: var(--new);
    animation: fade-out 1.6s ease-out forwards;
  }

  @keyframes fade-out {
    0% {
      opacity: 1;
    }
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  .meta {
    margin: 0.15rem 0;
    font-size: 0.9rem;
  }

  .muted {
    color: var(--muted);
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .error {
    color: #f87171;
  }

  .empty-state {
    border: 1px dashed var(--border);
    border-radius: 10px;
    padding: 1rem 1.1rem;
    color: var(--muted);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .empty-state.not-synced {
    border-color: var(--warn);
    color: var(--text);
  }

  .empty-state p {
    margin: 0;
    line-height: 1.45;
  }

  .empty-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .preview-loading {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem 0.5rem;
    color: var(--muted);
  }

  .preview-loading p {
    margin: 0;
  }

  .spinner {
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .preview-slides-wrap {
    position: relative;
    min-height: 12rem;
  }

  .slides-sync-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.75rem;
    margin-bottom: 0.5rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .preview-slides {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    max-height: calc(100vh - 12rem);
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .slide {
    margin: 0;
    flex: 0 0 auto;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    scroll-margin: 0.5rem 0;
  }

  .slide-media {
    position: relative;
    flex: 0 0 auto;
    background: #fff;
    min-height: 10rem;
  }

  .slide-media-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface2);
  }

  .slide-image {
    display: block;
    width: 100%;
    height: auto;
    opacity: 0;
    transition: opacity 0.2s ease-out;
  }

  .slide-image.loaded {
    opacity: 1;
  }

  .slide-caption {
    flex: 0 0 auto;
    padding: 0.45rem 0.85rem;
    font-size: 0.8rem;
    color: var(--muted);
    border-top: 1px solid var(--border);
    background: var(--surface2);
  }
</style>
