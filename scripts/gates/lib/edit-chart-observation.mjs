/** Runs in one browser task: a reader chart cannot satisfy the editor's readiness check. */
export function readEditChartObservation() {
  const editing = !!document.querySelector('[contenteditable="true"]');
  const marks = document.querySelectorAll('svg.marks, canvas').length;
  return { editing, marks, text: document.body?.innerText ?? '', ready: editing && marks > 0 };
}
