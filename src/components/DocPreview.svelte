<script lang="ts">
  import { untrack } from "svelte";
  import {
    fetchPreview,
    fileUrl,
    openInApp,
    formatDate,
    type Submission,
    type PreviewResponse,
  } from "$lib/api";

  interface Props {
    submission: Submission | null;
  }

  let { submission }: Props = $props();

  let preview = $state<PreviewResponse | null>(null);
  let initialLoading = $state(false);
  let silentReloading = $state(false);
  let error = $state<string | null>(null);
  let justUpdated = $state(false);

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
      <button type="button" onclick={handleOpen}>Open in Word</button>
      <button type="button" onclick={manualRefresh}>Refresh</button>
    </div>
  </div>

  {#if initialLoading}
    <p class="muted">Loading preview…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if preview?.type === "html"}
    <div class="preview-html">{@html preview.html}</div>
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
  {:else if preview?.type === "unsupported" || preview?.type === "error"}
    <p class="muted">{preview.message}</p>
    <button type="button" class="primary" onclick={handleOpen}>Open in Word</button>
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
</style>
