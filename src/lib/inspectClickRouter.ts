/**
 * Document-level handler for student grid cards.
 * Opens the response inspector via imperative mount (see inspectorOpen.svelte.ts).
 */
import { dispatchInspectSelection } from "./inspectEvents";
import { openInspector } from "./inspectorOpen.svelte";

export { INSPECT_EVENT, type InspectEventDetail } from "./inspectEvents";

function cardFromTarget(target: EventTarget | null): HTMLElement | null {
  const el = target as HTMLElement | null;
  if (!el) return null;
  const card = el.closest<HTMLElement>(".card");
  if (!card || card.getAttribute("data-roster-placeholder") === "1") return null;
  if (el.closest("button.jump-btn")) return null;
  return card;
}

function openFromCard(card: HTMLElement): void {
  const id = card.getAttribute("data-submission-id") ?? "";
  if (!id) return;

  openInspector(id);
  dispatchInspectSelection(id);
}

function handleDocumentClick(e: MouseEvent): void {
  const card = cardFromTarget(e.target);
  if (!card) return;
  openFromCard(card);
}

function handleDocumentKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = cardFromTarget(e.target);
  if (!card) return;
  e.preventDefault();
  openFromCard(card);
}

let installed = false;

export function installInspectClickRouter(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
}
