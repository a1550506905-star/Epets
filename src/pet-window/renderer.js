// ===== 默认动画配置（pet.json 无配置时回退） =====
const DEFAULT_ANIMATIONS = [
  { name: 'idle', frames: 6, interval: 150 },
  { name: 'run_right', frames: 8, interval: 100 },
  { name: 'run_left', frames: 8, interval: 100 },
  { name: 'wave', frames: 4, interval: 140 },
  { name: 'jump', frames: 5, interval: 130 },
  { name: 'sad', frames: 8, interval: 160 },
  { name: 'blank', frames: 6, interval: 200 },
  { name: 'running', frames: 6, interval: 90 },
  { name: 'confused', frames: 6, interval: 150 }
];

const ANIM_NAMES = ['idle', 'run_right', 'run_left', 'wave', 'jump', 'sad', 'blank', 'running', 'confused'];
const ANIM_IDLE = 0;
const ANIM_RUN_RIGHT = 1;
const ANIM_RUN_LEFT = 2;

// ===== 状态 =====
let canvas, ctx;
let spritesheet = null;
let animConfigs = DEFAULT_ANIMATIONS;  // 当前生效的动画配置
let currentAnim = ANIM_IDLE;
let currentFrame = 0;
let lastTime = 0;
let petScale = 1;
let drawWidth = 32;
let frameHeight = 32;

// 行为调度
let behaviorTimer = null;
let loopCount = 0;
let targetLoops = 1;

// 移动
let isMoving = false;
let moveSpeed = 3;
let moveDirection = 1;

// 拖拽
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let windowStartX = 0, windowStartY = 0;

// 当前宠物
let currentPet = null;

// ===== 初始化 =====
async function init() {
  canvas = document.getElementById('pet-canvas');
  ctx = canvas.getContext('2d');

  // 从 URL hash 获取本窗口的宠物 ID
  const petId = decodeURIComponent(window.location.hash.slice(1));
  if (petId) {
    const pets = await window.api.getPets();
    currentPet = pets.find(p => p.id === petId);
  }
  if (!currentPet) currentPet = await window.api.getCurrentPet();
  if (!currentPet) {
    document.body.innerHTML = '<div style="color:white;text-align:center;padding:20px;">请在 pets 文件夹中放入宠物文件<br>(pet.json + spritesheet.webp)</div>';
    return;
  }

  // 从 pet.json 加载动画配置
  loadAnimConfig();

  await loadSpritesheet(currentPet);
  if (!spritesheet || !spritesheet.complete) {
    document.body.innerHTML = '<div style="color:white;text-align:center;padding:20px;">无法加载精灵表<br>请检查 pets 文件夹中的 spritesheet.webp</div>';
    return;
  }

  // 加载该宠物保存的大小
  const savedScale = await window.api.getPetScale();
  if (savedScale) petScale = savedScale;

  calcFrameSize();
  setupCanvas();
  await resizePetWindowToFrame();

  lastTime = performance.now();
  requestAnimationFrame(animate);
  scheduleNextBehavior();
  setupEvents();
  setupIpcListeners();
}

// 从当前宠物的 pet.json 读取动画配置
function loadAnimConfig() {
  if (currentPet && currentPet.animations) {
    const cfg = currentPet.animations;
    animConfigs = ANIM_NAMES.map((name, idx) => {
      if (cfg[name]) {
        return { name, frames: cfg[name].frames, interval: cfg[name].interval };
      }
      return { ...DEFAULT_ANIMATIONS[idx] };
    });
  } else {
    animConfigs = DEFAULT_ANIMATIONS;
  }
}

async function loadSpritesheet(pet) {
  const absPath = await window.api.getSpritesheetPath(pet);
  return new Promise((resolve) => {
    spritesheet = new Image();
    spritesheet.src = 'file:///' + absPath.replace(/\\/g, '/');
    spritesheet.onload = () => resolve();
    spritesheet.onerror = () => {
      const folder = pet.folder || pet.id;
      const file = pet.spritesheetPath || 'spritesheet.webp';
      spritesheet.src = `../../pets/${folder}/${file}`;
      spritesheet.onerror = () => resolve();
    };
  });
}

function calcFrameSize() {
  const totalWidth = spritesheet.naturalWidth;
  const totalHeight = spritesheet.naturalHeight;
  frameHeight = Math.floor(totalHeight / animConfigs.length);
  // 所有行统一宽度÷8，每帧等宽，帧数少的只播放前几帧
  drawWidth = Math.floor(totalWidth / 8);
}

function setupCanvas() {
  canvas.width = drawWidth;
  canvas.height = frameHeight;
  canvas.style.width = Math.round(drawWidth * petScale) + 'px';
  canvas.style.height = Math.round(frameHeight * petScale) + 'px';
}

async function resizePetWindowToFrame() {
  const w = Math.round(drawWidth * petScale) + 8;
  const h = Math.round(frameHeight * petScale) + 8;
  await window.api.resizePetWindow({ width: w, height: h });
}

// ===== 动画循环 =====
function animate(timestamp) {
  const cfg = animConfigs[currentAnim];
  const elapsed = timestamp - lastTime;

  if (elapsed >= cfg.interval) {
    lastTime = timestamp;
    currentFrame++;

    // 帧循环
    if (currentFrame >= cfg.frames) {
      currentFrame = 0;

      // 非待机、非跑步：随机播1-5轮后回待机
      if (currentAnim !== ANIM_IDLE && currentAnim !== ANIM_RUN_RIGHT && currentAnim !== ANIM_RUN_LEFT) {
        loopCount++;
        if (loopCount >= targetLoops) {
          currentAnim = ANIM_IDLE;
          isMoving = false;
          loopCount = 0;
          scheduleNextBehavior();
        }
      }
    }

    // 跑步：移动步进
    if (isMoving && (currentAnim === ANIM_RUN_RIGHT || currentAnim === ANIM_RUN_LEFT)) {
      moveStep();
    }

    // 跑步：移动停止后切回待机 (修复动画卡住bug)
    if (!isMoving && (currentAnim === ANIM_RUN_RIGHT || currentAnim === ANIM_RUN_LEFT)) {
      currentAnim = ANIM_IDLE;
      currentFrame = 0;
      scheduleNextBehavior();
    }
  }

  drawFrame();
  requestAnimationFrame(animate);
}

function drawFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!spritesheet || !spritesheet.complete) return;

  const sx = currentFrame * drawWidth;
  const sy = currentAnim * frameHeight;

  ctx.drawImage(spritesheet, sx, sy, drawWidth, frameHeight, 0, 0, drawWidth, canvas.height);
}

// ===== 跑步移动 =====
async function moveStep() {
  const bounds = await window.api.getPetWindowBounds();
  if (!bounds) return;

  let newX = bounds.x + moveSpeed * moveDirection;
  const newY = bounds.y;

  const screenBounds = await window.api.getScreenBounds();
  for (const s of screenBounds) {
    if (newX + bounds.width > s.x && newX < s.x + s.width) {
      if (moveDirection > 0 && newX + bounds.width > s.x + s.width) {
        newX = s.x + s.width - bounds.width;
        isMoving = false;
      }
      if (moveDirection < 0 && newX < s.x) {
        newX = s.x;
        isMoving = false;
      }
      break;
    }
  }

  await window.api.movePetWindow({ x: Math.round(newX), y: Math.round(newY) });
}

// ===== 行为调度 =====
function scheduleNextBehavior() {
  if (chatMode) return;
  if (behaviorTimer) clearTimeout(behaviorTimer);
  const delay = 5000 + Math.random() * 15000;
  behaviorTimer = setTimeout(triggerBehavior, delay);
}

function triggerBehavior() {
  if (isDragging) { scheduleNextBehavior(); return; }

  if (Math.random() < 0.3) {
    // 30% 概率跑动
    const dir = Math.random() < 0.5 ? -1 : 1;
    startRun(dir);
  } else {
    // 随机选择非待机、非跑步动画，随机1-5轮
    const candidates = [3, 4, 5, 6, 7, 8];
    const anim = candidates[Math.floor(Math.random() * candidates.length)];
    currentAnim = anim;
    currentFrame = 0;
    loopCount = 0;
    targetLoops = 1 + Math.floor(Math.random() * 5); // 1~5轮
    isMoving = false;
  }
}

async function startRun(direction) {
  moveDirection = direction;
  currentAnim = direction > 0 ? ANIM_RUN_RIGHT : ANIM_RUN_LEFT;
  currentFrame = 0;
  isMoving = true;
  moveSpeed = 3 + Math.random() * 5;

  // 边界检查
  const bounds = await window.api.getPetWindowBounds();
  const screenBounds = await window.api.getScreenBounds();
  if (bounds && screenBounds.length > 0) {
    const s = screenBounds[0];
    if (direction > 0 && bounds.x + bounds.width >= s.x + s.width - 50) {
      startRun(-1); return;
    }
    if (direction < 0 && bounds.x <= s.x + 50) {
      startRun(1); return;
    }
  }

  // 跑动 2-4 秒后自动停止
  setTimeout(() => { isMoving = false; }, 2000 + Math.random() * 2000);
}

// ===== 事件处理 =====
function setupEvents() {
  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    window.api.openChat();
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.api.showPetMenu();
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      isDragging = true;
      dragStartX = e.screenX;
      dragStartY = e.screenY;
      window.api.getPetWindowBounds().then(bounds => {
        if (bounds) { windowStartX = bounds.x; windowStartY = bounds.y; }
      });
    }
  });

  document.addEventListener('mousemove', async (e) => {
    if (!isDragging) return;
    await window.api.movePetWindow({
      x: Math.round(windowStartX + e.screenX - dragStartX),
      y: Math.round(windowStartY + e.screenY - dragStartY)
    });
  });

  document.addEventListener('mouseup', () => { isDragging = false; });

  // 文件拖拽
  document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  document.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await window.api.stashFile(file.path);
      const ext = file.name.split('.').pop().toLowerCase();
      if (['txt', 'md', 'doc', 'docx', 'pdf', 'pptx', 'xlsx', 'csv'].includes(ext)) {
        const result = await window.api.readFileContent(file.path);
        window.api.openChatWithFile({
          fileName: file.name,
          filePath: file.path,
          content: result.content || '',
          error: result.error || ''
        });
      }
    }
  });
}

// ===== 聊天模式 =====
let chatMode = false;

// ===== IPC监听 =====
function setupIpcListeners() {
  // 大小调整
  window.api.onSetScale(async (scale) => {
    petScale = scale;
    setupCanvas();
    await resizePetWindowToFrame();
    await window.api.setPetScale(scale);
  });

  window.api.onPetChanged(async (pet) => {
    currentPet = pet;
    loadAnimConfig();
    await loadSpritesheet(pet);
    calcFrameSize();
    setupCanvas();
    await resizePetWindowToFrame();
    currentAnim = ANIM_IDLE;
    currentFrame = 0;
    isMoving = false;
    scheduleNextBehavior();
  });

  // 聊天打开 → 进入聊天模式，停止随机行为，保持待机
  window.api.onChatOpened(() => {
    chatMode = true;
    isMoving = false;
    currentAnim = ANIM_IDLE;
    currentFrame = 0;
    if (behaviorTimer) clearTimeout(behaviorTimer);
  });

  // 聊天关闭 → 恢复正常行为
  window.api.onChatClosed(() => {
    chatMode = false;
    scheduleNextBehavior();
  });

  // 收到聊天触发 → 随机播放一个非移动动画，播完回待机
  window.api.onPetTalk(() => {
    if (!chatMode) return;
    const anims = [3, 4, 5, 6, 8]; // wave, jump, sad, blank, confused
    currentAnim = anims[Math.floor(Math.random() * anims.length)];
    currentFrame = 0;
    loopCount = 0;
    targetLoops = 1;
    isMoving = false;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(err => console.error('Init error:', err)));
} else {
  init().catch(err => console.error('Init error:', err));
}
