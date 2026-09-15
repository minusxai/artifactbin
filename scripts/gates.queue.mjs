/** Parallel work drains before graphics-heavy gates run alone. The task owns
 * execution, serial-group locks and result reporting in both phases. */
export async function runGateQueue(gates, targets, task) {
  const queue = gates.filter(gate => !gate.exclusive);
  await Promise.all(targets.map(async base => {
    for (let gate = queue.shift(); gate; gate = queue.shift()) await task(gate, base);
  }));
  for (const gate of gates.filter(gate => gate.exclusive)) await task(gate, targets[0]);
}
