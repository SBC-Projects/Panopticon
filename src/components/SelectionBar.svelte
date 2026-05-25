<script lang="ts">
  import type { Summary, SubmissionKind, Heading } from "$lib/api";

  interface Props {
    summary: Summary | null;
    selectedClass: string;
    selectedAssignment: string;
    selectedHeading: string;
    selectedKind: "" | SubmissionKind;
    headings: Heading[];
    studentSearch: string;
  }

  let {
    summary,
    selectedClass = $bindable(),
    selectedAssignment = $bindable(),
    selectedHeading = $bindable(),
    selectedKind = $bindable(),
    headings,
    studentSearch = $bindable(),
  }: Props = $props();

  const classOptions = $derived(summary?.by_class.map((c) => c.label) ?? []);

  const assignmentOptions = $derived(
    (summary?.assignments ?? [])
      .filter((a) => !selectedClass || a.watch_root_label === selectedClass)
      .map((a) => a.assignment)
      .filter((a, i, arr) => arr.indexOf(a) === i)
      .sort()
  );

  function onClassChange() {
    if (
      selectedAssignment &&
      !assignmentOptions.includes(selectedAssignment)
    ) {
      selectedAssignment = "";
    }
  }
</script>

<div class="selection-bar">
  <label class="field">
    <span class="label">Class</span>
    <select bind:value={selectedClass} onchange={onClassChange}>
      <option value="">— Select class —</option>
      {#each classOptions as cls}
        <option value={cls}>{cls}</option>
      {/each}
    </select>
  </label>

  <label class="field">
    <span class="label">Assignment</span>
    <select bind:value={selectedAssignment} disabled={!selectedClass}>
      <option value="">— Select assignment —</option>
      {#each assignmentOptions as a}
        <option value={a}>{a}</option>
      {/each}
    </select>
  </label>

  <label class="field">
    <span class="label">Question</span>
    <select bind:value={selectedHeading} disabled={headings.length === 0}>
      <option value="">— Whole document —</option>
      {#each headings as h}
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
    align-items: flex-end;
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

  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
