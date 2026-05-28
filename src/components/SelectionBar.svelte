<script lang="ts">
  import type { Summary, SubmissionKind, Heading } from "$lib/api";

  interface Props {
    summary: Summary | null;
    selectedClass: string;
    assignmentOptions: string[];
    onClassChange: (cls: string) => void;
    selectedAssignment: string;
    selectedHeading: string;
    selectedKind: "" | SubmissionKind;
    headings: Heading[];
    studentSearch: string;
  }

  let {
    summary,
    selectedClass,
    assignmentOptions,
    onClassChange,
    selectedAssignment = $bindable(),
    selectedHeading = $bindable(),
    selectedKind = $bindable(),
    headings,
    studentSearch = $bindable(),
  }: Props = $props();

  const classOptions = $derived(summary?.by_class.map((c) => c.label) ?? []);

  const ASSIGNMENT_COLLAPSED_COUNT = 6;
  let assignmentsExpanded = $state(false);

  function selectClass(cls: string) {
    if (cls === selectedClass) return;
    assignmentsExpanded = false;
    onClassChange(cls);
  }

  function selectAssignment(assignment: string) {
    if (!selectedClass) return;
    selectedAssignment = assignment;
  }

  const visibleAssignmentOptions = $derived(
    assignmentsExpanded
      ? assignmentOptions
      : assignmentOptions.slice(0, ASSIGNMENT_COLLAPSED_COUNT)
  );
</script>

<div class="selection-bar">
  <div class="field pills">
    <span class="label">Class</span>
    <div class="pill-row" role="group" aria-label="Class">
      {#each classOptions as cls (cls)}
        <button
          type="button"
          class="pill"
          class:active={cls === selectedClass}
          aria-pressed={cls === selectedClass}
          onclick={() => selectClass(cls)}
        >
          {cls}
        </button>
      {/each}
    </div>
  </div>

  <div class="field pills">
    <span class="label">Assignment</span>
    <div
      class="pill-row"
      role="group"
      aria-label="Assignment"
      aria-disabled={!selectedClass}
    >
      {#if !selectedClass}
        <span class="pill-hint muted">Pick a class first.</span>
      {:else if assignmentOptions.length === 0}
        <span class="pill-hint muted">No assignments found.</span>
      {:else}
        {#each visibleAssignmentOptions as a (a)}
          <button
            type="button"
            class="pill"
            class:active={a === selectedAssignment}
            aria-pressed={a === selectedAssignment}
            onclick={() => selectAssignment(a)}
          >
            {a}
          </button>
        {/each}

        {#if assignmentOptions.length > ASSIGNMENT_COLLAPSED_COUNT}
          <button
            type="button"
            class="pill pill-toggle"
            aria-expanded={assignmentsExpanded}
            onclick={() => (assignmentsExpanded = !assignmentsExpanded)}
          >
            {assignmentsExpanded
              ? "Show fewer"
              : `Show ${assignmentOptions.length - visibleAssignmentOptions.length} more`}
          </button>
        {/if}
      {/if}
    </div>
  </div>

  <label class="field">
    <span class="label">Question</span>
    <select bind:value={selectedHeading} disabled={headings.length === 0}>
      <option value="">— Whole document —</option>
      {#each headings as h (h.id)}
        <option value={h.id}>
          {"".padStart((h.level - 1) * 2, "·")}
          {h.text}
        </option>
      {/each}
    </select>
  </label>

  <label class="field">
    <span class="label">Kind</span>
    <select bind:value={selectedKind}>
      <option value="working">Working (drafts)</option>
      <option value="submitted">Submitted (turned in)</option>
      <option value="">Both</option>
    </select>
  </label>

  <label class="field grow">
    <span class="label">Search</span>
    <input
      type="search"
      placeholder="Student name…"
      bind:value={studentSearch}
    />
  </label>
</div>

<style>
  .selection-bar {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: flex-start;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 12rem;
  }

  .field.pills {
    min-width: 18rem;
    flex: 2;
  }

  .field.grow {
    flex: 1;
    min-width: 14rem;
  }

  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    font-weight: 600;
  }

  .pill-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    align-items: center;
    min-height: 2.2rem;
  }

  .pill {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 0.32rem 0.6rem;
    border-radius: 999px;
    font-size: 0.85rem;
    line-height: 1.2;
    max-width: 100%;
  }

  .pill:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .pill.active {
    background: var(--surface2);
    border-color: var(--border);
    color: var(--text);
  }

  .pill-toggle {
    border-style: dashed;
  }

  .pill-hint {
    font-size: 0.85rem;
    padding: 0.3rem 0;
  }

  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
