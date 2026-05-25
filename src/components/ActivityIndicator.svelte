<script lang="ts">
  import { activityState, now, type ActivityState } from "$lib/metrics.svelte";

  interface Props {
    lastModifiedAt: string | null;
    /** Optional override (e.g. for unit-style stories). */
    state?: ActivityState;
    /** Show label text next to the dot. */
    showLabel?: boolean;
  }

  let { lastModifiedAt, state, showLabel = false }: Props = $props();

  const resolved = $derived<ActivityState>(
    state ??
      (lastModifiedAt ? activityState(lastModifiedAt, now.value) : "idle")
  );

  const label = $derived(
    resolved === "live"
      ? "live"
      : resolved === "recent"
        ? "recent"
        : "idle"
  );
</script>

<span class="indicator" data-state={resolved} aria-label={label}>
  <span class="dot"></span>
  {#if showLabel}
    <span class="text">{label}</span>
  {/if}
</span>

<style>
  .indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--muted);
    flex: none;
  }

  .indicator[data-state="live"] .dot {
    background: var(--new);
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.55);
    animation: act-pulse 1.6s ease-out infinite;
  }

  .indicator[data-state="live"] .text {
    color: var(--new);
  }

  .indicator[data-state="recent"] .dot {
    background: var(--warn);
  }

  .indicator[data-state="recent"] .text {
    color: var(--warn);
  }

  .indicator[data-state="idle"] .text {
    color: var(--muted);
  }

  @keyframes act-pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.55);
    }
    70% {
      box-shadow: 0 0 0 5px rgba(52, 211, 153, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
    }
  }
</style>
