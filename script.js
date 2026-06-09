/* ============================================
   PHOTOBOOTH — script.js
   ============================================ */

'use strict';

// ── Config ──────────────────────────────────

const LAYOUTS = [
  { id: 'strip', label: 'Strip', cols: 1, rows: 4, count: 4 },
  { id: '2x2',   label: '2×2',  cols: 2, rows: 2, count: 4 },
  { id: '2x3',   label: '2×3',  cols: 2, rows: 3, count: 6 },
  { id: '3x3',   label: '3×3',  cols: 3, rows: 3, count: 9 },
  { id: '4ph',   label: '4 ph', cols: 2, rows: 2, count: 4 },
  { id: '6ph',   label: '6 ph', cols: 3, rows: 2, count: 6 },
];

const TIMERS = [
  { value: 3,  label: '3s' },
  { value: 5,  label: '5s' },
  { value: 10, label: '10s' },
];

const FILTERS = [
  { id: 'none',   label: 'None',   icon: '🎞️', css: '' },
  { id: 'kawaii', label: 'Kawaii', icon: '🌸', css: 'hue-rotate(320deg) saturate(1.3) brightness(1.05)' },
  { id: 'sakura', label: 'Sakura', icon: '🌺', css: 'sepia(0.3) saturate(1.5) hue-rotate(320deg)' },
  { id: 'anime',  label: 'Anime',  icon: '✨', css: 'contrast(1.15) saturate(1.4) brightness(1.08)' },
  { id: 'y2k',    label: 'Y2K',    icon: '💿', css: 'hue-rotate(200deg) saturate(1.6) contrast(1.1)' },
  { id: 'retro',  label: 'Retro',  icon: '📷', css: 'sepia(0.6) contrast(1.1) brightness(0.95)' },
  { id: 'bw',     label: 'B&W',    icon: '🖤', css: 'grayscale(1) contrast(1.15)' },
  { id: 'dreamy', label: 'Dreamy', icon: '🌙', css: 'hue-rotate(240deg) saturate(0.8) brightness(1.1)' },
];

// ── State ────────────────────────────────────

let stream         = null;
let currentLayout  = LAYOUTS[0];
let currentFilter  = FILTERS[0];
let timerDelay     = 3;
let capturedPhotos = [];
let isShooting     = false;

// ── DOM Refs ─────────────────────────────────

const video          = document.getElementById('video');
const placeholder    = document.getElementById('placeholder');
const cameraBar      = document.getElementById('cameraBar');
const overlayCanvas  = document.getElementById('overlay-canvas');
const overlayCtx     = overlayCanvas.getContext('2d');
const countdownEl    = document.getElementById('countdown');
const flashEl        = document.getElementById('flash');
const shotCounterEl  = document.getElementById('shotCounter');
const btnCapture     = document.getElementById('btnCapture');
const btnRetake      = document.getElementById('btnRetake');
const btnStart       = document.getElementById('btnStart');
const btnClear       = document.getElementById('btnClear');
const btnDownload    = document.getElementById('btnDownload');
const finalCanvas    = document.getElementById('final-canvas');
const collagePreview = document.getElementById('collagePreview');

// ── Init ─────────────────────────────────────

function init() {
  buildLayouts();
  buildTimers();
  buildFilters();
  renderPreview();

  btnStart.addEventListener('click', startCamera);
  btnCapture.addEventListener('click', startCapture);
  btnRetake.addEventListener('click', retakeLast);
  btnClear.addEventListener('click', clearPhotos);
  btnDownload.addEventListener('click', downloadCollage);
}

// ── Layout Builder ───────────────────────────

function buildLayouts() {
  const grid = document.getElementById('layoutGrid');

  LAYOUTS.forEach((layout, i) => {
    const btn = document.createElement('button');
    btn.className = 'layout-btn' + (i === 0 ? ' active' : '');
    btn.title = layout.label;
    btn.setAttribute('aria-label', `Layout: ${layout.label}`);

    const dotsDiv = document.createElement('div');
    dotsDiv.className = 'layout-dots';
    dotsDiv.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
    dotsDiv.style.gridTemplateRows    = `repeat(${layout.rows}, 1fr)`;

    for (let x = 0; x < layout.cols * layout.rows; x++) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      dotsDiv.appendChild(dot);
    }

    const label = document.createElement('span');
    label.textContent = layout.label;

    btn.appendChild(dotsDiv);
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLayout = layout;
      updateShotCounter();
      renderPreview();
    });

    grid.appendChild(btn);
  });
}

// ── Timer Builder ────────────────────────────

function buildTimers() {
  const container = document.getElementById('timerBtns');

  TIMERS.forEach((timer, i) => {
    const btn = document.createElement('button');
    btn.className = 'timer-btn' + (i === 0 ? ' active' : '');
    btn.textContent = timer.label;
    btn.setAttribute('aria-label', `Timer: ${timer.label}`);

    btn.addEventListener('click', () => {
      document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      timerDelay = timer.value;
    });

    container.appendChild(btn);
  });
}

// ── Filter Builder ───────────────────────────

function buildFilters() {
  const container = document.getElementById('filterGrid');

  FILTERS.forEach((filter, i) => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (i === 0 ? ' active' : '');
    btn.setAttribute('aria-label', `Filter: ${filter.label}`);
    btn.innerHTML = `<span class="filter-icon">${filter.icon}</span>${filter.label}`;

    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = filter;
      applyLiveFilter();
    });

    container.appendChild(btn);
  });
}

// ── Camera ───────────────────────────────────

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });

    video.srcObject = stream;
    video.style.display = 'block';
    placeholder.style.display = 'none';
    cameraBar.style.display = 'flex';

    applyLiveFilter();

    video.addEventListener('loadedmetadata', () => {
      overlayCanvas.width  = video.videoWidth;
      overlayCanvas.height = video.videoHeight;
      startParticleAnimation();
    });

    updateShotCounter();
  } catch (err) {
    const msg = placeholder.querySelector('p');
    msg.textContent = 'Camera access denied. Allow camera permission and reload.';
    console.error('Camera error:', err);
  }
}

function applyLiveFilter() {
  video.style.filter = currentFilter.css || 'none';
}

// ── Particle Animation ───────────────────────

const PARTICLE_EMOJIS = ['✨', '🌸', '💕', '⭐', '🌟', '💫', '🌺', '💖'];
const particles = [];

function spawnParticle() {
  if (particles.length >= 12) return;
  particles.push({
    x:     Math.random(),
    y:     1.1,
    vx:    (Math.random() - 0.5) * 0.008,
    vy:    -(0.004 + Math.random() * 0.006),
    emoji: PARTICLE_EMOJIS[Math.floor(Math.random() * PARTICLE_EMOJIS.length)],
    size:  14 + Math.random() * 12,
    life:  1,
    decay: 0.008 + Math.random() * 0.006,
  });
}

function startParticleAnimation() {
  function draw() {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (Math.random() < 0.08) spawnParticle();

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x    += p.vx;
      p.y    += p.vy;
      p.life -= p.decay;

      if (p.life <= 0 || p.y < -0.1) {
        particles.splice(i, 1);
        continue;
      }

      overlayCtx.globalAlpha = p.life;
      overlayCtx.font = `${p.size}px serif`;
      overlayCtx.fillText(p.emoji, p.x * overlayCanvas.width, p.y * overlayCanvas.height);
      overlayCtx.globalAlpha = 1;
    }

    requestAnimationFrame(draw);
  }

  draw();
}

// ── Capture Flow ─────────────────────────────

async function startCapture() {
  if (isShooting) return;
  isShooting = true;
  btnCapture.disabled = true;
  btnRetake.disabled  = true;

  await runCountdown();
  capturePhoto();

  isShooting = false;
  updateShotCounter();
  renderPreview();
}

function runCountdown() {
  return new Promise(resolve => {
    let n = timerDelay;
    countdownEl.classList.add('visible');
    countdownEl.textContent = n;

    const interval = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(interval);
        countdownEl.classList.remove('visible');
        resolve();
      } else {
        countdownEl.textContent = n;
      }
    }, 1000);
  });
}

function capturePhoto() {
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;

  const ctx = canvas.getContext('2d');
  ctx.filter = currentFilter.css || 'none';

  // Mirror the image to match the live preview
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  capturedPhotos.push(canvas.toDataURL('image/jpeg', 0.92));
  triggerFlash();
}

function triggerFlash() {
  flashEl.classList.add('flash');
  setTimeout(() => flashEl.classList.remove('flash'), 250);
}

function retakeLast() {
  if (capturedPhotos.length === 0) return;
  capturedPhotos.pop();
  updateShotCounter();
  renderPreview();
}

function clearPhotos() {
  capturedPhotos = [];
  updateShotCounter();
  renderPreview();
}

// ── UI State ─────────────────────────────────

function updateShotCounter() {
  const needed = currentLayout.count;
  shotCounterEl.textContent = `${capturedPhotos.length} / ${needed} photos`;

  const done = capturedPhotos.length >= needed;
  btnCapture.disabled = done || isShooting;
  btnRetake.disabled  = capturedPhotos.length === 0 || isShooting;

  if (done) {
    btnCapture.textContent = '✓ Done! Download below';
    btnCapture.style.background = 'linear-gradient(135deg, #34d399, #059669)';
  } else {
    btnCapture.textContent = capturedPhotos.length === 0 ? '📸 Start shooting' : '📸 Next photo';
    btnCapture.style.background = '';
  }
}

// ── Collage Preview ──────────────────────────

function renderPreview() {
  if (capturedPhotos.length === 0) {
    collagePreview.innerHTML = '<div class="empty-strip">No photos yet — hit "Start shooting" to begin!</div>';
    return;
  }

  const l = currentLayout;

  if (l.id === 'strip') {
    renderStrip();
  } else {
    renderGrid(l);
  }
}

function renderStrip() {
  const strip = document.createElement('div');
  strip.className = 'photo-strip';

  capturedPhotos.forEach((src, i) => {
    const img = document.createElement('img');
    img.className = 'strip-photo';
    img.src = src;
    img.alt = `Photo ${i + 1}`;
    strip.appendChild(img);
  });

  collagePreview.innerHTML = '';
  collagePreview.appendChild(strip);
}

function renderGrid(layout) {
  const cellSize   = Math.floor(400 / layout.cols);
  const cellHeight = Math.floor(cellSize * 0.75);

  const grid = document.createElement('div');
  grid.className = 'collage-grid';
  grid.style.gridTemplateColumns = `repeat(${layout.cols}, ${cellSize}px)`;
  grid.style.gridTemplateRows    = `repeat(${layout.rows}, ${cellHeight}px)`;

  for (let i = 0; i < layout.cols * layout.rows; i++) {
    if (capturedPhotos[i]) {
      const img = document.createElement('img');
      img.className = 'collage-photo';
      img.src = capturedPhotos[i];
      img.alt = `Photo ${i + 1}`;
      grid.appendChild(img);
    } else {
      const empty = document.createElement('div');
      empty.className = 'collage-empty-cell';
      empty.textContent = '+';
      grid.appendChild(empty);
    }
  }

  collagePreview.innerHTML = '';
  collagePreview.appendChild(grid);
}

// ── Download ─────────────────────────────────

function downloadCollage() {
  if (capturedPhotos.length === 0) {
    alert('Take some photos first!');
    return;
  }

  const l   = currentLayout;
  const PAD = 10;
  const LABEL_H = 28;

  let totalW, totalH, cellW, cellH;

  if (l.id === 'strip') {
    cellW  = 120;
    cellH  = 90;
    totalW = cellW + PAD * 2;
    totalH = cellH * l.count + PAD * 2 + (l.count - 1) * 4 + LABEL_H;
  } else {
    cellW  = 200;
    cellH  = 150;
    totalW = cellW * l.cols + PAD * 2 + (l.cols - 1) * 4;
    totalH = cellH * l.rows + PAD * 2 + (l.rows - 1) * 4 + LABEL_H;
  }

  finalCanvas.width  = totalW;
  finalCanvas.height = totalH;

  const ctx = finalCanvas.getContext('2d');
  ctx.fillStyle = '#1a0a24';
  ctx.fillRect(0, 0, totalW, totalH);

  const photosToRender = capturedPhotos.slice(0, l.count);

  const loadPromises = photosToRender.map((src, i) => {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        let x, y, w, h;

        if (l.id === 'strip') {
          x = PAD;
          y = PAD + i * (cellH + 4);
          w = cellW;
          h = cellH;
        } else {
          const col = i % l.cols;
          const row = Math.floor(i / l.cols);
          x = PAD + col * (cellW + 4);
          y = PAD + row * (cellH + 4);
          w = cellW;
          h = cellH;
        }

        ctx.drawImage(img, x, y, w, h);
        resolve();
      };
      img.src = src;
    });
  });

  Promise.all(loadPromises).then(() => {
    // Date stamp
    const date = new Date().toLocaleDateString();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`✦ photobooth · ${date} ✦`, totalW / 2, totalH - 10);

    // Trigger download
    const link = document.createElement('a');
    link.download = `photobooth-${Date.now()}.jpg`;
    link.href = finalCanvas.toDataURL('image/jpeg', 0.95);
    link.click();
  });
}

// ── Start ────────────────────────────────────

init();