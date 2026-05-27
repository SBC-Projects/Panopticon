<script lang="ts">
  import ActivityIndicator from "./ActivityIndicator.svelte";
  import { formatRelativeTime, now } from "$lib/metrics.svelte";
  import type { DraftElsewhere, StudentResponse } from "$lib/api";

  interface Props {
    response: StudentResponse;
    selected: boolean;
    onJumpToDraft?: (draft: DraftElsewhere) => void;
  }

  let { response, selected, onJumpToDraft }: Props = $props();

  const isRosterPlaceholder = $derived(
    response.excerpt_status === "not_submitted"
  );

  const relativeTime = $derived(
    response.last_modified_at
      ? formatRelativeTime(response.last_modified_at, now.value)
      : ""
  );
  const wordCountLabel = $derived(
    response.word_count == null
      ? response.extension.replace(".", "").toUpperCase() || "file"
      : `${response.word_count.toLocaleString()} words`
  );
  const hasExcerpt = $derived(response.excerpt.length > 0);
  const draft = $derived(response.draft_elsewhere);
  const hasDraftPointer = $derived(draft !== null && draft !== undefined);

  // Distinct empty-state copy per failure mode so the card explains *why*
  // there's no preview instead of just rendering blank.
  //
  // Important nuance: when this row is empty AND we have a draft pointer,
  // the messaging assumes the teacher would rather see the draft than be
  // told the current view is empty.
  const emptyMessage = $derived.by(() => {
    if (hasDraftPointer && draft) {
      const wc =
        draft.word_count != null
          ? `${draft.word_count.toLocaleString()}-word `
          : "";
      const where = draft.kind === "working" ? "Working draft" : "turned-in copy";
      return `Empty here. Student has a ${wc}${where} — click below to jump to it.`;
    }
    switch (response.excerpt_status) {
      case "not_downloaded":
        return "OneDrive hasn't downloaded this file to your machine yet (0 bytes locally). Right-click → Always keep on this device, or wait for sync.";
      case "empty_body":
        return "Local copy is empty. Either the student really hasn't typed anything in this version, or OneDrive hasn't pulled the latest SharePoint state yet.";
      case "missing":
        return "File is no longer on disk.";
      case "parse_error":
        return "Couldn't read this document. Open in Word to inspect.";
      case "unsupported_ext":
        return `Preview not available for .${response.extension.replace(".", "")} files.`;
      case "not_submitted":
        return response.kind === "submitted"
          ? "Not turned in yet."
          : "Hasn't started this assignment yet.";
      default:
        return "No preview text yet";
    }
  });

  const isProblem = $derived(
    response.excerpt_status === "not_downloaded" ||
      response.excerpt_status === "missing" ||
      response.excerpt_status === "parse_error"
  );

  function handleJump(e: Event) {
    e.stopPropagation();
    if (draft && onJumpToDraft) onJumpToDraft(draft);
  }

</script>

<!-- Opens inspector via inspectClickRouter.ts (card click; jump-btn excluded). -->
<div
  class="card"
  class:selected
  class:is-new={response.status === "new" && !isRosterPlaceholder}
  class:roster-placeholder={isRosterPlaceholder}
  data-submission-id={response.submission_id}
  data-roster-placeholder={isRosterPlaceholder ? "1" : "0"}
  role={isRosterPlaceholder ? "group" : "button"}
  tabindex={isRosterPlaceholder ? undefined : 0}
  aria-label={isRosterPlaceholder
    ? response.student
    : `Inspect ${response.student}`}
>
  <header class="card-head">
    <span class="name">{response.student}</span>
    {#if !isRosterPlaceholder}
      <ActivityIndicator
        lastModifiedAt={response.last_modified_at}
        showLabel
      />
    {/if}
  </header>
  {#if !isRosterPlaceholder}
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
  {:else}
    <div class="meta">
      <span class="kind kind-none">NO SUBMISSION</span>
      {#if hasDraftPointer && draft}
        <span class="kind kind-{draft.kind}">
          {draft.kind === "submitted" ? "TURNED IN" : "HAS DRAFT"}
        </span>
      {/if}
    </div>
  {/if}
  <p
    class="excerpt"
    class:placeholder={!hasExcerpt}
    class:problem={!hasExcerpt && isProblem && !hasDraftPointer}
    class:has-draft={!hasExcerpt && hasDraftPointer}
  >
    {#if hasExcerpt}
      {response.excerpt}
    {:else}
      {emptyMessage}
    {/if}
  </p>
  {#if !hasExcerpt && hasDraftPointer && draft}
    <div class="draft-preview">
      <p class="draft-excerpt" title={draft.excerpt}>
        {draft.excerpt || "(draft has no preview text)"}
      </p>
      {#if onJumpToDraft}
        <button type="button" class="jump-btn" onclick={handleJump}>
          View {draft.kind === "working" ? "draft" : "turned-in copy"} →
        </button>
      {/if}
    </div>
  {/if}
  {#if !isRosterPlaceholder}
    <footer class="card-foot">
      <span class="filename" title={response.filename}>{response.filename}</span>
      <span class="time">{relativeTime}</span>
    </footer>
  {/if}
</div>

<style>
  .card:not(.roster-placeholder) {
    cursor: pointer;
  }

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

  .card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .card.selected {
    border-color: var(--accent);
    border-left: 3px solid var(--accent);
    background: var(--surface2);
  }

  .card.is-new {
    box-shadow: 0 0 0 1px var(--new-bg);
  }

  .card.roster-placeholder {
    background: transparent;
    border-style: dashed;
    cursor: default;
    opacity: 0.78;
  }

  .card.roster-placeholder:hover {
    background: transparent;
    border-color: var(--border);
  }

  .card.roster-placeholder .name {
    color: var(--muted);
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

  .kind-none {
    background: transparent;
    color: var(--muted);
    border-color: var(--border);
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

  .excerpt.problem {
    color: var(--warn);
  }

  .excerpt.has-draft {
    color: var(--muted);
    font-style: italic;
    flex: none;
  }

  .draft-preview {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex: 1;
    min-height: 0;
  }

  .draft-excerpt {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .jump-btn {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
  }

  .jump-btn:hover {
    background: rgba(61, 139, 253, 0.12);
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
