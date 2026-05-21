const { app, BrowserWindow, ipcMain, clipboard, screen, Menu, shell, Tray, nativeImage, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const pdfjsLib = require('pdfjs-dist');

const isPackaged = app.isPackaged;

function resPath(rel) {
  return isPackaged ? path.join(process.resourcesPath, rel) : path.join(__dirname, rel);
}

function debugLog(msg) {
  if (isPackaged) return;
  const logPath = path.join(__dirname, 'debug.log');
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
}

const APP_ICON_PATH = resPath('图标.png');
let appIcon = null;

const PETS_DIR = resPath('pets');
const STASH_DIR = resPath('暂存文件');

let petWindows = {};
let chatWindows = {};
let activePets = [];  // 当前显示的宠物 ID 列表
let clipboardHistory = [];
let clipboardInterval = null;
let config = {};
let configPath = '';

function loadConfig() {
  const pets = scanPets();
  const firstPet = pets[0];
  const defaultUnlocked = pets.find(p => p.id === 'doraemon') ? ['doraemon'] : (firstPet ? [firstPet.id] : []);
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
  catch { config = { apiKey: '', currentPetId: '', nickname: '', city: '', activePetIds: [], petScales: {}, unlockedPets: defaultUnlocked, points: 600, firstRun: true, redeemedCodes: [], autoStart: true }; }
  if (config.autoStart === undefined) config.autoStart = true;
  if (!config.petScales) config.petScales = {};
  if (!config.unlockedPets || config.unlockedPets.length === 0) config.unlockedPets = defaultUnlocked;
  if (config.points === undefined) config.points = config.firstRun ? 600 : 0;
  if (!config.redeemedCodes) config.redeemedCodes = [];
  if (config.firstRun === undefined) config.firstRun = true;
  // 解密 API Key
  if (config.encryptedKey) {
    try { config.apiKey = safeStorage.decryptString(Buffer.from(config.encryptedKey, 'base64')); }
    catch { config.apiKey = ''; config.encryptedKey = null; }
  }
}

function saveConfig() {
  if (!configPath) return;
  // 加密 API Key
  const save = { ...config };
  if (save.apiKey) {
    save.encryptedKey = safeStorage.encryptString(save.apiKey).toString('base64');
    delete save.apiKey;
  } else {
    save.encryptedKey = null;
    save.apiKey = '';
  }
  // 积分校验码（同步到内存中的 config）
  save._sig = pointsSignature(save.points);
  config._sig = save._sig;
  fs.writeFileSync(configPath, JSON.stringify(save, null, 2));
}

function pointsSignature(points) {
  return crypto.createHmac('sha256', 'deskpet').update('pts:' + points).digest('hex').slice(0, 8);
}

function verifyPoints(configObj, points) {
  // 没有签名 = 旧数据，默认信任
  if (!configObj._sig) return true;
  return configObj._sig === pointsSignature(points);
}

function scanPets() {
  if (!fs.existsSync(PETS_DIR)) fs.mkdirSync(PETS_DIR, { recursive: true });
  const entries = fs.readdirSync(PETS_DIR, { withFileTypes: true });
  return entries.filter(d => d.isDirectory()).map(d => {
    const petJsonPath = path.join(PETS_DIR, d.name, 'pet.json');
    if (fs.existsSync(petJsonPath)) {
      try {
        const petData = JSON.parse(fs.readFileSync(petJsonPath, 'utf-8'));
        return { ...petData, folder: d.name, dir: path.join(PETS_DIR, d.name) };
      } catch { return null; }
    }
    return null;
  }).filter(Boolean);
}

function loadPet(petId) {
  const pets = scanPets();
  if (petId) { const found = pets.find(p => p.id === petId); if (found) return found; }
  if (pets.length > 0) return pets[0];
  return null;
}

function getPetFromEvent(event) {
  const wcId = event.sender.id;
  for (const [pid, win] of Object.entries(petWindows)) {
    if (win && !win.isDestroyed() && win.webContents.id === wcId) return pid;
  }
  return activePets[0] || null;
}

function getPetWindowFromEvent(event) {
  const wcId = event.sender.id;
  for (const win of Object.values(petWindows)) {
    if (win && !win.isDestroyed() && win.webContents.id === wcId) return win;
  }
  return null;
}

function broadcastToPets(channel, data) {
  for (const win of Object.values(petWindows)) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  }
}

function getClipboardPath() { return path.join(app.getPath('userData'), 'clipboard.json'); }

function loadClipboardHistory() {
  try { clipboardHistory = JSON.parse(fs.readFileSync(getClipboardPath(), 'utf-8')); }
  catch { clipboardHistory = []; }
  cleanupClipboardHistory();
}

function saveClipboardHistory() { fs.writeFileSync(getClipboardPath(), JSON.stringify(clipboardHistory, null, 2)); }

function cleanupClipboardHistory() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  clipboardHistory = clipboardHistory.filter(item => item.time > cutoff);
}

function startClipboardMonitor() {
  loadClipboardHistory();
  let lastText = clipboard.readText();
  clipboardInterval = setInterval(() => {
    try {
      const text = clipboard.readText();
      if (text && text !== lastText && text.length < 10000) {
        lastText = text;
        const item = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          text: text.length > 200 ? text.slice(0, 200) + '...' : text,
          fullText: text,
          time: Date.now()
        };
        clipboardHistory.unshift(item);
        if (clipboardHistory.length > 200) clipboardHistory = clipboardHistory.slice(0, 200);
        saveClipboardHistory();
        broadcastToPets('clipboard-updated', clipboardHistory);
      }
    } catch (e) {}
    cleanupClipboardHistory();
  }, 1000);
}

function createPetWindow(petId, position) {
  if (!petId) return null;
  if (petWindows[petId] && !petWindows[petId].isDestroyed()) {
    petWindows[petId].focus();
    return petWindows[petId];
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const x = position ? position.x : width - 250 - Object.keys(petWindows).length * 180;
  const y = position ? position.y : height - 250;

  const win = new BrowserWindow({
    width: 200, height: 200, x: Math.max(0, x), y: Math.max(0, y),
    transparent: true, frame: false,
    skipTaskbar: true, resizable: false, hasShadow: false,
    icon: appIcon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);

  const filePath = path.join(__dirname, 'src', 'pet-window', 'index.html');
  win.loadFile(filePath, { hash: encodeURIComponent(petId) });

  win.webContents.on('console-message', (event, level, message) => {
    if (level === 3) debugLog('[pet-renderer ERROR] ' + message);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    debugLog('[pet-renderer CRASH] ' + details.reason);
    delete petWindows[petId];
    activePets = activePets.filter(id => id !== petId);
  });
  win.on('closed', () => {
    delete petWindows[petId];
    activePets = activePets.filter(id => id !== petId);
  });

  petWindows[petId] = win;
  if (!activePets.includes(petId)) activePets.push(petId);
  return win;
}

// Clipboard window
let clipboardWin = null;
function createClipboardWindow() {
  if (clipboardWin && !clipboardWin.isDestroyed()) { clipboardWin.focus(); return; }
  clipboardWin = new BrowserWindow({
    width: 460, height: 560, resizable: true, center: true,
    frame: false,
    icon: appIcon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  clipboardWin.loadFile(path.join(__dirname, 'src', 'clipboard', 'index.html'));
  clipboardWin.setMenuBarVisibility(false);
  clipboardWin.on('closed', () => { clipboardWin = null; });
}

// Pet selector window
let petSelectorWin = null;

function createPetSelectorWindow(mode, sourcePetId) {
  if (petSelectorWin && !petSelectorWin.isDestroyed()) {
    petSelectorWin.focus();
    return;
  }
  petSelectorWin = new BrowserWindow({
    width: 1000, height: 700, resizable: true, center: true,
    frame: false,
    icon: appIcon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  const fp = path.join(__dirname, 'src', 'pet-selector', 'index.html');
  const hash = mode + (sourcePetId ? ':' + encodeURIComponent(sourcePetId) : '');
  petSelectorWin.loadFile(fp, { hash: hash });
  petSelectorWin.setMenuBarVisibility(false);
  petSelectorWin.webContents.setBackgroundThrottling(false);
  petSelectorWin.webContents.on('console-message', (e, level, msg) => {
    if (level === 3) debugLog('[selector ERROR] ' + msg);
  });
  petSelectorWin.on('closed', () => { petSelectorWin = null; });
}

ipcMain.handle('on-pet-selected', (_, petId, mode) => {
  const pet = loadPet(petId);
  if (!pet) return false;
  if (!(config.unlockedPets || []).includes(petId)) return false;

  if (mode === 'add') createPetWindow(pet.id);

  if (petSelectorWin && !petSelectorWin.isDestroyed()) petSelectorWin.close();
  return true;
});

// Settings window
let settingsWin = null;
function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 360, height: 520, resizable: false, center: true,
    frame: false,
    icon: appIcon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  settingsWin.loadFile(path.join(__dirname, 'src', 'settings', 'index.html'));
  settingsWin.setMenuBarVisibility(false);
  settingsWin.on('closed', () => { settingsWin = null; });
}

// 使用说明窗口
let aboutWin = null;
function createAboutWindow() {
  if (aboutWin && !aboutWin.isDestroyed()) { aboutWin.focus(); return; }
  aboutWin = new BrowserWindow({
    width: 600, height: 820, resizable: true, center: true,
    frame: false,
    icon: appIcon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  aboutWin.loadFile(path.join(__dirname, 'src', 'about', 'index.html'));
  aboutWin.setMenuBarVisibility(false);
  aboutWin.on('closed', () => { aboutWin = null; });
}

// Shop window
let shopWin = null;
function createShopWindow() {
  if (shopWin && !shopWin.isDestroyed()) { shopWin.focus(); return; }
  shopWin = new BrowserWindow({
    width: 1000, height: 700, resizable: true, center: true,
    frame: false,
    icon: appIcon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  shopWin.loadFile(path.join(__dirname, 'src', 'shop', 'index.html'));
  shopWin.setMenuBarVisibility(false);
  shopWin.on('closed', () => { shopWin = null; });
}

// Chat window (per-pet)
let petPosBeforeChat = null;

function createChatWindow(pet, event) {
  const petId = (pet && pet.id) ? pet.id : '__default__';

  // 已有该角色的聊天窗口 → 聚焦
  if (chatWindows[petId] && !chatWindows[petId].isDestroyed()) {
    chatWindows[petId].focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1000, height: 700, resizable: true, frame: false, transparent: false, backgroundColor: '#fff',
    skipTaskbar: false,
    icon: appIcon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });

  const filePath = path.join(__dirname, 'src', 'chat-window', 'index.html');
  win.loadFile(filePath, { hash: encodeURIComponent(petId) });

  // 找到触发此聊天的宠物窗口
  let petWin = null;
  if (event) petWin = getPetWindowFromEvent(event);
  if (!petWin) petWin = petWindows[petId];

  win.on('closed', () => {
    delete chatWindows[petId];
    if (petWin && !petWin.isDestroyed()) {
      if (petPosBeforeChat) {
        const pb = petWin.getBounds();
        petWin.setBounds({ x: petPosBeforeChat.x, y: petPosBeforeChat.y, width: pb.width, height: pb.height });
        petPosBeforeChat = null;
      }
      petWin.webContents.send('chat-closed');
    }
  });

  win.once('ready-to-show', () => {
    const targetWin = petWin && !petWin.isDestroyed() ? petWin : Object.values(petWindows).find(w => w && !w.isDestroyed());
    if (targetWin) {
      const pb = targetWin.getBounds();
      petPosBeforeChat = { x: pb.x, y: pb.y };
      const cb = win.getBounds();
      targetWin.setBounds({ x: Math.max(0, cb.x - pb.width - 20), y: Math.max(0, cb.y + cb.height - pb.height - 40), width: pb.width, height: pb.height });
      targetWin.webContents.send('chat-opened');
    }
  });

  chatWindows[petId] = win;
}

// Web search - 多源搜索：Bing → DuckDuckGo HTML → Google News RSS
function decodeHtml(str) {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&ensp;/g, ' ').replace(/&emsp;/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&#?\d+;/g, '').replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ').trim();
}

async function webSearch(query) {
  try {
    return await Promise.any([
      tryBingSearch(query),
      tryDuckDuckGoHTML(query),
      tryGoogleNews(query)
    ]);
  } catch {
    return '';
  }
}

function tryBingSearch(query) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(query);
    const req = https.get({
      hostname: 'cn.bing.com',
      path: '/search?q=' + q + '&setlang=zh-cn&mkt=zh-CN',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      timeout: 10000
    }, (res) => {
      if (res.statusCode !== 200) { req.destroy(); reject(new Error('status ' + res.statusCode)); return; }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const results = [];
          const algoRe = /<li\s+class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/gi;
          let m; let safety = 0;
          while ((m = algoRe.exec(body)) !== null && safety++ < 20) {
            const block = m[0];
            const titleMatch = /<h2[^>]*><a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i.exec(block)
                            || /<a[^>]*class="[^"]*b_title[^"]*"[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
            if (!titleMatch) continue;
            const url = decodeHtml(titleMatch[1]);
            const title = decodeHtml(titleMatch[2]);
            let snippet = '';
            const capMatch = /class="[^"]*b_caption[^"]*"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
            if (capMatch) snippet = decodeHtml(capMatch[1]);
            else {
              const pMatch = /<p[^>]*>([\s\S]{20,300})<\/p>/i.exec(block);
              if (pMatch) snippet = decodeHtml(pMatch[1]);
            }
            if (title) results.push(`${results.length + 1}. ${title}\n   ${snippet}\n   ${url}`);
            if (results.length >= 6) break;
          }
          if (results.length > 0) resolve(results.join('\n\n'));
          else reject(new Error('no results'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function tryDuckDuckGoHTML(query) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(query);
    const body = 'q=' + q + '&kl=cn-zh';
    const req = https.request({
      hostname: 'html.duckduckgo.com',
      path: '/html/',
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    }, (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 302) { req.destroy(); reject(new Error('status ' + res.statusCode)); return; }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const results = [];
          const resultRe = /<div\s+class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a\s+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a\s+class="[^"]*result__url[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
          let m;
          while ((m = resultRe.exec(data)) !== null) {
            const snippet = decodeHtml(m[1]);
            const url = decodeHtml(m[2]);
            if (snippet) results.push(`${results.length + 1}. ${snippet.slice(0, 200)}\n   ${url}`);
            if (results.length >= 6) break;
          }
          if (results.length > 0) resolve(results.join('\n\n'));
          else reject(new Error('no results'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function tryGoogleNews(query) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(query);
    const req = https.get({
      hostname: 'news.google.com',
      path: '/rss/search?q=' + q + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000
    }, (res) => {
      if (res.statusCode !== 200) { req.destroy(); reject(new Error('status ' + res.statusCode)); return; }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const items = [];
          const itemRe = /<item>([\s\S]*?)<\/item>/gi;
          let m;
          while ((m = itemRe.exec(body)) !== null) {
            const xml = m[1];
            const title = (xml.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
            const link = (xml.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
            const desc = (xml.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
            const source = (xml.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] || '';
            const pubDate = (xml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
            if (title) items.push(`${items.length + 1}. ${decodeHtml(title)}\n   ${decodeHtml(source)} | ${pubDate}\n   ${decodeHtml(desc).slice(0, 200)}\n   ${link}`);
            if (items.length >= 8) break;
          }
          if (items.length > 0) resolve(items.join('\n\n'));
          else reject(new Error('no results'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Weather: user-configured city or IP geolocation + wttr.in
async function getWeather() {
  try {
    let city = config.city;
    let region = '';

    // 如果用户设了城市，直接用；否则 IP 定位
    if (!city) {
      const locData = await new Promise((resolve) => {
        https.get({ hostname: 'ipapi.co', path: '/json/', headers: { 'User-Agent': 'Pet/1.0' }, timeout: 5000 }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } });
        }).on('error', () => resolve(null)).on('timeout', function() { this.destroy(); resolve(null); });
      });
      if (locData && locData.city) {
        city = locData.city;
        region = locData.region || '';
      }
    }

    if (!city) city = 'Beijing';

    // 2. 获取天气
    const wxData = await new Promise((resolve) => {
      const q = encodeURIComponent(city);
      https.get({ hostname: 'wttr.in', path: `/${q}?format=j1`, headers: { 'User-Agent': 'curl/7.0' }, timeout: 6000 }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } });
      }).on('error', () => resolve(null)).on('timeout', function() { this.destroy(); resolve(null); });
    });

    if (!wxData || !wxData.current_condition) return '天气数据不可用';

    const cur = wxData.current_condition[0];
    const weather = {
      city: city + (region ? ', ' + region : ''),
      temp: cur.temp_C + '°C',
      feelsLike: cur.FeelsLikeC + '°C',
      condition: cur.weatherDesc[0].value,
      humidity: cur.humidity + '%',
      wind: cur.winddir16Point + ' ' + cur.windspeedKmph + 'km/h',
      visibility: cur.visibility + 'km',
      uvIndex: cur.uvIndex || 'N/A'
    };

    return JSON.stringify(weather);
  } catch { return '天气数据不可用'; }
}

function setupIPC() {
  ipcMain.handle('get-pets', () => scanPets());
  ipcMain.handle('get-current-pet', (event) => {
    const petId = getPetFromEvent(event);
    return loadPet(petId);
  });
  ipcMain.handle('get-spritesheet-path', (_, pet) => {
    if (!pet) return '';
    const folder = pet.folder || pet.id;
    const file = pet.spritesheetPath || 'spritesheet.webp';
    return path.join(PETS_DIR, folder, file);
  });
  ipcMain.handle('get-all-pets-with-paths', () => {
    const pets = scanPets();
    const unlocked = config.unlockedPets || [];
    return pets.filter(p => unlocked.includes(p.id)).map(p => {
      const folder = p.folder || p.id;
      const file = p.spritesheetPath || 'spritesheet.webp';
      return { ...p, spritesheetPath: path.join(PETS_DIR, folder, file) };
    });
  });

  // 积分与商店
  ipcMain.handle('get-points', () => {
    if (!verifyPoints(config, config.points || 0)) { config.points = 0; saveConfig(); }
    return config.points || 0;
  });
  ipcMain.handle('get-shop-pets', () => {
    const all = scanPets();
    const unlocked = config.unlockedPets || [];
    const list = all.filter(p => !unlocked.includes(p.id)).map(p => {
      const folder = p.folder || p.id;
      const file = p.spritesheetPath || 'spritesheet.webp';
      return { id: p.id, displayName: p.displayName, cost: p.unlockCost || 200,
        spritesheetPath: path.join(PETS_DIR, folder, file),
        animations: p.animations || null };
    });
    list.sort((a, b) => a.cost - b.cost);
    return list;
  });
  ipcMain.handle('unlock-pet', (_, petId) => {
    const pet = loadPet(petId);
    const cost = (pet && pet.unlockCost) ? pet.unlockCost : 200;
    if ((config.points || 0) >= cost && !(config.unlockedPets || []).includes(petId)) {
      config.points -= cost;
      config.unlockedPets.push(petId);
      if (config.firstRun) config.firstRun = false;
      saveConfig();
      return { success: true, points: config.points };
    }
    return { success: false, points: config.points, reason: `积分不足，需要 ${cost} 积分` };
  });
  ipcMain.handle('redeem-code', (_, code) => {
    if ((config.redeemedCodes || []).includes(code)) return { success: false, reason: '已使用过' };
    const rewards = { '0223': 5000, '51113212311356': 100000 };
    if (rewards[code]) {
      config.points = (config.points || 0) + rewards[code];
      config.redeemedCodes = [...(config.redeemedCodes || []), code];
      if (config.firstRun) config.firstRun = false;
      saveConfig();
      return { success: true, points: config.points, added: rewards[code] };
    }
    return { success: false, reason: '无效兑换码' };
  });
  ipcMain.handle('select-pet', (event, petId) => {
    const pet = loadPet(petId);
    if (pet) {
      const win = getPetWindowFromEvent(event);
      const oldId = getPetFromEvent(event);
      if (win && oldId && oldId !== petId) {
        const bounds = win.getBounds();
        win.close();
        setTimeout(() => { createPetWindow(petId, { x: bounds.x, y: bounds.y }); }, 200);
      }
    }
    return pet;
  });

  ipcMain.handle('get-clipboard-history', () => { cleanupClipboardHistory(); return clipboardHistory; });
  ipcMain.handle('copy-to-clipboard', (_, text) => { clipboard.writeText(text); });
  ipcMain.handle('clear-clipboard-history', () => { clipboardHistory = []; saveClipboardHistory(); });

  ipcMain.handle('stash-file', (_, filePath) => {
    if (!fs.existsSync(STASH_DIR)) fs.mkdirSync(STASH_DIR, { recursive: true });
    const fileName = path.basename(filePath);
    const dest = path.join(STASH_DIR, fileName);
    try { fs.copyFileSync(filePath, dest); return { success: true, name: fileName, path: dest }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('open-stash-folder', () => {
    if (!fs.existsSync(STASH_DIR)) fs.mkdirSync(STASH_DIR, { recursive: true });
    shell.openPath(STASH_DIR);
  });

  ipcMain.handle('open-chat', (event) => {
    const petId = getPetFromEvent(event);
    const pet = loadPet(petId);
    if (pet) createChatWindow(pet, event);
    else createChatWindow(null, event);
    return true;
  });

  ipcMain.handle('load-chat-history', (_, petId) => {
    try {
      const p = path.join(app.getPath('userData'), 'chat_' + petId + '.json');
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {}
    return [];
  });

  ipcMain.handle('save-chat-history', (_, petId, messages) => {
    try {
      const p = path.join(app.getPath('userData'), 'chat_' + petId + '.json');
      fs.writeFileSync(p, JSON.stringify(messages, null, 2));
    } catch {}
  });
  ipcMain.handle('get-api-key', () => config.apiKey || '');
  ipcMain.handle('set-api-key', (_, key) => { config.apiKey = key; config.encryptedKey = null; saveConfig(); });
  ipcMain.handle('get-nickname', () => config.nickname || '');
  ipcMain.handle('set-nickname', (_, name) => { config.nickname = name; saveConfig(); });
  ipcMain.handle('get-city', () => config.city || '');
  ipcMain.handle('set-city', (_, city) => { config.city = city; saveConfig(); });
  ipcMain.handle('get-auto-start', () => config.autoStart !== false);
  ipcMain.handle('set-auto-start', (_, enabled) => {
    config.autoStart = !!enabled;
    saveConfig();
    app.setLoginItemSettings({ openAtLogin: config.autoStart, args: [] });
  });
  ipcMain.handle('get-pet-scale', (event) => {
    const petId = getPetFromEvent(event);
    return (config.petScales && config.petScales[petId]) || 1;
  });
  ipcMain.handle('set-pet-scale', (event, scale) => {
    const petId = getPetFromEvent(event);
    if (petId) { config.petScales[petId] = scale; saveConfig(); }
  });

  ipcMain.handle('deepseek-chat', async (_, opts) => {
    const apiKey = config.apiKey || opts.apiKey;
    if (!apiKey) return { error: '请先设置 DeepSeek API Key' };

    const apiMessages = [...opts.messages];
    const tools = opts.tools || null;
    let maxRounds = 3;

    while (maxRounds-- > 0) {
      const requestBody = {
        model: opts.model || 'deepseek-chat', messages: apiMessages, stream: false,
        temperature: opts.temperature || 0.7,
        max_tokens: opts.max_tokens || 2000
      };
      if (tools) { requestBody.tools = tools; requestBody.tool_choice = 'auto'; }

      debugLog('deepseek: round ' + (3 - maxRounds) + ' tools=' + (tools ? 'yes(' + tools.length + ')' : 'no') + ' msgs=' + apiMessages.length);

      const result = await callDeepSeekAPI(apiKey, requestBody);
      if (result.error) { debugLog('deepseek: error=' + result.error); return result; }

      const msg = result.message;
      if (!msg) { debugLog('deepseek: no message in response'); return { error: 'API返回异常' }; }

      debugLog('deepseek: hasContent=' + (!!msg.content) + ' hasToolCalls=' + (!!(msg.tool_calls && msg.tool_calls.length)));

      // 有文本回复 → 直接返回
      if (msg.content && !msg.tool_calls) {
        return { content: msg.content };
      }

      // 有工具调用 → 执行
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        apiMessages.push({ role: 'assistant', tool_calls: msg.tool_calls, content: msg.content || null });
        for (const tc of msg.tool_calls) {
          if (tc.function.name === 'web_search') {
            const args = JSON.parse(tc.function.arguments || '{}');
            const searchResult = await webSearch(args.query || '');
            const response = searchResult || '搜索未返回任何结果。请基于你的知识直接回答用户，不要再次尝试搜索。';
            apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: response });
            debugLog('tool: search "' + (args.query || '').slice(0, 50) + '" -> ' + (searchResult ? searchResult.length + ' chars' : 'empty'));
          } else {
            apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: '未知工具，请直接回答用户。' });
          }
        }
        continue;
      }

      return { error: 'API返回格式异常' };
    }
    return { error: '搜索次数过多，请稍后再试' };
  });

function callDeepSeekAPI(apiKey, body) {
  return new Promise((resolve) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.deepseek.com', port: 443, path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(json) },
      timeout: 60000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { resolve({ error: parsed.error.message }); return; }
          const choice = parsed.choices && parsed.choices[0];
          if (!choice) { resolve({ error: 'API返回异常' }); return; }
          resolve({ message: choice.message });
        } catch (e) { resolve({ error: '解析失败' }); }
      });
    });
    req.on('error', (e) => resolve({ error: '网络连接失败，请检查网络后重试' }));
    req.on('timeout', () => { req.destroy(); resolve({ error: '请求超时，请检查网络后重试' }); });
    req.write(json);
    req.end();
  });
}

  ipcMain.handle('search-web', async (_, query) => { return await webSearch(query); });
  ipcMain.handle('get-weather', async () => { return await getWeather(); });

  ipcMain.handle('read-file-content', async (_, filePath) => {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const name = path.basename(filePath);
      const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.py', '.java', '.cpp', '.c', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.log', '.csv'];
      if (textExts.includes(ext)) return { content: fs.readFileSync(filePath, 'utf-8'), name };

      if (ext === '.docx') {
        const zip = new AdmZip(filePath);
        const xml = zip.readAsText('word/document.xml');
        const texts = [];
        const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let m;
        while ((m = re.exec(xml)) !== null) { if (m[1]) texts.push(m[1]); }
        return { content: texts.join('').replace(/\s{2,}/g, ' '), name };
      }

      if (ext === '.pptx') {
        const zip = new AdmZip(filePath);
        const slides = [];
        for (const entry of zip.getEntries()) {
          const en = entry.entryName;
          if (/ppt\/slides\/slide\d+\.xml/.test(en)) {
            const xml = zip.readAsText(en);
            const texts = [];
            const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
            let m;
            while ((m = re.exec(xml)) !== null) { if (m[1]) texts.push(m[1]); }
            const num = en.match(/slide(\d+)/)[1];
            slides.push(`[幻灯片${num}]\n${texts.join('')}`);
          }
        }
        return { content: slides.join('\n\n'), name };
      }

      if (ext === '.xlsx') {
        const zip = new AdmZip(filePath);
        let sharedStrings = [];
        if (zip.getEntry('xl/sharedStrings.xml')) {
          const ssXml = zip.readAsText('xl/sharedStrings.xml');
          const re = /<si>([\s\S]*?)<\/si>/g;
          let m;
          while ((m = re.exec(ssXml)) !== null) {
            const tRe = /<t[^>]*>([^<]*)<\/t>/g;
            let tm; const parts = [];
            while ((tm = tRe.exec(m[1])) !== null) { parts.push(tm[1]); }
            sharedStrings.push(parts.join(''));
          }
        }
        const sheets = [];
        for (const entry of zip.getEntries()) {
          const en = entry.entryName;
          if (/xl\/worksheets\/sheet\d+\.xml/.test(en)) {
            const xml = zip.readAsText(en);
            const rows = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
            const sheetName = en.replace('xl/worksheets/', '').replace('.xml', '');
            const lines = [];
            for (const row of rows.slice(0, 100)) {
              const cells = [];
              const cellRe = /<c[^>]*t="s"[^>]*>[\s\S]*?<v>(\d+)<\/v>[\s\S]*?<\/c>/g;
              let cm;
              while ((cm = cellRe.exec(row)) !== null) { cells.push(sharedStrings[parseInt(cm[1])] || ''); }
              if (cells.length > 0) lines.push(cells.join('\t'));
            }
            if (lines.length > 0) sheets.push(`[${sheetName}]\n${lines.join('\n')}`);
          }
        }
        return { content: sheets.join('\n\n'), name };
      }

      if (ext === '.pdf') {
        const buf = fs.readFileSync(filePath);
        const data = new Uint8Array(buf);
        const doc = await pdfjsLib.getDocument({ data }).promise;
        const texts = [];
        for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(it => it.str).join(' ');
          if (pageText.trim()) texts.push(pageText);
        }
        return { content: texts.join('\n'), name };
      }

      return { content: '', name, binary: true };
    } catch (e) { return { content: '', name: path.basename(filePath), error: e.message }; }
  });

  ipcMain.handle('show-pet-menu', (event) => {
    const petId = getPetFromEvent(event);
    const template = [
      { label: '添加角色', click: () => { createPetSelectorWindow('add'); } },
      { label: '角色商店', click: () => { createShopWindow(); } },
      { type: 'separator' },
      { label: '调整大小', submenu: [25, 50, 75, 100, 125, 150, 200].map(s => {
        const currentScale = (config.petScales && config.petScales[petId]) || 1;
        return {
          label: s + '%',
          type: 'radio',
          checked: Math.abs(currentScale - s / 100) < 0.01,
          click: () => {
            const win = petWindows[petId];
            if (win && !win.isDestroyed()) win.webContents.send('set-scale', s / 100);
          }
        };
      })},
      { type: 'separator' },
      { label: '剪贴板历史', click: () => { createClipboardWindow(); } },
      { label: '打开暂存文件夹', click: () => { shell.openPath(STASH_DIR); } },
      { type: 'separator' },
      { label: '设置', click: () => { createSettingsWindow(); } },
      { label: '使用说明', click: () => { createAboutWindow(); } },
      { type: 'separator' },
      { label: '关闭此宠物', click: () => {
        const win = petWindows[petId];
        if (win && !win.isDestroyed()) win.close();
      }},
      { label: '退出程序', click: () => { app.quit(); } }
    ];
    Menu.buildFromTemplate(template).popup({});
  });

  ipcMain.handle('get-screen-bounds', () => { return screen.getAllDisplays().map(d => d.workArea); });
  ipcMain.handle('get-pet-window-bounds', (event) => {
    const win = getPetWindowFromEvent(event);
    if (win && !win.isDestroyed()) return win.getBounds();
    return null;
  });

  ipcMain.on('resize-pet-window', (event, size) => {
    const win = getPetWindowFromEvent(event);
    if (win && !win.isDestroyed()) {
      const b = win.getBounds();
      win.setBounds({ x: b.x, y: b.y, width: size.width, height: size.height });
    }
  });
  ipcMain.on('move-pet-window', (event, pos) => {
    const win = getPetWindowFromEvent(event);
    if (win && !win.isDestroyed()) {
      const b = win.getBounds();
      win.setBounds({ x: pos.x, y: pos.y, width: b.width, height: b.height });
    }
  });
  ipcMain.on('minimize-chat-window', (event) => {
    const petId = getPetFromEvent(event);
    const win = chatWindows[petId];
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.on('minimize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.on('open-chat-with-file', (event, data) => {
    const petId = getPetFromEvent(event);
    const pet = loadPet(petId);
    createChatWindow(pet, event);
    setTimeout(() => {
      const win = chatWindows[petId] || Object.values(chatWindows)[0];
      if (win && !win.isDestroyed()) win.webContents.send('chat-file-drop', data);
    }, 500);
  });

  // 角色说话时宠物触发动画
  ipcMain.on('pet-talk', (event) => {
    const petId = getPetFromEvent(event);
    const win = petWindows[petId];
    if (win && !win.isDestroyed()) win.webContents.send('trigger-talk-anim');
  });

  // 补丁更新
  ipcMain.handle('select-patch-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择补丁文件',
      filters: [{ name: '补丁文件', extensions: ['zip'] }],
      properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('apply-patch', async (_, patchPath) => {
    try {
      const appDir = isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
      const zip = new AdmZip(patchPath);
      zip.extractAllTo(appDir, true);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.on('restart-app', () => {
    app.relaunch();
    app.quit();
  });
}

let tray = null;

app.whenReady().then(() => {
  app.setAppUserModelId('deskpet');

  // 加载图标（必须在 ready 之后，toPNG 确保 alpha 通道完整）
  try {
    const raw = nativeImage.createFromPath(APP_ICON_PATH);
    if (!raw.isEmpty()) {
      const pngBuf = raw.toPNG();
      const sz = raw.getSize();
      appIcon = nativeImage.createFromBuffer(pngBuf, { width: sz.width, height: sz.height });
    }
  } catch (e) { debugLog('icon load error: ' + e.message); }

  configPath = path.join(app.getPath('userData'), 'config.json');
  loadConfig();
  setupIPC();

  // 开机自启动
  app.setLoginItemSettings({
    openAtLogin: config.autoStart,
    args: []
  });

  // 首次运行 → 打开使用说明
  if (config.firstRun) {
    createAboutWindow();
  }

  // 启动已解锁且上次活跃的宠物
  const pets = scanPets();
  const unlocked = config.unlockedPets || [];
  if (config.activePetIds && config.activePetIds.length > 0) {
    config.activePetIds.filter(id => unlocked.includes(id)).forEach(id => {
      if (pets.find(p => p.id === id)) createPetWindow(id);
    });
  }
  if (Object.keys(petWindows).length === 0) {
    const first = pets.find(p => unlocked.includes(p.id));
    if (first) createPetWindow(first.id);
  }

  startClipboardMonitor();
  setInterval(() => { config.points = (config.points || 0) + 1; saveConfig(); }, 60000);

  // 系统托盘
  if (appIcon) {
    tray = new Tray(appIcon);
    tray.setToolTip('桌面宠物');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '添加角色', click: () => { createPetSelectorWindow('add'); } },
      { label: '角色商店', click: () => { createShopWindow(); } },
      { type: 'separator' },
      { label: '剪贴板历史', click: () => { createClipboardWindow(); } },
      { label: '设置', click: () => { createSettingsWindow(); } },
      { label: '使用说明', click: () => { createAboutWindow(); } },
      { type: 'separator' },
      { label: '退出', click: () => { app.quit(); } }
    ]));
  }
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  config.currentPetId = activePets[0] || '';
  config.activePetIds = [...activePets];
  if (config.firstRun) config.firstRun = false;
  saveConfig();
  if (clipboardInterval) clearInterval(clipboardInterval);
  saveClipboardHistory();
  if (tray) { tray.destroy(); tray = null; }
});
