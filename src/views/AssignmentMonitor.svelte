<script lang="ts">
  // Step 1 scaffold. Selection bar, response grid, and metrics panel land in
  // later steps per docs/live-monitor-implementation.md.
</script>

<div class="monitor-empty">
  <div class="card">
    <h2>Live Monitor</h2>
    <p class="muted">
      Coming soon. This view will show every student's response for the
      selected class and assignment, with live activity and metrics.
    </p>
    <p class="muted small">
      See <code>docs/live-monitor-implementation.md</code> for the build plan.
    </p>
  </div>
</div>

<style>
  .monitor-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 200px);
    padding: 2rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2rem 2.25rem;
    max-width: 520px;
    text-align: center;
  }

  .card h2 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .muted {
    color: var(--muted);
    margin: 0.5rem 0 0;
    line-height: 1.5;
  }

  .small {
    font-size: 0.85rem;
  }

  code {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
    font-size: 0.85em;
  }
</style>
