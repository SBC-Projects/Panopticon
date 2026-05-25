/**
 * Shared time + activity helpers for the Live Monitor.
 *
 * `now.value` is a single ticker driven by setInterval(15s) so every card and
 * timestamp re-derives from the same value. Components should read `now.value`
 * inside reactive contexts (Svelte $derived / template) to subscribe.
 *
 * Path is `.svelte.ts` (not `.ts` as in the original plan) because Svelte 5
 * runes can only run inside .svelte / .svelte.ts modules.
 */

export type ActivityState = "live" | "recent" | "idle";

const LIVE_MS = 60_000;
const RECENT_MS = 5 * 60_000;

export function activityState(
  lastModifiedIso: string,
  nowMs: number = Date.now()
): ActivityState {
  const age = nowMs - Date.parse(lastModifiedIso);
  if (age < LIVE_MS) return "live";
  if (age < RECENT_MS) return "recent";
  return "idle";
}

export function formatRelativeTime(
  iso: string,
  nowMs: number = Date.now()
): string {
  const age = nowMs - Date.parse(iso);
  if (Number.isNaN(age)) return "—";
  const s = Math.max(0, Math.round(age / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

class NowTicker {
  #value = $state(Date.now());
  #started = false;

  get value(): number {
    if (!this.#started) {
      this.#started = true;
      if (typeof window !== "undefined") {
        setInterval(() => {
          this.#value = Date.now();
        }, 15_000);
      }
    }
    return this.#value;
  }
}

export const now = new NowTicker();
