import { mount, unmount } from "svelte";
import ResponseInspectorModal from "../components/ResponseInspectorModal.svelte";
import { dispatchInspectSelection } from "./inspectEvents";
import { monitorContext } from "./monitorContext.svelte";

export const inspectorOpen = $state({
  submission_id: null as string | null,
});

function inspectableIds(): string[] {
  return monitorContext.responses
    .map((r) => r.submission_id)
    .filter((id) => id !== "");
}

let modalRoot: HTMLElement | null = null;
let modalInstance: ReturnType<typeof mount> | null = null;

function teardownModal(): void {
  if (modalInstance) {
    unmount(modalInstance);
    modalInstance = null;
  }
  if (modalRoot) {
    modalRoot.remove();
    modalRoot = null;
  }
}

export function closeInspector(): void {
  inspectorOpen.submission_id = null;
  teardownModal();
}

/** Mount the inspector modal on document.body — does not rely on App re-renders. */
export function openInspector(submission_id: string): void {
  inspectorOpen.submission_id = submission_id;

  const response = monitorContext.responses.find(
    (r) => r.submission_id === submission_id
  );
  if (!response) {
    return;
  }

  teardownModal();

  modalRoot = document.createElement("div");
  modalRoot.id = "panopticon-inspector-mount";
  document.body.appendChild(modalRoot);

  modalInstance = mount(ResponseInspectorModal, {
    target: modalRoot,
    props: {
      response,
      watchRootLabel: monitorContext.watch_root_label,
      onClose: closeInspector,
      onNavigate: (delta: -1 | 1) => navigateInspector(delta),
    },
  });
}

/** Move to the previous/next inspectable student; wraps at the ends. */
export function navigateInspector(delta: -1 | 1): void {
  const ids = inspectableIds();
  if (ids.length === 0) return;

  const current = inspectorOpen.submission_id;
  let idx = current ? ids.indexOf(current) : -1;
  if (idx < 0) idx = 0;

  const nextIdx = (idx + delta + ids.length) % ids.length;
  const nextId = ids[nextIdx];
  if (nextId === current) return;

  openInspector(nextId);
  dispatchInspectSelection(nextId);
}
