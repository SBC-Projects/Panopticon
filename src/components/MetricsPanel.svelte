<script lang="ts">
  import MetricRow from "./MetricRow.svelte";
  import ActivityIndicator from "./ActivityIndicator.svelte";
  import {
    formatRelativeTime,
    activityState,
    now,
  } from "$lib/metrics.svelte";
  import {
    formatDate,
    formatSize,
    openInApp,
    type StudentResponse,
  } from "$lib/api";

  interface ClassSummary {
    student_count: number;
    live_count: number;
    recent_count: number;
    avg_words: number | null;
    last_activity_iso: string | null;
  }

  interface Props {
    selected: StudentResponse | null;
    classSummary: ClassSummary;
    className: string;
    assignmentName: string;
  }

  let { selected, classSummary, className, assignmentName }: Props = $props();

  let openError = $state<string | null>(null);

  async function handleOpen() {
    if (!selected) return;
    openError = null;
    try {
      await openInApp(selected.submission_id);
    } catch (e) {
      openError = e instanceof Error ? e.message : "Could not open";
    }
  }
</script>

<aside class="panel">
  {#if selected}
    <header class="head">
      <div class="name-row">
        <h3>{selected.student}</h3>
        <ActivityIndicator
          lastModifiedAt={selected.last_modified_at}
          showLabel
        />
      </div>
      <p class="muted small">{selected.filename}</p>
    </header>

    <section>
      <h4>Now</h4>
      <MetricRow
        label="Words written"
        value={selected.word_count?.toLocaleString() ?? "—"}
      />
      <MetricRow
        label="Time since edit"
        value={formatRelativeTime(selected.last_modified_at, now.value)}
      />
      <MetricRow label="File size" value={formatSize(selected.size_bytes)} />
      <MetricRow label="Kind">
        {#snippet children()}
          <span class="kind kind-{selected.kind}">
            {selected.kind === "working" ? "DRAFT" : "TURNED IN"}
          </span>
        {/snippet}
      </MetricRow>
      <MetricRow
        label="First seen"
        value={formatDate(selected.first_seen_at)}
      />
      <MetricRow label="Status" value={selected.status} />
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

    <div class="actions">
      <button type="button" class="primary" onclick={handleOpen}>
        Open in Word
      </button>
      {#if openError}
        <p class="error">{openError}</p>
      {/if}
    </div>
  {:else}
    <header class="head">
      <h3>
        {className || "—"} <span class="muted">·</span>
        <span class="muted">{assignmentName || "—"}</span>
      </h3>
      <p class="muted small">Click a student card to see their metrics.</p>
    </header>

    <section>
      <h4>Class snapshot</h4>
      <MetricRow
        label="Students with work"
        value={classSummary.student_count}
      />
      <MetricRow
        label="Editing now"
        value={`${classSummary.live_count} live · ${classSummary.recent_count} recent`}
      />
      <MetricRow
        label="Average words"
        value={classSummary.avg_words == null
          ? "—"
          : classSummary.avg_words.toLocaleString()}
      />
      <MetricRow
        label="Latest activity"
        value={classSummary.last_activity_iso
          ? formatRelativeTime(classSummary.last_activity_iso, now.value)
          : "—"}
      >
        {#snippet children()}
          {#if classSummary.last_activity_iso}
            <span class="activity-cell">
              <ActivityIndicator
                lastModifiedAt={classSummary.last_activity_iso}
              />
              <span>
                {formatRelativeTime(
                  classSummary.last_activity_iso,
                  now.value
                )}
              </span>
            </span>
          {:else}
            <span class="muted">—</span>
          {/if}
        {/snippet}
      </MetricRow>
    </section>
  {/if}
</aside>

<style>
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    height: fit-content;
    position: sticky;
    top: 1rem;
  }

  .head h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .name-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }

  section {
    display: flex;
    flex-direction: column;
  }

  section h4 {
    margin: 0 0 0.4rem;
    font-size: 0.7rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .kind {
    font-size: 0.65rem;
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

  .muted {
    color: var(--muted);
  }

  .small {
    font-size: 0.85rem;
    margin: 0.25rem 0 0;
  }

  .error {
    margin: 0;
    color: #f87171;
    font-size: 0.85rem;
  }

  .activity-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
</style>
