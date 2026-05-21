const grid = document.getElementById('shop-grid');
const ptsEl = document.getElementById('pts');
let currentPoints = 0;

function getAnimConfig(pet) {
  return (pet.animations && pet.animations.idle) ? pet.animations.idle : { frames: 6, interval: 150 };
}

async function init() {
  currentPoints = await window.api.getPoints();
  ptsEl.textContent = '积分: ' + currentPoints;

  const pets = await window.api.getShopPets();
  if (!pets || pets.length === 0) {
    grid.innerHTML = '<div class="empty">所有角色已解锁</div>';
    return;
  }

  const styleEl = document.createElement('style');
  document.head.appendChild(styleEl);
  let cssRules = '';

  // 预加载所有图片
  const preloads = pets.map(pet => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ pet, img });
    img.onerror = () => resolve(null);
    img.src = 'file:///' + pet.spritesheetPath.replace(/\\/g, '/');
  }));
  const results = await Promise.all(preloads);

  for (const r of results) {
    if (!r) continue;
    const { pet, img } = r;
    const fw = Math.floor(img.naturalWidth / 8);
    const fh = Math.floor(img.naturalHeight / 9);
    const scale = Math.min(100 / fw, 100 / fh);
    const dispW = Math.round(fw * scale);
    const cfg = getAnimConfig(pet);
    const animName = 'a' + pet.id.replace(/[^a-zA-Z0-9]/g, '-');
    const bgW = Math.round(fw * 8 * scale);
    const totalShift = Math.round(fw * cfg.frames * scale);
    const duration = cfg.interval * cfg.frames;

    cssRules += `@keyframes ${animName} { to { background-position: -${totalShift}px 0; } }`;

    const card = document.createElement('div');
    card.className = 'card';

    const sprite = document.createElement('div');
    sprite.className = 'card-sprite';
    sprite.style.width = dispW + 'px';
    sprite.style.height = Math.round(fh * scale) + 'px';
    sprite.style.backgroundImage = `url('${'file:///' + pet.spritesheetPath.replace(/\\/g, '/')}')`;
    sprite.style.backgroundSize = bgW + 'px ' + Math.round(fh * 9 * scale) + 'px';
    sprite.style.backgroundPosition = '0 0';
    sprite.style.animation = `${animName} ${duration}ms steps(${cfg.frames}) infinite`;
    card.appendChild(sprite);

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = pet.displayName;
    card.appendChild(name);

    const cost = document.createElement('div');
    cost.className = 'cost';
    const costVal = pet.cost || 200;
    cost.textContent = costVal + ' 积分';
    card.appendChild(cost);

    const btn = document.createElement('button');
    btn.className = 'buy';
    btn.dataset.cost = costVal;
    btn.textContent = currentPoints >= costVal ? '解锁' : '积分不足';
    if (currentPoints < costVal) btn.disabled = true;

    btn.onclick = async (e) => {
      e.stopPropagation();
      const result = await window.api.unlockPet(pet.id);
      if (result.success) {
        currentPoints = result.points;
        ptsEl.textContent = '积分: ' + currentPoints;
        btn.textContent = '已解锁';
        btn.disabled = true;
        btn.style.background = '#d4edda';
        btn.style.color = '#3a6b3a';
        document.querySelectorAll('.card button').forEach(b => {
          if (b.textContent !== '已解锁') {
            const c = parseInt(b.dataset.cost) || 200;
            b.textContent = currentPoints >= c ? '解锁' : '积分不足';
            b.disabled = currentPoints < c;
          }
        });
        setTimeout(() => { card.style.opacity = '0.5'; }, 600);
      }
    };
    card.appendChild(btn);
    grid.appendChild(card);
  }
  styleEl.textContent = cssRules;
}

init().catch(err => { grid.innerHTML = '<div class="empty">加载失败</div>'; });
