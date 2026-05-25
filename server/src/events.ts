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

export type AppEvent = SubmissionChangedEvent;

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
