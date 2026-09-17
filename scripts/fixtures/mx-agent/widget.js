const lifetime = new AbortController();
const regionEl = document.querySelector('#region');
const rowsEl = document.querySelector('#rows');
const labelEl = document.querySelector('#label');
const addBtn = document.querySelector('#add');
const errorEl = document.querySelector('#error');

function render(snapshot) {
  // Region synchronization from parent.
  const parentRegion = snapshot.signals.region.value;
  if (String(regionEl.value) !== String(parentRegion)) {
    regionEl.value = parentRegion;
  }

  // Sales table rendering.
  rowsEl.textContent = '';
  const sales = snapshot.signals.sales;
  if (sales.status === 'pending') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.textContent = 'Loading';
    tr.appendChild(td);
    rowsEl.appendChild(tr);
  } else if (sales.status === 'error') {
    errorEl.textContent = sales.error.message;
  } else {
    errorEl.textContent = '';
    const rows = sales.value.rows;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.textContent = String(row.name);
      const revTd = document.createElement('td');
      revTd.textContent = String(row.revenue);
      tr.appendChild(nameTd);
      tr.appendChild(revTd);
      rowsEl.appendChild(tr);
    }
  }
}

const stop = mx.subscribe(['sales', 'region'], render);

function onChangeRegion() {
  void mx.set({ region: regionEl.value });
}
regionEl.addEventListener('change', onChangeRegion, { signal: lifetime.signal });

let running = false;
async function onAdd() {
  if (running) return;
  running = true;
  errorEl.textContent = '';
  const title = labelEl.value.trim();
  if (title === '') {
    running = false;
    return;
  }
  addBtn.disabled = true;
  try {
    await mx.mutate('addTask', { taskTitle: title });
  } catch (e) {
    errorEl.textContent = e.message;
  } finally {
    running = false;
    addBtn.disabled = false;
  }
}
addBtn.addEventListener('click', onAdd, { signal: lifetime.signal });

window.addEventListener('pagehide', () => {
  stop();
  lifetime.abort();
}, { once: true });
