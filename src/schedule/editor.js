const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

function effectiveDate() {
  const d = new Date();
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

let currentWeekOffset = 0;
let allData = {};

// ====== Tab switching ======
document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentWeekOffset = parseInt(btn.dataset.tab);
    renderWeek();
  });
});

document.getElementById('btn-minimize').addEventListener('click', () => window.api.minimizeWindow());
document.querySelector('.btn-close').addEventListener('click', () => window.close());

// ====== Week grid ======
function getWeekDays(offset) {
  const now = new Date();
  if (now.getHours() < 4) now.setDate(now.getDate() - 1);
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

async function renderWeek() {
  const days = getWeekDays(currentWeekOffset);
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';
  const today = effectiveDate();

  for (const date of days) {
    const d = new Date(date);
    const isToday = date === today;
    const data = await window.api.getSchedule(date);
    allData[date] = data;

    const dayDiv = document.createElement('div');
    dayDiv.className = 'week-day' + (isToday ? ' today' : '');
    dayDiv.innerHTML =
      `<div class="day-label">${d.getMonth() + 1}/${d.getDate()} 周${weekdays[d.getDay()]}</div>
       <div class="day-tasks" data-date="${date}"></div>
       <div class="day-bottom"><input type="text" placeholder="+ 添加" data-date="${date}"></div>`;
    grid.appendChild(dayDiv);

    const taskContainer = dayDiv.querySelector('.day-tasks');
    (data.tasks || []).forEach(task => {
      const t = document.createElement('div');
      t.className = 'mini-task' + (task.done ? ' done' : '');
      t.innerHTML =
        `<span class="task-label">${esc(task.text)}</span>
         <span class="del-task">&times;</span>`;
      t.addEventListener('click', (e) => {
        if (e.target.classList.contains('del-task')) {
          window.api.deleteScheduleTask(date, task.id).then(() => renderWeek());
          return;
        }
        window.api.toggleScheduleTask(date, task.id).then(() => {
          window.api.notifyScheduleChanged();
          renderWeek();
        });
      });
      taskContainer.appendChild(t);
    });
  }

  // Add task inputs
  document.querySelectorAll('.day-bottom input').forEach(inp => {
    inp.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const text = inp.value.trim();
        const date = inp.dataset.date;
        if (text && date) {
          await window.api.addScheduleTask(date, text);
          inp.value = '';
          window.api.notifyScheduleChanged();
          renderWeek();
        }
      }
    });
  });

  // Load today's summary
  const todayData = allData[today] || await window.api.getSchedule(today);
  document.getElementById('summary-date').textContent = `(${today})`;
  document.getElementById('summary-input').value = todayData.summary || '';

  // Load character list
  const pets = await window.api.getPets();
  const config = await window.api.getConfig();
  const select = document.getElementById('summary-char-select');
  select.innerHTML = '';
  pets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.displayName || p.id;
    if (p.id === config.summaryCharacterId) opt.selected = true;
    select.appendChild(opt);
  });
}

function esc(s) { return s.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ====== Save summary ======
document.getElementById('save-summary-btn').addEventListener('click', async () => {
  const summary = document.getElementById('summary-input').value.trim();
  await window.api.saveScheduleSummary(effectiveDate(), summary);
  await window.api.notifyScheduleChanged();
  document.getElementById('save-summary-btn').textContent = '已保存';
  setTimeout(() => { document.getElementById('save-summary-btn').textContent = '保存总结'; }, 1500);
});

// ====== Save character choice ======
document.getElementById('summary-char-select').addEventListener('change', async (e) => {
  await window.api.setConfigKey('summaryCharacterId', e.target.value);
});

// ====== Generate AI summary ======
document.getElementById('gen-ai-summary').addEventListener('click', async () => {
  const btn = document.getElementById('gen-ai-summary');
  const status = document.getElementById('gen-status');
  btn.disabled = true;
  btn.textContent = '生成中...';
  status.textContent = '正在调用 AI...';
  const charId = document.getElementById('summary-char-select').value;
  const result = await window.api.generateAISummary(effectiveDate(), charId);
  btn.disabled = false;
  btn.textContent = '生成AI总结';
  if (result.error) {
    status.textContent = '失败: ' + result.error;
  } else {
    status.textContent = 'AI 总结已生成';
    await window.api.notifyScheduleChanged();
  }
});

// init
renderWeek();
