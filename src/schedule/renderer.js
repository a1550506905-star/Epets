const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

function effectiveDate() {
  const d = new Date();
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

let pinned = false;

// ====== Pin ======
document.getElementById('btn-pin').addEventListener('click', async () => {
  pinned = !pinned;
  document.getElementById('btn-pin').classList.toggle('pinned', pinned);
  await window.api.setSchedulePinned(pinned);
});

document.getElementById('btn-minimize').addEventListener('click', () => window.api.minimizeWindow());
document.querySelector('.btn-close').addEventListener('click', () => window.close());

// ====== Settings button ======
document.getElementById('btn-settings').addEventListener('click', () => window.api.openScheduleEditor());

// ====== Today ======
async function renderToday() {
  const date = effectiveDate();
  const d = new Date(date);
  document.getElementById('today-date').textContent =
    `${d.getMonth() + 1}月${d.getDate()}日 周${weekdays[d.getDay()]}`;

  const data = await window.api.getSchedule(date);
  const tasks = data.tasks || [];

  // Task list
  const list = document.getElementById('task-list');
  list.innerHTML = '';
  tasks.forEach(task => {
    const row = document.createElement('div');
    row.className = 'task-item' + (task.done ? ' done' : '');
    row.innerHTML =
      `<input type="checkbox" ${task.done ? 'checked' : ''}>
       <span class="task-text">${esc(task.text)}</span>
       <span class="task-time">${task.doneAt ? fmtTime(task.doneAt) : ''}</span>`;
    row.querySelector('input[type="checkbox"]').addEventListener('change', async () => {
      await window.api.toggleScheduleTask(date, task.id);
      renderToday();
    });
    list.appendChild(row);
  });

  // Manual summary
  const summaryDiv = document.getElementById('today-summary');
  if (data.summary) {
    summaryDiv.classList.add('has-content');
    document.getElementById('summary-text').textContent = data.summary;
  } else {
    summaryDiv.classList.remove('has-content');
  }

  // AI summary
  const aiDiv = document.getElementById('ai-summary');
  if (data.aiSummary) {
    aiDiv.classList.add('has-content');
    document.getElementById('ai-label').textContent = data.aiCharName ? `${data.aiCharName}的总结` : 'AI 总结';
    document.getElementById('ai-summary-text').textContent = data.aiSummary;
  } else {
    aiDiv.classList.remove('has-content');
  }
}

function esc(s) { return s.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtTime(iso) { const d = new Date(iso); return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0'); }

// Listen for focus/blur for transparency
window.addEventListener('focus', async () => {
  if (pinned) await window.api.setScheduleOpacity(1.0);
});
window.addEventListener('blur', async () => {
  if (pinned) await window.api.setScheduleOpacity(0.35);
});

// Listen for schedule data updates from editor
window.api.onScheduleChanged(() => renderToday());

// init
(async () => {
  pinned = await window.api.getSchedulePinned();
  document.getElementById('btn-pin').classList.toggle('pinned', pinned);
  renderToday();
})();
