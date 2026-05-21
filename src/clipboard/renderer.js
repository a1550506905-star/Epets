const list = document.getElementById('list');
const clearBtn = document.getElementById('clear-btn');

async function load() {
  const history = await window.api.getClipboardHistory();
  if (!history || history.length === 0) {
    list.innerHTML = '<div class="empty">暂无剪贴板记录</div>';
    return;
  }
  let html = '<table>';
  for (const item of history) {
    const t = new Date(item.time).toLocaleString('zh-CN');
    const txt = escapeHtml(item.text || '');
    html += `<tr data-full="${encodeURIComponent(item.fullText || item.text || '')}">
      <td class="text">${txt}</td>
      <td class="time">${t}</td>
    </tr>`;
  }
  html += '</table>';
  list.innerHTML = html;

  list.querySelectorAll('tr').forEach(tr => {
    tr.onclick = () => {
      const txt = decodeURIComponent(tr.dataset.full);
      window.api.copyToClipboard(txt);
      tr.style.background = '#d4edda';
      setTimeout(() => { tr.style.background = ''; }, 400);
    };
  });
}

clearBtn.onclick = async () => {
  await window.api.clearClipboardHistory();
  list.innerHTML = '<div class="empty">已清空</div>';
};

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

load();
