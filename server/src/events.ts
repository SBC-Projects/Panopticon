import type { SubmissionKind } from "./types.js";

export interface SubmissionChangedEvent {
  type: "submission-changed";
  id: string;
  kind: SubmissionKind;
  student: string;
  assignment: string;
  filename: string;
  watch_root_label: string;
  last_modified_at: string;
}

/**
 * Emitted when a watched file disappears from disk. Carries only the
 * minimum the client needs to reconcile: the deleted submission id plus
 * the (class, assignment, student) tuple for cheap filtering before the
 * id match. No `kind` — clients match by `submission_id`, which is
 * already kind-unique.
 */
export interface SubmissionDeletedEvent {
  type: "submission-deleted";
  id: string;
  student: string;
  assignment: string;
  watch_root_label: string;
}

export type AppEvent = SubmissionChangedEvent | SubmissionDeletedEvent;

export type EventListener = (event: AppEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: AppEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error("Event listener failed:", e);
      }
    }
  }
}
