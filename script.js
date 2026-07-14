/* ============================================================
   script.js  —  Camera, UI, Capture, Collage, Download
   Depends on: filters.js (PhotoboothGL, AESTHETIC_FILTERS)
   ============================================================ */

'use strict';

// ── Config ───────────────────────────────────────────────────

const LAYOUTS = [
  { id: 'strip', label: 'Strip', cols: 1, rows: 4, count: 4 },
  { id: '2x2',   label: '2×2',  cols: 2, rows: 2, count: 4 },
  { id: '2x3',   label: '2×3',  cols: 2, rows: 3, count: 6 },
  { id: '2x4',   label: '2×4',  cols: 2, rows: 4, count: 8 },
  { id: '6ph',   label: '6 ph', cols: 3, rows: 2, count: 6 },
];

const TIMERS = [
  { value: 3,  label: '3s' },
  { value: 5,  label: '5s' },
  { value: 10, label: '10s' },
];

// ── State ────────────────────────────────────────────────────

let glEngine       = null;    // PhotoboothGL instance
let stream         = null;
let currentLayout  = LAYOUTS[0];
let timerDelay     = 3;
let capturedPhotos = [];
let liveClips      = [];
let isShooting     = false;

// ── DOM Refs ─────────────────────────────────────────────────

const video           = document.getElementById('video');
const glCanvas        = document.getElementById('glCanvas');
const placeholder     = document.getElementById('placeholder');
const cameraBar       = document.getElementById('cameraBar');
const overlayCanvas   = document.getElementById('overlay-canvas');
const overlayCtx      = overlayCanvas.getContext('2d');
const countdownEl     = document.getElementById('countdown');
const flashEl         = document.getElementById('flash');
const shotCounterEl   = document.getElementById('shotCounter');
const btnCapture      = document.getElementById('btnCapture');
const btnRetake       = document.getElementById('btnRetake');
const btnStart        = document.getElementById('btnStart');
const btnClear        = document.getElementById('btnClear');
const btnDownload     = document.getElementById('btnDownload');
const btnDownloadLive = document.getElementById('btnDownloadLive');
const btnDownloadBoth = document.getElementById('btnDownloadBoth');
const finalCanvas     = document.getElementById('final-canvas');
const collagePreview  = document.getElementById('collagePreview');
const livePreview     = document.getElementById('livePreview');
const processingToast = document.getElementById('processingToast');
const processingMsg   = document.getElementById('processingMsg');

// ── Init ─────────────────────────────────────────────────────

function init() {
  buildLayouts();
  buildTimers();
  buildFilters();
  renderPreview();
  renderLivePreview();

  btnStart.addEventListener('click',    startCamera);
  btnCapture.addEventListener('click',  startCapture);
  btnRetake.addEventListener('click',   retakeLast);
  btnClear.addEventListener('click',    clearPhotos);
  btnDownload.addEventListener('click', downloadCollage);
  btnDownloadLive.addEventListener('click', downloadAllLiveClips);
  btnDownloadBoth.addEventListener('click', downloadBoth);
}

// ── Layout Builder ───────────────────────────────────────────

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

// ── Timer Builder ────────────────────────────────────────────

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

// ── Filter Builder ───────────────────────────────────────────

function buildFilters() {
  const container = document.getElementById('filterGrid');
  container.innerHTML = '';

  AESTHETIC_FILTERS.forEach((filter, i) => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (i === 0 ? ' active' : '');
    btn.setAttribute('aria-label', `Filter: ${filter.label}`);
    btn.innerHTML = `<span class="filter-icon">${filter.icon}</span>${filter.label}`;

    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (glEngine) glEngine.setFilter(filter);
    });

    container.appendChild(btn);
  });
}

// ── Camera ───────────────────────────────────────────────────

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });

    video.srcObject = stream;
    placeholder.style.display = 'none';

    video.addEventListener('loadedmetadata', () => {
      const w = video.videoWidth  || 1280;
      const h = video.videoHeight || 960;

      // Size both canvases to match the video
      glCanvas.width  = w;
      glCanvas.height = h;
      overlayCanvas.width  = w;
      overlayCanvas.height = h;

      // Init WebGL engine
      glEngine = new PhotoboothGL(glCanvas, video);
      glEngine.setFilter(AESTHETIC_FILTERS[0]);
      glEngine.start();

      glCanvas.style.display = 'block';
      cameraBar.style.display = 'flex';

      startParticleAnimation();
      updateShotCounter();
    });

    // Kick off video playback
    video.play().catch(() => {});

  } catch (err) {
    const msg = placeholder.querySelector('p');
    msg.textContent = 'Camera access denied. Allow camera permission and reload.';
    console.error('Camera error:', err);
  }
}

// ── Particle Animation ───────────────────────────────────────

const PARTICLE_EMOJIS = ['', '', '', '', '', '', '', ''];
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

      if (p.life <= 0 || p.y < -0.1) { particles.splice(i, 1); continue; }

      overlayCtx.globalAlpha = p.life;
      overlayCtx.font = `${p.size}px serif`;
      overlayCtx.fillText(p.emoji, p.x * overlayCanvas.width, p.y * overlayCanvas.height);
      overlayCtx.globalAlpha = 1;
    }

    requestAnimationFrame(draw);
  }
  draw();
}

// ── Capture Flow ─────────────────────────────────────────────

async function startCapture() {
  if (isShooting) return;
  isShooting = true;
  btnCapture.disabled = true;
  btnRetake.disabled  = true;

  await runCountdown();
  capturePhoto();
  renderPreview();

  if (canCaptureLiveMoment()) {
    showToast('Saving your 2.5 second live moment…');
    try {
      liveClips.push(await recordLiveMoment());
      renderLivePreview();
    } catch (error) {
      console.error('Live moment error:', error);
    } finally {
      hideToast();
    }
  }

  isShooting = false;
  updateShotCounter();
}

function canCaptureLiveMoment() {
  return typeof MediaRecorder !== 'undefined' &&
    Boolean((glEngine && glEngine.gl && glCanvas.captureStream) || video.captureStream);
}

function getSupportedVideoType() {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function recordLiveMoment() {
  const source = glEngine && glEngine.gl && glCanvas.captureStream ? glCanvas : video;
  const captureStream = source.captureStream(30);
  const mimeType = getSupportedVideoType();
  const pixels = (source.width || video.videoWidth || 1280) * (source.height || video.videoHeight || 960);
  const recorder = new MediaRecorder(captureStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: Math.min(14000000, Math.max(4000000, pixels * 5)),
  });
  const chunks = [];

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => reject(recorder.error || new Error('Unable to record live moment'));
    recorder.onstop = () => {
      captureStream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      if (!blob.size) { reject(new Error('Live moment was empty')); return; }
      resolve({ blob, url: URL.createObjectURL(blob), type: blob.type });
    };
    recorder.start(250);
    setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 2500);
  });
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
  // captureFrame() reads directly from the WebGL framebuffer —
  // the filter is already baked in, no extra processing needed.
  const dataUrl = glEngine && glEngine.gl
    ? glEngine.captureFrame()
    : fallbackCapture();

  capturedPhotos.push(dataUrl);
  triggerFlash();
}

// Fallback for browsers without WebGL (draws video to 2D canvas)
// PNG used — lossless, no compression artifacts.
function fallbackCapture() {
  const w = video.videoWidth  || 640;
  const h = video.videoHeight || 480;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/png');
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
  liveClips.forEach(clip => URL.revokeObjectURL(clip.url));
  liveClips = [];
  updateShotCounter();
  renderPreview();
  renderLivePreview();
}

// ── Toast ─────────────────────────────────────────────────────

function showToast(msg) {
  processingMsg.textContent = msg;
  processingToast.classList.add('visible');
}
function hideToast() {
  processingToast.classList.remove('visible');
}

// ── UI State ─────────────────────────────────────────────────

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
    btnCapture.textContent = capturedPhotos.length === 0 ? 'Start shooting' : ' Next photo';
    btnCapture.style.background = '';
  }
}

// ── Collage Preview ──────────────────────────────────────────

function renderPreview() {
  if (capturedPhotos.length === 0) {
    collagePreview.innerHTML = '<div class="empty-strip">No photos yet — hit "Start shooting" to begin!</div>';
    return;
  }

  currentLayout.id === 'strip' ? renderStrip() : renderGrid(currentLayout);
}

function renderLivePreview() {
  livePreview.innerHTML = '';
  if (!liveClips.length) {
    livePreview.innerHTML = '<p class="live-empty">Your live moments will appear here.</p>';
    return;
  }

  liveClips.forEach((clip, index) => {
    const card = document.createElement('article');
    card.className = 'live-clip-card';

    const media = document.createElement('video');
    media.src = clip.url;
    media.muted = true;
    media.loop = true;
    media.autoplay = true;
    media.playsInline = true;
    media.setAttribute('aria-label', `Live moment ${index + 1}`);

    const download = document.createElement('button');
    download.className = 'btn-live-download';
    download.type = 'button';
    download.textContent = 'Download live';
    download.addEventListener('click', () => downloadLiveClip(clip, index));

    card.append(media, download);
    livePreview.appendChild(card);
  });
}

function downloadLiveClip(clip, index) {
  const link = document.createElement('a');
  link.href = clip.url;
  link.download = `photobooth-live-${index + 1}-${Date.now()}.webm`;
  link.click();
}

function downloadAllLiveClips() {
  if (!liveClips.length) { alert('Take a photo first to create a live moment.'); return; }
  liveClips.forEach((clip, index) => {
    setTimeout(() => downloadLiveClip(clip, index), index * 180);
  });
}

function downloadBoth() {
  if (!capturedPhotos.length && !liveClips.length) {
    alert('Take a photo first!');
    return;
  }
  if (capturedPhotos.length) downloadCollage();
  if (liveClips.length) downloadAllLiveClips();
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

// ── Download ─────────────────────────────────────────────────

/*
 * downloadCollage
 * Builds the final image at FULL NATIVE RESOLUTION — each captured
 * photo keeps its original camera pixel dimensions, scaled only by
 * a single uniform "fitScale" so it's never stretched or distorted.
 * Output is PNG (lossless) — no re-compression, no quality loss.
 *
 * Steps:
 * 1. Pre-load every photo to read its real width/height.
 * 2. Use the FIRST photo's dimensions as the reference cell size —
 *    all captures share the same camera resolution, so this is
 *    accurate and guarantees uniform, undistorted cells.
 * 3. Draw each photo at that native size into its grid position.
 *    No forced resize — drawImage uses source-equals-destination
 *    dimensions, so pixels map 1:1.
 */
function downloadCollage() {
  if (capturedPhotos.length === 0) { alert('Take some photos first!'); return; }

  const l    = currentLayout;
  const GAP  = 6;     // gap between photos, scaled with resolution below
  const PAD  = 14;    // outer padding
  const photosToRender = capturedPhotos.slice(0, l.count);

  showToast('Preparing full-quality download…');

  // Step 1 — preload all images to get their native pixel dimensions
  const loadedImages = [];
  const loadPromises = photosToRender.map((src, i) =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = () => { loadedImages[i] = img; resolve(); };
      img.src = src;
    })
  );

  Promise.all(loadPromises).then(() => {
    // Step 2 — reference cell = native resolution of the first photo
    const refImg = loadedImages[0];
    const cellW  = refImg.naturalWidth;
    const cellH  = refImg.naturalHeight;

    // Scale gap/padding proportionally so high-res photos don't get
    // a comically thin border relative to their size
    const scaleFactor = cellW / 400;            // 400 was the old reference width
    const gap = Math.round(GAP * scaleFactor);
    const pad = Math.round(PAD * scaleFactor);
    const labelH = Math.round(34 * scaleFactor);

    let totalW, totalH;
    if (l.id === 'strip') {
      totalW = cellW + pad * 2;
      totalH = cellH * l.count + pad * 2 + gap * (l.count - 1) + labelH;
    } else {
      totalW = cellW * l.cols + pad * 2 + gap * (l.cols - 1);
      totalH = cellH * l.rows + pad * 2 + gap * (l.rows - 1) + labelH;
    }

    finalCanvas.width  = totalW;
    finalCanvas.height = totalH;

    const ctx = finalCanvas.getContext('2d');
    // Disable smoothing so any necessary scaling stays crisp (shouldn't
    // be needed here since cellW/cellH match native size exactly)
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#1a1e24';
    ctx.fillRect(0, 0, totalW, totalH);

    // Step 3 — draw each photo at native size, no stretching
    loadedImages.forEach((img, i) => {
      let x, y;
      if (l.id === 'strip') {
        x = pad;
        y = pad + i * (cellH + gap);
      } else {
        const col = i % l.cols;
        const row = Math.floor(i / l.cols);
        x = pad + col * (cellW + gap);
        y = pad + row * (cellH + gap);
      }
      // Source and destination dimensions match exactly — 1:1 pixel draw
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, y, cellW, cellH);
    });

    // Date stamp, scaled with resolution
    const date = new Date().toLocaleDateString();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `${Math.round(13 * scaleFactor)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${date}`, totalW / 2, totalH - pad / 2);

    // PNG export — lossless, exact pixels, no recompression
    // Blob export avoids holding another large base64 copy in memory. PNG
    // remains lossless and the canvas keeps every native camera pixel.
    finalCanvas.toBlob(blob => {
      if (!blob) { hideToast(); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `photobooth-${Date.now()}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      hideToast();
    }, 'image/png');
  });
}

// ── Start ─────────────────────────────────────────────────────

init();
