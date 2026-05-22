(async () => {
  document.getElementById('nickname').value = await window.api.getNickname();
  document.getElementById('city').value = await window.api.getCity();
  document.getElementById('key').value = await window.api.getApiKey();
  document.getElementById('auto-start').checked = await window.api.getAutoStart();

  document.getElementById('auto-start').onchange = async () => {
    await window.api.setAutoStart(document.getElementById('auto-start').checked);
  };

  function saved(btn, txt) { btn.textContent = '已保存'; setTimeout(() => { btn.textContent = txt; }, 2000); }

  document.getElementById('save-nickname').onclick = async () => {
    const n = document.getElementById('nickname').value.trim();
    if (n) { await window.api.setNickname(n); saved(document.getElementById('save-nickname'), '保存昵称'); }
  };
  document.getElementById('save-city').onclick = async () => {
    const c = document.getElementById('city').value.trim();
    if (c) { await window.api.setCity(c); saved(document.getElementById('save-city'), '保存城市'); }
  };
  document.getElementById('save-key').onclick = async () => {
    const k = document.getElementById('key').value.trim();
    if (k) { await window.api.setApiKey(k); saved(document.getElementById('save-key'), '保存 API Key'); }
  };

  const msgEl = document.getElementById('redeem-msg');
  document.getElementById('redeem-btn').onclick = async () => {
    const code = document.getElementById('code').value.trim();
    if (!code) return;
    const result = await window.api.redeemCode(code);
    if (result.success) {
      msgEl.className = 'msg ok';
      msgEl.textContent = '获得 ' + result.added + ' 积分，共 ' + result.points + ' 积分';
      document.getElementById('code').value = '';
    } else {
      msgEl.className = 'msg err';
      msgEl.textContent = result.reason;
    }
  };

  const updateMsg = document.getElementById('update-msg');
  document.getElementById('check-update').onclick = async () => {
    const btn = document.getElementById('check-update');
    btn.textContent = '检查中...';
    btn.disabled = true;
    const result = await window.api.checkForUpdate();
    btn.textContent = '检查 GitHub 更新';
    btn.disabled = false;
    if (result.error) {
      updateMsg.className = 'msg err';
      updateMsg.textContent = result.error;
    } else if (result.hasUpdate) {
      updateMsg.className = 'msg ok';
      updateMsg.textContent = `发现新版本 ${result.latestVersion}（当前 ${result.currentVersion}），请前往 GitHub 下载更新`;
      updateMsg.className = 'msg ok';
    } else {
      updateMsg.className = 'msg ok';
      updateMsg.textContent = `已是最新版本 (${result.currentVersion})`;
    }
  };

  const patchMsg = document.getElementById('patch-msg');
  document.getElementById('apply-patch').onclick = async () => {
    const filePath = await window.api.selectPatchFile();
    if (!filePath) return;
    patchMsg.className = 'msg ok';
    patchMsg.textContent = '正在安装补丁...';
    const result = await window.api.applyPatch(filePath);
    if (result.success) {
      patchMsg.textContent = '补丁安装成功，软件将重启';
      setTimeout(() => window.api.restartApp(), 1000);
    } else {
      patchMsg.className = 'msg err';
      patchMsg.textContent = '安装失败: ' + result.error;
    }
  };
})();
