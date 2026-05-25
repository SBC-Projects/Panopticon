<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label: string;
    value?: string | number | null;
    placeholder?: boolean;
    children?: Snippet;
  }

  let { label, value, placeholder = false, children }: Props = $props();
</script>

<div class="row" class:placeholder>
  <span class="label">{label}</span>
  <span class="value">
    {#if children}
      {@render children()}
    {:else if value == null || value === ""}
      <span class="muted">—</span>
    {:else}
      {value}
    {/if}
  </span>
</div>

<style>
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--border);
  }

  .row:last-child {
    border-bottom: none;
  }

  .label {
    font-size: 0.78rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  .value {
    font-size: 0.95rem;
    font-weight: 500;
    text-align: right;
  }

  .row.placeholder .value {
    color: var(--muted);
    font-style: italic;
    font-weight: 400;
  }

  .muted {
    color: var(--muted);
  }
</style>
