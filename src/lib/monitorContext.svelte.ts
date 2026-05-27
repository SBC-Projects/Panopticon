import type { StudentResponse } from "./api";

export const monitorContext = $state({
  watch_root_label: "",
  responses: [] as StudentResponse[],
});

/** Call whenever AssignmentMonitor updates its grid — no $effect required. */
export function syncMonitorGrid(
  watch_root_label: string,
  responses: StudentResponse[]
): void {
  monitorContext.watch_root_label = watch_root_label;
  monitorContext.responses = responses;
}
