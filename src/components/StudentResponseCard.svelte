<script lang="ts">
  import ActivityIndicator from "./ActivityIndicator.svelte";
  import { formatRelativeTime, now } from "$lib/metrics.svelte";
  import type { StudentResponse } from "$lib/api";

  interface Props {
    response: StudentResponse;
    selected: boolean;
    onSelect: (submissionId: string) => void;
  }

  let { response, selected, onSelect }: Props = $props();

  const relativeTime = $derived(
    formatRelativeTime(response.last_modified_at, now.value)
  );
  const wordCountLabel = $derived(
    response.word_count == null
      ? response.extension.replace(".", "").toUpperCase() || "file"
      : `${response.word_count.toLocaleString()} words`
  );
  const hasExcerpt = $derived(response.excerpt && response.excerpt.length > 0);
</script>

<button
  type="button"
  class="card"
  class:selected
  class:is-new={response.status === "new"}
  onclick={() => onSelect(response.submission_id)}
>
  <header class="card-head">
    <span class="name">{response.student}</span>
    <ActivityIndicator lastModifiedAt={response.last_modified_at} showLabel />
  </header>
  <div class="meta">
    <span class="kind kind-{response.kind}">
      {response.kind === "working" ? "DRAFT" : "TURNED IN"}
    </span>
    {#if response.status === "new"}
      <span class="badge-new">NEW</span>
    {/if}
    <span class="dot-sep">·</span>
    <span class="words">{wordCountLabel}</span>
  </div>
  <p class="excerpt" class:placeholder={!hasExcerpt}>
    {#if hasExcerpt}
      {response.excerpt}
    {:else}
      No preview text yet
    {/if}
  </p>
  <footer class="card-foot">
    <span class="filename" title={response.filename}>{response.filename}</span>
    <span class="time">{relativeTime}</span>
  </footer>
</button>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.75rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    text-align: left;
    color: inherit;
    cursor: pointer;
    transition:
      border-color 0.15s,
      transform 0.08s,
      background 0.15s;
    min-height: 10rem;
  }

  .card:hover {
    background: var(--surface2);
    border-color: var(--accent);
  }

  .card.selected {
    border-color: var(--accent);
    border-left: 3px solid var(--accent);
    background: var(--surface2);
  }

  .card.is-new {
    box-shadow: 0 0 0 1px var(--new-bg);
  }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .name {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: var(--muted);
    flex-wrap: wrap;
  }

  .kind {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.4rem;
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

  .badge-new {
    background: var(--new-bg);
    color: var(--new);
    font-size: 0.6rem;
    font-weight: 700;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
  }

  .dot-sep {
    opacity: 0.5;
  }

  .excerpt {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    flex: 1;
  }

  .excerpt.placeholder {
    color: var(--muted);
    font-style: italic;
  }

  .card-foot {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.7rem;
    color: var(--muted);
  }

  .filename {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 60%;
  }
</style>
