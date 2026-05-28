<script lang="ts">
  import SelectionBar from "../components/SelectionBar.svelte";
  import StudentResponseGrid from "../components/StudentResponseGrid.svelte";
  import MetricsPanel from "../components/MetricsPanel.svelte";
  import {
    fetchAssignmentResponses,
    fetchStructure,
    subscribeToEvents,
    type DraftElsewhere,
    type StudentResponse,
    type SubmissionKind,
    type Summary,
    type Heading,
    type AppEvent,
  } from "$lib/api";
  import { activityState, now } from "$lib/metrics.svelte";
  import { onMount } from "svelte";
  import {
    INSPECT_EVENT,
    type InspectEventDetail,
  } from "$lib/inspectClickRouter";
  import {
    closeInspector as closeInspectorState,
    inspectorOpen,
  } from "$lib/inspectorOpen.svelte";
  import { syncMonitorGrid } from "$lib/monitorContext.svelte";

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
  let headingsLoading = $state(false);

  // Reset headings when the assignment changes so the Question dropdown and
  // any downstream scroll targeting never points at a stale structure list.
  let prevAssignment: string | undefined = undefined;
  $effect(() => {
    const a = selectedAssignment;
    if (prevAssignment !== undefined && a !== prevAssignment) {
      headings = [];
      selectedHeading = "";
    }
    prevAssignment = a;
  });

  /** Bumped every time the user-selected (class, assignment, kind) changes, so
   *  late-arriving fetches can be discarded if they're no longer relevant. */
  let fetchSeq = 0;

  function commitResponses(next: StudentResponse[]) {
    responses = next;
    syncMonitorGrid(selectedClass, next);
  }

  async function loadResponses(opts: { keepSelection?: boolean } = {}) {
    if (!selectedClass || !selectedAssignment) {
      commitResponses([]);
      headings = [];
      if (!opts.keepSelection) {
        selectedSubmissionId = null;
        closeInspectorState();
      }
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
      commitResponses(list);
      if (
        selectedSubmissionId &&
        !list.some((r) => r.submission_id === selectedSubmissionId)
      ) {
        selectedSubmissionId = null;
      }
      if (
        inspectorOpen.submission_id &&
        !list.some((r) => r.submission_id === inspectorOpen.submission_id)
      ) {
        closeInspectorState();
      }
    } catch (e) {
      if (ticket !== fetchSeq) return;
      error = e instanceof Error ? e.message : "Failed to load responses";
    } finally {
      if (ticket === fetchSeq) loading = false;
    }
  }

  async function loadHeadings() {
    if (headingsLoading) return;
    headingsLoading = true;
    // Prefer .pptx (slide titles are reliably present from layout
    // placeholders) over .docx (heading styles often aren't applied).
    // Skip roster placeholders — they have no real submission_id.
    const representative =
      responses.find((r) => r.extension === ".pptx" && r.submission_id) ??
      responses.find((r) => r.extension === ".docx" && r.submission_id);
    if (!representative) return;
    const ticket = fetchSeq;
    try {
      const list = await fetchStructure(representative.submission_id);
      if (ticket !== fetchSeq) return;
      headings = list;
    } catch {
      // headings are best-effort; ignore failures
    } finally {
      if (ticket === fetchSeq) headingsLoading = false;
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
        commitResponses(next);
      } else {
        commitResponses(
          [...responses, updated].sort((a, b) =>
            a.student.localeCompare(b.student)
          )
        );
      }
    } catch {
      // ignore — next full reload will reconcile
    }
  }

  function handleEvent(event: AppEvent) {
    if (event.watch_root_label !== selectedClass) return;
    if (event.assignment !== selectedAssignment) return;
    if (event.type === "submission-changed") {
      if (selectedKind && event.kind !== selectedKind) return;
      void refreshOneByStudent(event.student);
      return;
    }
    if (event.type === "submission-deleted") {
      // Match by id — the row was uniquely tracking this file. If it was
      // selected, also clear selection so the metrics panel falls back to
      // the class summary instead of pointing at a vanished row.
      const idx = responses.findIndex(
        (r) => r.submission_id === event.id
      );
      if (idx < 0) return;
      if (selectedSubmissionId === event.id) selectedSubmissionId = null;
      if (inspectorOpen.submission_id === event.id) closeInspectorState();
      const next = responses.slice();
      next.splice(idx, 1);
      commitResponses(next);
    }
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
    if (responses.length > 0 && headings.length === 0 && !headingsLoading) {
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
    let submittedCount = 0;
    let notSubmittedCount = 0;
    let latest: string | null = null;
    for (const r of responses) {
      // Roster placeholders have no submission, no activity, no words.
      if (r.excerpt_status === "not_submitted") {
        notSubmittedCount++;
        continue;
      }
      submittedCount++;
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
      submitted_count: submittedCount,
      not_submitted_count: notSubmittedCount,
      live_count: live,
      recent_count: recent,
      avg_words: wordRows > 0 ? Math.round(words / wordRows) : null,
      last_activity_iso: latest,
    };
  });

  // Sync right-rail selection when a card opens the inspector.
  onMount(() => {
    const onInspect = (e: Event) => {
      const { submission_id } = (e as CustomEvent<InspectEventDetail>).detail;
      selectedSubmissionId = submission_id;
    };
    window.addEventListener(INSPECT_EVENT, onInspect);
    return () => window.removeEventListener(INSPECT_EVENT, onInspect);
  });

  /** Switch view to the student's draft/turned-in copy in the opposite kind.
   *  We set the submission id first so the existing post-load reconciler
   *  (in `loadResponses`) keeps the selection iff that id shows up in the
   *  freshly-fetched list. */
  function handleJumpToDraft(draft: DraftElsewhere) {
    selectedSubmissionId = draft.submission_id;
    selectedKind = draft.kind;
    if (draft.assignment !== selectedAssignment) {
      selectedAssignment = draft.assignment;
    }
  }

  const emptyMessage = $derived(
    !selectedClass
      ? "Pick a class to begin."
      : !selectedAssignment
        ? "Pick an assignment to see student responses."
        : "No matching student responses for this filter."
  );

  /** Assignments for the currently selected class only (derived here so it
   *  stays in sync with `selectedClass` state owned by this view). */
  const assignmentOptions = $derived.by(() => {
    const cls = selectedClass;
    if (!cls) return [];
    const names = new Set<string>();
    const ordered: string[] = [];
    for (const row of summary?.assignments ?? []) {
      if (row.watch_root_label !== cls) continue;
      if (names.has(row.assignment)) continue;
      names.add(row.assignment);
      ordered.push(row.assignment);
    }
    return ordered;
  });

  function handleClassChange(next: string) {
    if (next === selectedClass) return;
    selectedClass = next;
    selectedAssignment = "";
    selectedHeading = "";
    closeInspectorState();
  }
</script>

{#key selectedClass}
  <SelectionBar
    {summary}
    {headings}
    {selectedClass}
    {assignmentOptions}
    onClassChange={handleClassChange}
    bind:selectedAssignment
    bind:selectedHeading
    bind:selectedKind
    bind:studentSearch
  />
{/key}

{#if error}
  <div class="banner error">{error}</div>
{/if}

<div class="monitor">
  <section class="grid-pane">
    <StudentResponseGrid
      responses={filteredResponses}
      selectedId={selectedSubmissionId ?? inspectorOpen.submission_id}
      onJumpToDraft={handleJumpToDraft}
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
