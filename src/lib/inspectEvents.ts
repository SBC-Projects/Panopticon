export const INSPECT_EVENT = "panopticon-inspect";

export type InspectEventDetail = { submission_id: string };

export function dispatchInspectSelection(submission_id: string): void {
  window.dispatchEvent(
    new CustomEvent<InspectEventDetail>(INSPECT_EVENT, {
      detail: { submission_id },
      bubbles: true,
    })
  );
}
