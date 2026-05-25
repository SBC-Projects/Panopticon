<script lang="ts">
  import DocPreview from "./components/DocPreview.svelte";
  import AssignmentMonitor from "./views/AssignmentMonitor.svelte";
  import {
    fetchSummary,
    fetchSubmissions,
    markAllSeen,
    triggerScan,
    formatDate,
    subscribeToEvents,
    type Submission,
    type SubmissionKind,
    type Summary,
  } from "$lib/api";

  type Mode = "browse" | "monitor";
  let mode = $state<Mode>("browse");

  let summary = $state<Summary | null>(null);
  let submissions = $state<Submission[]>([]);
  let selectedId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let liveConnected = $state(false);

  let filterNewOnly = $state(false);
  let filterClass = $state("");
  let filterStudent = $state("");
  let filterAssignment = $state("");
  let filterKind = $state<"" | SubmissionKind>("");

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  async function refresh() {
    try {
      const [s, list] = await Promise.all([
        fetchSummary(),
        fetchSubmissions({
          status: filterNewOnly ? "new" : undefined,
          class: filterClass || undefined,
          student: filterStudent || undefined,
          assignment: filterAssignment || undefined,
          kind: filterKind || undefined,
        }),
      ]);
      summary = s;
      submissions = list;
      error = null;
      liveConnected = true;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load";
    } finally {
      loading = false;
    }
  }

  /** Debounced refresh so rapid SSE bursts (e.g. multiple saves) don't thrash the UI. */
  function scheduleRefresh(delayMs = 400) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, delayMs);
  }

  async function handleMarkAllSeen() {
    await markAllSeen();
    await refresh();
  }

  async function handleScan() {
    loading = true;
    await triggerScan();
    await refresh();
  }

  function selectSubmission(id: string) {
    selectedId = id;
  }

  // Initial load + react to filter changes (no polling).
  $effect(() => {
    void filterNewOnly;
    void filterClass;
    void filterStudent;
    void filterAssignment;
    void filterKind;
    refresh();
  });

  // Single live connection for the whole app lifecycle.
  $effect(() => {
    const unsubscribe = subscribeToEvents(() => {
      scheduleRefresh();
    });
    return () => {
      unsubscribe();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  });

  const assignmentOptions = $derived(
    [...new Set(submissions.map((s) => s.assignment))].sort()
  );

  const classOptions = $derived(summary?.by_class.map((c) => c.label) ?? []);

  const selected = $derived(
    selectedId ? (submissions.find((s) => s.id === selectedId) ?? null) : null
  );
</script>

<div class="layout">
  <header class="header">
    <div>
      <h1>Panopticon</h1>
      <p class="tagline">
        Teams assignment submissions via OneDrive sync
        <span class="live-dot" class:on={liveConnected && !error}
          aria-label={liveConnected ? "Live" : "Reconnecting"}></span>
      </p>
    </div>
    <div class="header-actions">
      <div class="mode-toggle" role="tablist" aria-label="View mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "browse"}
          class="mode-btn"
          class:active={mode === "browse"}
          onclick={() => (mode = "browse")}
        >
          Browse
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "monitor"}
          class="mode-btn"
          class:active={mode === "monitor"}
          onclick={() => (mode = "monitor")}
        >
          Live Monitor
        </button>
      </div>
      <button type="button" onclick={handleScan}>Scan folders</button>
      <button type="button" class="primary" onclick={handleMarkAllSeen}>
        Mark all seen
      </button>
    </div>
  </header>

  {#if error}
    <div class="banner error">
      {error}
      <span class="hint"> — Is the server running? Try <code>npm run dev</code></span>
    </div>
  {/if}

  {#if mode === "browse"}
    {#if summary}
      <section class="stats">
        {#each summary.by_class as cls}
          <div class="stat-card">
            <span class="stat-label">{cls.label}</span>
            <span class="stat-value">
              {cls.submitted_count} submitted · {cls.working_count} working
            </span>
            {#if cls.new_count > 0}
              <span class="badge">{cls.new_count} new</span>
            {/if}
          </div>
        {/each}
        {#if summary.total === 0}
          <p class="muted">
            No submission files yet. When students turn in work, it will appear here
            after OneDrive syncs.
          </p>
        {/if}
      </section>
    {/if}

    <div class="main">
      <aside class="sidebar">
        <div class="filters">
          <label>
            <input type="checkbox" bind:checked={filterNewOnly} />
            New only
          </label>
          <select bind:value={filterKind}>
            <option value="">Submitted + Working</option>
            <option value="submitted">Submitted only</option>
            <option value="working">Working only</option>
          </select>
          <select bind:value={filterClass}>
            <option value="">All classes</option>
            {#each classOptions as cls}
              <option value={cls}>{cls}</option>
            {/each}
          </select>
          <input
            type="search"
            placeholder="Search student…"
            bind:value={filterStudent}
          />
          <select bind:value={filterAssignment}>
            <option value="">All assignments</option>
            {#each assignmentOptions as a}
              <option value={a}>{a}</option>
            {/each}
          </select>
        </div>

        {#if loading && submissions.length === 0}
          <p class="muted pad">Loading…</p>
        {:else if submissions.length === 0}
          <p class="muted pad">No submissions match filters.</p>
        {:else}
          <ul class="submission-list">
            {#each submissions as s (s.id)}
              <li>
                <button
                  type="button"
                  class="submission-item"
                  class:selected={selectedId === s.id}
                  class:is-new={s.status === "new"}
                  class:is-working={s.kind === "working"}
                  onclick={() => selectSubmission(s.id)}
                >
                  <span class="row-top">
                    <span class="student">{s.student}</span>
                    <span class="kind-badge kind-{s.kind}">
                      {s.kind === "working" ? "DRAFT" : "TURNED IN"}
                    </span>
                  </span>
                  <span class="file">{s.filename}</span>
                  <span class="detail"
                    >{s.assignment} · {formatDate(s.last_modified_at)}</span
                  >
                  {#if s.status === "new"}
                    <span class="new-dot">NEW</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </aside>

      <main class="preview-pane">
        <DocPreview submission={selected} />
      </main>
    </div>
  {:else}
    <AssignmentMonitor />
  {/if}
</div>

<style>
  .layout {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem 1.25rem 2rem;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }

  .header h1 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 600;
  }

  .tagline {
    margin: 0.25rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .live-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: rgba(248, 113, 113, 0.6);
    transition: background 0.3s;
  }

  .live-dot.on {
    background: var(--new);
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5);
    animation: live-pulse 2s ease-out infinite;
  }

  @keyframes live-pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5);
    }
    70% {
      box-shadow: 0 0 0 6px rgba(52, 211, 153, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
    }
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .mode-toggle {
    display: inline-flex;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px;
    margin-right: 0.25rem;
  }

  .mode-btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--muted);
    padding: 0.35rem 0.85rem;
    border-radius: 6px;
    font-size: 0.9rem;
  }

  .mode-btn:hover {
    color: var(--text);
    border-color: transparent;
  }

  .mode-btn.active {
    background: var(--surface2);
    color: var(--text);
    border-color: var(--border);
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

  .hint {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .stat-label {
    font-weight: 600;
  }

  .stat-value {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .badge {
    background: var(--new-bg);
    color: var(--new);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
  }

  .main {
    display: grid;
    grid-template-columns: minmax(280px, 360px) 1fr;
    gap: 1rem;
    min-height: calc(100vh - 220px);
  }

  @media (max-width: 900px) {
    .main {
      grid-template-columns: 1fr;
    }
  }

  .sidebar {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 200px);
  }

  .filters {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .filters label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  .pad {
    padding: 1rem;
  }

  .submission-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
  }

  .submission-item {
    width: 100%;
    text-align: left;
    padding: 0.65rem 0.85rem;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    display: grid;
    gap: 0.15rem;
  }

  .submission-item:hover {
    background: var(--surface2);
  }

  .submission-item.selected {
    background: var(--surface2);
    border-left: 3px solid var(--accent);
  }

  .submission-item.is-new .student {
    color: var(--new);
  }

  .row-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .student {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .kind-badge {
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
    background: rgba(251, 191, 36, 0.12);
    color: #fbbf24;
    border-color: rgba(251, 191, 36, 0.4);
  }

  .file {
    font-size: 0.85rem;
    color: var(--text);
  }

  .detail {
    font-size: 0.75rem;
    color: var(--muted);
  }

  .new-dot {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--new);
    justify-self: start;
  }

  .preview-pane {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem 1.25rem;
    overflow: auto;
    max-height: calc(100vh - 200px);
  }
</style>
