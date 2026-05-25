<script lang="ts">
  import SelectionBar from "../components/SelectionBar.svelte";
  import StudentResponseGrid from "../components/StudentResponseGrid.svelte";
  import MetricsPanel from "../components/MetricsPanel.svelte";
  import {
    fetchAssignmentResponses,
    fetchStructure,
    subscribeToEvents,
    type StudentResponse,
    type SubmissionKind,
    type Summary,
    type Heading,
    type AppEvent,
  } from "$lib/api";
  import { activityState, now } from "$lib/metrics.svelte";

  interface Props {
    summary: Summary | null;
  }

  let { summary }: Props = $props();

  let selectedClass = $state("");
  let selectedAssignment = $state("");
  let selectedHeading = $state("");
  let selectedKind = $state<"" | SubmissionKind>("working");
  let studentSearch = $state("");

  let responses = $state<StudentResponse[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selectedSubmissionId = $state<string | null>(null);

  let headings = $state<Heading[]>([]);

  /** Bumped every time the user-selected (class, assignment, kind) changes, so
   *  late-arriving fetches can be discarded if they're no longer relevant. */
  let fetchSeq = 0;

  async function loadResponses(opts: { keepSelection?: boolean } = {}) {
    if (!selectedClass || !selectedAssignment) {
      responses = [];
      headings = [];
      if (!opts.keepSelection) selectedSubmissionId = null;
      return;
    }

    const ticket = ++fetchSeq;
    loading = true;
    error = null;
    try {
      const list = await fetchAssignmentResponses(
        selectedClass,
        selectedAssignment,
        selectedKind || undefined
      );
      if (ticket !== fetchSeq) return;
      responses = list;
      if (
        selectedSubmissionId &&
        !list.some((r) => r.submission_id === selectedSubmissionId)
      ) {
        selectedSubmissionId = null;
      }
    } catch (e) {
      if (ticket !== fetchSeq) return;
      error = e instanceof Error ? e.message : "Failed to load responses";
    } finally {
      if (ticket === fetchSeq) loading = false;
    }
  }

  async function loadHeadings() {
    headings = [];
    selectedHeading = "";
    const representative = responses.find((r) => r.extension === ".docx");
    if (!representative) return;
    const ticket = fetchSeq;
    try {
      const list = await fetchStructure(representative.submission_id);
      if (ticket !== fetchSeq) return;
      headings = list;
    } catch {
      // headings are best-effort; ignore failures
    }
  }

  /** Refetch a single student's row when an SSE event tells us their file changed. */
  async function refreshOneByStudent(student: string) {
    if (!selectedClass || !selectedAssignment) return;
    const ticket = fetchSeq;
    try {
      const list = await fetchAssignmentResponses(
        selectedClass,
        selectedAssignment,
        selectedKind || undefined
      );
      if (ticket !== fetchSeq) return;
      const updated = list.find((r) => r.student === student);
      if (!updated) return;
      const idx = responses.findIndex((r) => r.student === student);
      if (idx >= 0) {
        const next = responses.slice();
        next[idx] = updated;
        responses = next;
      } else {
        responses = [...responses, updated].sort((a, b) =>
          a.student.localeCompare(b.student)
        );
      }
    } catch {
      // ignore — next full reload will reconcile
    }
  }

  function handleEvent(event: AppEvent) {
    if (event.type !== "submission-changed") return;
    if (event.watch_root_label !== selectedClass) return;
    if (event.assignment !== selectedAssignment) return;
    if (selectedKind && event.kind !== selectedKind) return;
    void refreshOneByStudent(event.student);
  }

  // Refetch responses when selection changes.
  $effect(() => {
    void selectedClass;
    void selectedAssignment;
    void selectedKind;
    void loadResponses();
  });

  // When responses settle, refresh structure if needed.
  $effect(() => {
    void responses.length;
    if (responses.length > 0 && headings.length === 0) {
      void loadHeadings();
    } else if (responses.length === 0) {
      headings = [];
      selectedHeading = "";
    }
  });

  // Subscribe to live events for the lifetime of the monitor view.
  $effect(() => {
    const unsub = subscribeToEvents(handleEvent);
    return () => unsub();
  });

  const filteredResponses = $derived(
    !studentSearch.trim()
      ? responses
      : responses.filter((r) =>
          r.student.toLowerCase().includes(studentSearch.trim().toLowerCase())
        )
  );

  const selectedResponse = $derived(
    selectedSubmissionId
      ? (responses.find((r) => r.submission_id === selectedSubmissionId) ??
        null)
      : null
  );

  const classSummary = $derived.by(() => {
    let live = 0;
    let recent = 0;
    let words = 0;
    let wordRows = 0;
    let latest: string | null = null;
    for (const r of responses) {
      const state = activityState(r.last_modified_at, now.value);
      if (state === "live") live++;
      else if (state === "recent") recent++;
      if (typeof r.word_count === "number") {
        words += r.word_count;
        wordRows++;
      }
      if (!latest || r.last_modified_at > latest) {
        latest = r.last_modified_at;
      }
    }
    return {
      student_count: responses.length,
      live_count: live,
      recent_count: recent,
      avg_words: wordRows > 0 ? Math.round(words / wordRows) : null,
      last_activity_iso: latest,
    };
  });

  function handleSelect(submissionId: string) {
    selectedSubmissionId =
      selectedSubmissionId === submissionId ? null : submissionId;
  }

  const emptyMessage = $derived(
    !selectedClass
      ? "Pick a class to begin."
      : !selectedAssignment
        ? "Pick an assignment to see student responses."
        : "No matching student responses for this filter."
  );
</script>

<SelectionBar
  {summary}
  {headings}
  bind:selectedClass
  bind:selectedAssignment
  bind:selectedHeading
  bind:selectedKind
  bind:studentSearch
/>

{#if error}
  <div class="banner error">{error}</div>
{/if}

<div class="monitor">
  <section class="grid-pane">
    <StudentResponseGrid
      responses={filteredResponses}
      selectedId={selectedSubmissionId}
      onSelect={handleSelect}
      {loading}
      empty={emptyMessage}
    />
  </section>
  <MetricsPanel
    selected={selectedResponse}
    {classSummary}
    className={selectedClass}
    assignmentName={selectedAssignment}
  />
</div>

<style>
  .monitor {
    display: grid;
    grid-template-columns: 1fr minmax(260px, 340px);
    gap: 1rem;
    align-items: flex-start;
  }

  @media (max-width: 1000px) {
    .monitor {
      grid-template-columns: 1fr;
    }
  }

  .grid-pane {
    min-height: 60vh;
  }

  .banner {
    padding: 0.75rem 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }

  .banner.error {
    background: rgba(248, 113, 113, 0.15);
    border: 1px solid rgba(248, 113, 113, 0.4);
  }
</style>
