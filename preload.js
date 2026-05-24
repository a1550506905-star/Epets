const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 宠物管理
  getPets: () => ipcRenderer.invoke('get-pets'),
  getCurrentPet: () => ipcRenderer.invoke('get-current-pet'),
  getSpritesheetPath: (pet) => ipcRenderer.invoke('get-spritesheet-path', pet),
  getAllPetsWithPaths: () => ipcRenderer.invoke('get-all-pets-with-paths'),
  selectPet: (petId) => ipcRenderer.invoke('select-pet', petId),
  getPoints: () => ipcRenderer.invoke('get-points'),
  getShopPets: () => ipcRenderer.invoke('get-shop-pets'),
  unlockPet: (petId) => ipcRenderer.invoke('unlock-pet', petId),
  redeemCode: (code) => ipcRenderer.invoke('redeem-code', code),
  onPetChanged: (callback) => {
    ipcRenderer.on('pet-changed', (_, pet) => callback(pet));
  },

  // 剪贴板
  getClipboardHistory: () => ipcRenderer.invoke('get-clipboard-history'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  clearClipboardHistory: () => ipcRenderer.invoke('clear-clipboard-history'),
  onClipboardUpdated: (callback) => {
    ipcRenderer.on('clipboard-updated', (_, history) => callback(history));
  },

  // 对话
  openChat: () => ipcRenderer.invoke('open-chat'),
  loadChatHistory: (petId) => ipcRenderer.invoke('load-chat-history', petId),
  saveChatHistory: (petId, messages) => ipcRenderer.invoke('save-chat-history', petId, messages),

  // DeepSeek
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
  getNickname: () => ipcRenderer.invoke('get-nickname'),
  setNickname: (name) => ipcRenderer.invoke('set-nickname', name),
  getCity: () => ipcRenderer.invoke('get-city'),
  setCity: (city) => ipcRenderer.invoke('set-city', city),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  deepseekChat: (opts) => ipcRenderer.invoke('deepseek-chat', opts),
  searchWeb: (query) => ipcRenderer.invoke('search-web', query),
  getWeather: () => ipcRenderer.invoke('get-weather'),
  onChatFileDrop: (callback) => {
    ipcRenderer.on('chat-file-drop', (_, data) => callback(data));
  },
  notifyPetTalk: () => ipcRenderer.send('pet-talk'),
  onPetSelected: (petId, mode, sourcePetId) => ipcRenderer.invoke('on-pet-selected', petId, mode, sourcePetId),
  onChatOpened: (callback) => { ipcRenderer.on('chat-opened', () => callback()); },
  onChatClosed: (callback) => { ipcRenderer.on('chat-closed', () => callback()); },
  getPetScale: () => ipcRenderer.invoke('get-pet-scale'),
  setPetScale: (scale) => ipcRenderer.invoke('set-pet-scale', scale),
  onSetScale: (callback) => { ipcRenderer.on('set-scale', (_, s) => callback(s)); },
  onPetTalk: (callback) => { ipcRenderer.on('trigger-talk-anim', () => callback()); },

  // 窗口管理
  getPetWindowBounds: () => ipcRenderer.invoke('get-pet-window-bounds'),
  resizePetWindow: (size) => ipcRenderer.send('resize-pet-window', size),
  movePetWindow: (pos) => ipcRenderer.send('move-pet-window', pos),
  minimizeChatWindow: () => ipcRenderer.send('minimize-chat-window'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  selectPatchFile: () => ipcRenderer.invoke('select-patch-file'),
  applyPatch: (path) => ipcRenderer.invoke('apply-patch', path),
  checkForUpdate: () => ipcRenderer.invoke('check-for-updates'),
  doUpdate: (result) => ipcRenderer.invoke('do-update', result),
  getFocusMode: () => ipcRenderer.invoke('get-focus-mode'),
  setFocusMode: (hours) => ipcRenderer.invoke('set-focus-mode', hours),
  cancelFocusMode: () => ipcRenderer.invoke('cancel-focus-mode'),
  onFocusModeChanged: (callback) => { ipcRenderer.on('focus-mode-changed', (_, active) => callback(active)); },
  restartApp: () => ipcRenderer.send('restart-app'),
  openChatWithFile: (data) => ipcRenderer.send('open-chat-with-file', data),

  // 屏幕边界
  getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),

  // 文件暂存
  stashFile: (filePath) => ipcRenderer.invoke('stash-file', filePath),
  readFileContent: (filePath) => ipcRenderer.invoke('read-file-content', filePath),
  openStashFolder: () => ipcRenderer.invoke('open-stash-folder'),

  // 日程表
  getSchedule: (date) => ipcRenderer.invoke('get-schedule', date),
  addScheduleTask: (date, text) => ipcRenderer.invoke('add-schedule-task', date, text),
  toggleScheduleTask: (date, taskId) => ipcRenderer.invoke('toggle-schedule-task', date, taskId),
  deleteScheduleTask: (date, taskId) => ipcRenderer.invoke('delete-schedule-task', date, taskId),
  saveScheduleSummary: (date, summary) => ipcRenderer.invoke('save-schedule-summary', date, summary),
  getSchedulePinned: () => ipcRenderer.invoke('get-schedule-pinned'),
  setSchedulePinned: (pinned) => ipcRenderer.invoke('set-schedule-pinned', pinned),
  setScheduleOpacity: (opacity) => ipcRenderer.invoke('set-schedule-opacity', opacity),
  openScheduleEditor: () => ipcRenderer.invoke('open-schedule-editor'),
  generateAISummary: (date, characterId) => ipcRenderer.invoke('generate-ai-summary', date, characterId),
  notifyScheduleChanged: () => ipcRenderer.invoke('notify-schedule-changed'),
  onScheduleChanged: (callback) => { ipcRenderer.on('schedule-changed', () => callback()); },
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfigKey: (key, value) => ipcRenderer.invoke('set-config-key', key, value),
  getWeeklyData: () => ipcRenderer.invoke('get-weekly-data'),

  // 菜单事件
  onShowClipboard: (callback) => { ipcRenderer.on('show-clipboard', () => callback()); },
  onShowSettings: (callback) => { ipcRenderer.on('show-settings', () => callback()); },
  onShowAbout: (callback) => { ipcRenderer.on('show-about', () => callback()); },


  // 右键菜单
  showPetMenu: () => ipcRenderer.invoke('show-pet-menu'),
});
