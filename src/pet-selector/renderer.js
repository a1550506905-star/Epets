const grid = document.getElementById('pet-grid');
let mode = 'add';

function getAnimConfig(pet) {
  return (pet.animations && pet.animations.idle) ? pet.animations.idle : { frames: 6, interval: 150 };
}

async function init() {
  const hash = window.location.hash.slice(1);
  const parts = hash.split(':');
  mode = parts[0] || 'add';
  if (parts[1]) parts[1] = decodeURIComponent(parts[1]);

  const pets = await window.api.getAllPetsWithPaths();
  if (!pets || pets.length === 0) {
    grid.innerHTML = '<p style="color:#999;text-align:center;padding:40px;">没有宠物，请在 pets 文件夹中添加</p>';
    return;
  }

  const styleEl = document.createElement('style');
  document.head.appendChild(styleEl);
  let cssRules = '';

  const preloads = pets.map(pet => {
    return new Promise((resolve) => {
      const img = new Image();
      const fileUrl = 'file:///' + pet.spritesheetPath.replace(/\\/g, '/');
      img.onload = () => resolve({ pet, img, fileUrl });
      img.onerror = () => resolve(null);
      img.src = fileUrl;
    });
  });

  const results = await Promise.all(preloads);

  for (const r of results) {
    if (!r) continue;
    const { pet, img, fileUrl } = r;
    const fw = Math.floor(img.naturalWidth / 8);
    const fh = Math.floor(img.naturalHeight / 9);
    const scale = Math.min(100 / fw, 100 / fh);
    const dispW = Math.round(fw * scale);
    const dispH = Math.round(fh * scale);
    const cfg = getAnimConfig(pet);

    const animName = 's' + pet.id.replace(/[^a-zA-Z0-9]/g, '-');
    const bgW = Math.round(fw * 8 * scale);
    const bgH = Math.round(fh * 9 * scale);
    const totalShift = Math.round(fw * cfg.frames * scale);
    const duration = cfg.interval * cfg.frames;

    cssRules += `@keyframes ${animName} { to { background-position: -${totalShift}px 0; } }`;

    const card = document.createElement('div');
    card.className = 'pet-card';

    const sprite = document.createElement('div');
    sprite.className = 'pet-sprite';
    sprite.style.width = dispW + 'px';
    sprite.style.height = dispH + 'px';
    sprite.style.backgroundImage = `url('${fileUrl}')`;
    sprite.style.backgroundSize = bgW + 'px ' + bgH + 'px';
    sprite.style.backgroundPosition = '0 0';
    sprite.style.animation = `${animName} ${duration}ms steps(${cfg.frames}) infinite`;

    card.appendChild(sprite);

    const name = document.createElement('div');
    name.className = 'pet-name';
    name.textContent = pet.displayName;
    card.appendChild(name);

    card.onclick = async () => {
      await window.api.onPetSelected(pet.id, mode);
      document.querySelectorAll('.pet-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    };

    grid.appendChild(card);
  }

  styleEl.textContent = cssRules;
}

init();
