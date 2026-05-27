<script lang="ts">
  import DocPreview from "./DocPreview.svelte";
  import MetricRow from "./MetricRow.svelte";
  import ActivityIndicator from "./ActivityIndicator.svelte";
  import {
    formatDate,
    formatSize,
    type StudentResponse,
    type Submission,
  } from "$lib/api";
  import { formatRelativeTime, now } from "$lib/metrics.svelte";

  interface Props {
    response: StudentResponse | null;
    /** The class label (watch_root_label) of the assignment being inspected.
     *  Combined with the StudentResponse fields, it lets us synthesise a
     *  `Submission`-shaped object so we can reuse `DocPreview` verbatim. */
    watchRootLabel: string;
    onClose: () => void;
  }

  let { response, watchRootLabel, onClose }: Props = $props();

  let closeBtn: HTMLButtonElement | null = $state(null);

  // Synthesise the shape DocPreview wants. `relative_path` / `absolute_path`
  // aren't read by the preview component, but the type expects them, so stub.
  const submission = $derived<Submission | null>(
    response
      ? {
          id: response.submission_id,
          watch_root_label: watchRootLabel,
          kind: response.kind,
          student: response.student,
          assignment: response.assignment,
          filename: response.filename,
          relative_path: "",
          absolute_path: "",
          extension: response.extension,
          size_bytes: response.size_bytes,
          first_seen_at: response.first_seen_at,
          last_modified_at: response.last_modified_at,
          status: response.status,
        }
      : null
  );

  // While the modal is open: lock body scroll, bind Esc, move focus to the
  // close button, restore focus on unmount. Re-runs only on open/close (the
  // response identity flipping null↔not-null).
  $effect(() => {
    if (!response) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);

    queueMicrotask(() => closeBtn?.focus());

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  });

  function handleBackdropClick(e: MouseEvent) {
    // Only the backdrop itself (not bubbled clicks from inside the dialog).
    if (e.target === e.currentTarget) onClose();
  }
</script>

{#if response && submission}
  <!-- Backdrop is a non-interactive scrim; clicks bubble to a real <button>
       inside the dialog for the explicit close affordance. The keyboard
       handler lives on window via $effect, so screen readers get Esc support
       without us pinning a tabindex onto the backdrop. -->
  <div
    class="backdrop"
    onclick={handleBackdropClick}
    role="presentation"
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inspector-title"
    >
      <header class="modal-head">
        <div class="title-block">
          <h2 id="inspector-title">
            {response.student}
            <span class="kind-badge kind-{response.kind}">
              {response.kind === "working" ? "DRAFT" : "TURNED IN"}
            </span>
          </h2>
          <p class="meta muted">
            {response.assignment} · {watchRootLabel}
          </p>
        </div>
        <button
          type="button"
          class="close"
          aria-label="Close inspector"
          bind:this={closeBtn}
          onclick={onClose}
        >
          ×
        </button>
      </header>

      <div class="body">
        <section class="preview">
          <DocPreview {submission} />
        </section>

        <aside class="metrics">
          <div class="metrics-head">
            <ActivityIndicator
              lastModifiedAt={response.last_modified_at}
              showLabel
            />
          </div>

          <section>
            <h4>Now</h4>
            <MetricRow
              label="Words written"
              value={response.word_count?.toLocaleString() ?? "—"}
            />
            <MetricRow
              label="Time since edit"
              value={formatRelativeTime(response.last_modified_at, now.value)}
            />
            <MetricRow
              label="File size"
              value={formatSize(response.size_bytes)}
            />
            <MetricRow label="Kind">
              {#snippet children()}
                <span class="kind-badge kind-{response.kind}">
                  {response.kind === "working" ? "DRAFT" : "TURNED IN"}
                </span>
              {/snippet}
            </MetricRow>
            <MetricRow
              label="First seen"
              value={formatDate(response.first_seen_at)}
            />
            <MetricRow label="Status" value={response.status} />
          </section>

          <section>
            <h4>Coming soon</h4>
            <MetricRow label="AI feedback" placeholder value="Not available yet" />
            <MetricRow
              label="Copy-paste risk"
              placeholder
              value="Not available yet"
            />
            <MetricRow label="Grade band" placeholder value="Not available yet" />
            <MetricRow
              label="vs class average"
              placeholder
              value="Not available yet"
            />
          </section>
        </aside>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    z-index: 100;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 100%;
    max-width: min(1100px, 95vw);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .title-block h2 {
    margin: 0 0 0.25rem;
    font-size: 1.25rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .meta {
    margin: 0;
    font-size: 0.85rem;
  }

  .muted {
    color: var(--muted);
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
    background: var(--warn-bg);
    color: var(--warn);
    border-color: rgba(251, 191, 36, 0.4);
  }

  .close {
    background: transparent;
    border: 1px solid transparent;
    color: var(--muted);
    font-size: 1.5rem;
    line-height: 1;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close:hover {
    color: var(--text);
    border-color: var(--border);
    background: var(--surface2);
  }

  .body {
    display: grid;
    grid-template-columns: 1fr minmax(220px, 280px);
    gap: 1.25rem;
    padding: 1rem 1.25rem 1.25rem;
    overflow: auto;
    flex: 1;
    min-height: 0;
  }

  @media (max-width: 800px) {
    .body {
      grid-template-columns: 1fr;
    }
  }

  .preview {
    min-width: 0;
  }

  /* Constrain the embedded preview-html block so it scrolls inside the
     modal body rather than blowing past it. Overrides the app.css default
     calc(100vh - 12rem) which was sized for Browse mode. */
  .preview :global(.preview-html) {
    max-height: calc(90vh - 14rem);
  }

  .metrics {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  .metrics-head {
    display: flex;
    justify-content: flex-end;
  }

  .metrics section {
    display: flex;
    flex-direction: column;
  }

  .metrics section h4 {
    margin: 0 0 0.4rem;
    font-size: 0.7rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
</style>
