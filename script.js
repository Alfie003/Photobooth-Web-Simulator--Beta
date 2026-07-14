/* ============================================================
   script.js  —  Camera, UI, Capture, Collage, Download
   Depends on: filters.js (PhotoboothGL, AESTHETIC_FILTERS)

   Key behaviours:
   - Strip layout only: live moments recorded + section shown
   - Strip preview: V-mirror (alternating horizontal flip per photo)
   - Download Still: always available
   - Download Live / Both: only shown when layout === strip
   - PNG export at native camera resolution — zero re-compression
   ============================================================ */

'use strict';

// ── Layouts ──────────────────────────────────────────────────
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

// ── State ─────────────────────────────────────────────────────
let glEngine       = null;
let stream         = null;
let currentLayout  = LAYOUTS[0];   // default: strip
let timerDelay     = 3;
let capturedPhotos = [];
let liveClips      = [];
let isShooting     = false;

// ── DOM ───────────────────────────────────────────────────────
const video             = document.getElementById('video');
const glCanvas          = document.getElementById('glCanvas');
const placeholder       = document.getElementById('placeholder');
const cameraBar         = document.getElementById('cameraBar');
const overlayCanvas     = document.getElementById('overlay-canvas');
const overlayCtx        = overlayCanvas.getContext('2d');
const countdownEl       = document.getElementById('countdown');
const flashEl           = document.getElementById('flash');
const shotCounterEl     = document.getElementById('shotCounter');
const btnCapture        = document.getElementById('btnCapture');
const btnRetake         = document.getElementById('btnRetake');
const btnStart          = document.getElementById('btnStart');
const btnClear          = document.getElementById('btnClear');
const btnDownload       = document.getElementById('btnDownload');
const btnDownloadLive   = document.getElementById('btnDownloadLive');
const btnDownloadBoth   = document.getElementById('btnDownloadBoth');
const finalCanvas       = document.getElementById('final-canvas');
const collagePreview    = document.getElementById('collagePreview');
const livePreview       = document.getElementById('livePreview');
const processingToast   = document.getElementById('processingToast');
const processingMsg     = document.getElementById('processingMsg');
const liveMomentsSection = document.getElementById('liveMomentsSection');

// ── Init ──────────────────────────────────────────────────────
function init() {
  buildLayouts();
  buildTimers();
  buildFilters();
  renderPreview();
  renderLivePreview();
  syncStripOnlyUI();

  btnStart.addEventListener('click',          startCamera);
  btnCapture.addEventListener('click',        startCapture);
  btnRetake.addEventListener('click',         retakeLast);
  btnClear.addEventListener('click',          clearPhotos);
  btnDownload.addEventListener('click',       downloadCollage);
  btnDownloadLive.addEventListener('click',   downloadAllLiveClips);
  btnDownloadBoth.addEventListener('click',   downloadBoth);
}

// ── Sync strip-only elements ──────────────────────────────────
/*
 * Live Moments section, Live and Both download buttons are only
 * meaningful when the strip layout is active. This function
 * shows/hides them whenever the layout changes.
 */
function syncStripOnlyUI() {
  const isStrip = currentLayout.id === 'strip';
  liveMomentsSection.style.display  = isStrip ? '' : 'none';
  btnDownloadLive.style.display     = isStrip ? '' : 'none';
  btnDownloadBoth.style.display     = isStrip ? '' : 'none';
}

// ── Layout Builder ────────────────────────────────────────────
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
      syncStripOnlyUI();
      updateShotCounter();
      renderPreview();
    });

    grid.appendChild(btn);
  });
}

// ── Timer Builder ─────────────────────────────────────────────
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

// ── Filter Builder ────────────────────────────────────────────
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

// ── Camera ────────────────────────────────────────────────────
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

      glCanvas.width        = w;
      glCanvas.height       = h;
      overlayCanvas.width   = w;
      overlayCanvas.height  = h;

      glEngine = new PhotoboothGL(glCanvas, video);
      glEngine.setFilter(AESTHETIC_FILTERS[0]);
      glEngine.start();

      glCanvas.style.display = 'block';
      cameraBar.style.display = 'flex';

      startParticleAnimation();
      updateShotCounter();
    });

    video.play().catch(() => {});

  } catch (err) {
    const msg = placeholder.querySelector('p');
    if (msg) msg.textContent = 'Camera access denied. Allow camera permission and reload.';
    console.error('Camera error:', err);
  }
}

// ── Particle Animation ────────────────────────────────────────
const PARTICLE_EMOJIS = ['','','','','','','',''];
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
      p.x += p.vx; p.y += p.vy; p.life -= p.decay;
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

// ── Capture Flow ──────────────────────────────────────────────
async function startCapture() {
  if (isShooting) return;
  isShooting = true;
  btnCapture.disabled = true;
  btnRetake.disabled  = true;

  await runCountdown();
  capturePhoto();
  renderPreview();

  // Live moments: only record for strip layout
  if (currentLayout.id === 'strip' && canCaptureLiveMoment()) {
    showToast('Saving 2.5 sec live moment…');
    try {
      liveClips.push(await recordLiveMoment());
      renderLivePreview();
    } catch (err) {
      console.error('Live moment error:', err);
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
  const types = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function recordLiveMoment() {
  const source = (glEngine && glEngine.gl && glCanvas.captureStream) ? glCanvas : video;
  const captureStream = source.captureStream(30);
  const mimeType = getSupportedVideoType();
  const pixels = (source.width || video.videoWidth || 1280) * (source.height || video.videoHeight || 960);
  const recorder = new MediaRecorder(captureStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: Math.min(14_000_000, Math.max(4_000_000, pixels * 5)),
  });
  const chunks = [];

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = () => reject(recorder.error || new Error('Recording failed'));
    recorder.onstop = () => {
      captureStream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      if (!blob.size) { reject(new Error('Empty live moment')); return; }
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
    const iv = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(iv); countdownEl.classList.remove('visible'); resolve(); }
      else countdownEl.textContent = n;
    }, 1000);
  });
}

function capturePhoto() {
  const dataUrl = (glEngine && glEngine.gl)
    ? glEngine.captureFrame()
    : fallbackCapture();
  capturedPhotos.push(dataUrl);
  triggerFlash();
}

function fallbackCapture() {
  const w = video.videoWidth || 640;
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
  // Also remove the matching live clip if strip
  if (currentLayout.id === 'strip' && liveClips.length > capturedPhotos.length) {
    const removed = liveClips.pop();
    if (removed) URL.revokeObjectURL(removed.url);
    renderLivePreview();
  }
  updateShotCounter();
  renderPreview();
}

function clearPhotos() {
  capturedPhotos = [];
  liveClips.forEach(c => URL.revokeObjectURL(c.url));
  liveClips = [];
  updateShotCounter();
  renderPreview();
  renderLivePreview();
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg) {
  processingMsg.textContent = msg;
  processingToast.classList.add('visible');
}
function hideToast() {
  processingToast.classList.remove('visible');
}

// ── UI State ───────────────────────────────────────────────────
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
    btnCapture.textContent = capturedPhotos.length === 0 ? 'Start shooting' : 'Next photo';
    btnCapture.style.background = '';
  }
}

// ── Collage Preview ────────────────────────────────────────────
function renderPreview() {
  if (capturedPhotos.length === 0) {
    collagePreview.innerHTML = '<div class="empty-strip">No photos yet — choose a layout and start shooting!</div>';
    return;
  }
  currentLayout.id === 'strip' ? renderStrip() : renderGrid(currentLayout);
}

/*
 * renderStrip — V-mirror effect
 * Photos at index 0, 2, 4… (1st, 3rd…) are displayed normally.
 * Photos at index 1, 3, 5… (2nd, 4th…) are horizontally flipped
 * via the CSS class .mirror-flip → transform: scaleX(-1).
 * This creates the V / mirror-image strip look.
 */
function renderStrip() {
  const strip = document.createElement('div');
  strip.className = 'photo-strip';

  capturedPhotos.forEach((src, i) => {
    const img = document.createElement('img');
    img.className = 'strip-photo' + (i % 2 === 1 ? ' mirror-flip' : '');
    img.src = src;
    img.alt = `Photo ${i + 1}`;
    strip.appendChild(img);
  });

  collagePreview.innerHTML = '';
  collagePreview.appendChild(strip);
}

function renderGrid(layout) {
  const cellSize   = Math.floor(360 / layout.cols);
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

// ── Live Preview ───────────────────────────────────────────────
function renderLivePreview() {
  livePreview.innerHTML = '';
  if (!liveClips.length) {
    livePreview.innerHTML = '<p class="live-empty">Your live moments will appear here after taking strip photos.</p>';
    return;
  }
  liveClips.forEach((clip, index) => {
    const card  = document.createElement('article');
    card.className = 'live-clip-card';

    const media = document.createElement('video');
    media.src     = clip.url;
    media.muted   = true;
    media.loop    = true;
    media.autoplay= true;
    media.playsInline = true;
    media.setAttribute('aria-label', `Live moment ${index + 1}`);

    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn-live-download';
    dlBtn.type = 'button';
    dlBtn.textContent = 'Save';
    dlBtn.addEventListener('click', () => downloadLiveClip(clip, index));

    card.append(media, dlBtn);
    livePreview.appendChild(card);
  });
}

// ── Download ───────────────────────────────────────────────────

/*
 * downloadCollage — "Download Still"
 * Builds the final collage at FULL NATIVE camera resolution.
 * For the strip layout, odd-indexed photos (2nd, 4th) are drawn
 * with a horizontal flip on the export canvas (matching the preview).
 * Output: lossless PNG via Blob URL — zero re-compression.
 */
function downloadCollage() {
  if (capturedPhotos.length === 0) { alert('Take some photos first!'); return; }

  const l   = currentLayout;
  const GAP = 6;
  const PAD = 14;
  const photosToRender = capturedPhotos.slice(0, l.count);

  showToast('Preparing full-quality still…');

  const loadedImages = [];
  Promise.all(
    photosToRender.map((src, i) => new Promise(res => {
      const img = new Image();
      img.onload = () => { loadedImages[i] = img; res(); };
      img.src = src;
    }))
  ).then(() => {
    const refImg = loadedImages[0];
    const cellW  = refImg.naturalWidth;
    const cellH  = refImg.naturalHeight;

    const scale   = cellW / 400;
    const gap     = Math.round(GAP * scale);
    const pad     = Math.round(PAD * scale);
    const labelH  = Math.round(28 * scale);

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
    ctx.imageSmoothingEnabled = false;

    // Dark background
    ctx.fillStyle = '#1a1e24';
    ctx.fillRect(0, 0, totalW, totalH);

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

      // V-mirror: flip even-indexed (0-based) photos horizontally on export canvas
      if (l.id === 'strip' && i % 2 === 1) {
        ctx.save();
        ctx.translate(x + cellW, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, cellW, cellH);
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, y, cellW, cellH);
      }
    });

    // Date stamp
    const date = new Date().toLocaleDateString();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.round(12 * scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(date, totalW / 2, totalH - Math.round(8 * scale));

    // Blob export — lossless PNG, avoids base64 memory overhead
    finalCanvas.toBlob(blob => {
      if (!blob) { hideToast(); return; }
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `photobooth-still-${Date.now()}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      hideToast();
    }, 'image/png');
  });
}

function downloadLiveClip(clip, index) {
  const ext  = clip.type.includes('mp4') ? 'mp4' : 'webm';
  const link = document.createElement('a');
  link.href  = clip.url;
  link.download = `photobooth-live-${index + 1}-${Date.now()}.${ext}`;
  link.click();
}

function downloadAllLiveClips() {
  if (!liveClips.length) { alert('Take some strip photos first to generate live moments.'); return; }
  liveClips.forEach((clip, i) => setTimeout(() => downloadLiveClip(clip, i), i * 200));
}

function downloadBoth() {
  if (!capturedPhotos.length && !liveClips.length) { alert('Take some photos first!'); return; }
  if (capturedPhotos.length) downloadCollage();
  if (liveClips.length)      setTimeout(downloadAllLiveClips, 300);
}

// ── Start ──────────────────────────────────────────────────────
init();
