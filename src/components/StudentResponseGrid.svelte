<script lang="ts">
  import StudentResponseCard from "./StudentResponseCard.svelte";
  import type { DraftElsewhere, StudentResponse } from "$lib/api";

  interface Props {
    responses: StudentResponse[];
    selectedId: string | null;
    onJumpToDraft?: (draft: DraftElsewhere) => void;
    loading: boolean;
    empty: string;
  }

  let { responses, selectedId, onJumpToDraft, loading, empty }: Props = $props();

</script>

{#if loading && responses.length === 0}
  <div class="state-msg">Loading responses…</div>
{:else if responses.length === 0}
  <div class="state-msg muted">{empty}</div>
{:else}
  <div class="grid">
    {#each responses as r (r.submission_id || `roster:${r.student}`)}
      <StudentResponseCard
        response={r}
        selected={selectedId !== null && selectedId === r.submission_id}
        {onJumpToDraft}
      />
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.75rem;
  }

  .state-msg {
    padding: 2rem 1rem;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: 10px;
  }

  .muted {
    color: var(--muted);
  }
</style>
