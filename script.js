/* ============================================================
   script.js — Photobooth Studio (v7)
   Depends on: filters.js (PhotoboothGL, AESTHETIC_FILTERS)

   Live Moments redesign:
   - At the moment of each capture, TWO frames are taken from
     the WebGL canvas / video:
       1. capturedPhotos[]  — the filtered frame (what was saved)
       2. liveFrames[]      — the same frame but horizontally
                              mirrored (what the user SAW while posing)
   - Both arrays always stay in sync — same index = same shot.
   - The preview shows two columns: Still (left) | Live (right).
   - All five layouts are supported for both columns.
   - Download Still  → PNG of the left column only
   - Download Live   → PNG of the right (mirrored) column only
   - Download Both   → single wide PNG with both columns side by side
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
let currentLayout  = LAYOUTS[0];
let timerDelay     = 3;
let capturedPhotos = [];   // filtered stills (PNG dataURLs)
let liveFrames     = [];   // mirrored frames  (PNG dataURLs)
let liveClips      = [];   // mirrored 2.5-second WebM clips for preview
let isShooting     = false;

// ── DOM ───────────────────────────────────────────────────────
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

// ── Init ──────────────────────────────────────────────────────
function init() {
  buildLayouts();
  buildTimers();
  buildFilters();
  renderBothPreviews();

  btnStart.addEventListener('click',        startCamera);
  btnCapture.addEventListener('click',      startCapture);
  btnRetake.addEventListener('click',       retakeLast);
  btnClear.addEventListener('click',        clearPhotos);
  btnDownload.addEventListener('click',     () => downloadCollage('still'));
  btnDownloadLive.addEventListener('click', () => downloadCollage('live'));
  btnDownloadBoth.addEventListener('click', () => downloadCollage('both'));
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
    const lbl = document.createElement('span');
    lbl.textContent = layout.label;
    btn.append(dotsDiv, lbl);

    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLayout = layout;
      updateShotCounter();
      renderBothPreviews();
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

      glCanvas.width = w; glCanvas.height = h;
      overlayCanvas.width = w; overlayCanvas.height = h;

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
const PARTICLE_EMOJIS = ['✨','🌸','💕','⭐','🌟','💫','🌺','💖'];
const particles = [];

function spawnParticle() {
  if (particles.length >= 12) return;
  particles.push({
    x: Math.random(), y: 1.1,
    vx: (Math.random() - 0.5) * 0.008,
    vy: -(0.004 + Math.random() * 0.006),
    emoji: PARTICLE_EMOJIS[Math.floor(Math.random() * PARTICLE_EMOJIS.length)],
    size: 14 + Math.random() * 12,
    life: 1, decay: 0.008 + Math.random() * 0.006,
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

  // Capture BOTH frames simultaneously from the same canvas state
  const [stillFrame, liveFrame] = captureBothFrames();
  capturedPhotos.push(stillFrame);
  liveFrames.push(liveFrame);

  triggerFlash();
  try {
    liveClips.push(await recordLiveClip());
  } catch (error) {
    console.error('Live preview recording failed:', error);
  }

  renderBothPreviews();

  isShooting = false;
  updateShotCounter();
}

// Records the same mirrored orientation used by the existing live frame.
// The preview plays this short clip continuously; it does not affect stills.
function recordLiveClip() {
  const source = glEngine && glEngine.gl ? glCanvas : video;
  const w = source.width || video.videoWidth || 640;
  const h = source.height || video.videoHeight || 480;
  const recordCanvas = document.createElement('canvas');
  recordCanvas.width = w;
  recordCanvas.height = h;
  const ctx = recordCanvas.getContext('2d');
  let frameId;

  const drawMirroredFrame = () => {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0, w, h);
    ctx.restore();
    frameId = requestAnimationFrame(drawMirroredFrame);
  };
  drawMirroredFrame();

  const clipStream = recordCanvas.captureStream(30);
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(type => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(clipStream, mimeType ? { mimeType } : undefined);
  const chunks = [];

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(recorder.error || new Error('Unable to record live preview'));
    recorder.onstop = () => {
      cancelAnimationFrame(frameId);
      clipStream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      if (!blob.size) { reject(new Error('Live preview was empty')); return; }
      resolve(URL.createObjectURL(blob));
    };
    recorder.start(250);
    setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 2500);
  });
}

/*
 * captureBothFrames()
 * Called once per shot. Reads the WebGL canvas (or raw video as fallback)
 * ONCE and produces two PNG dataURLs:
 *   [0] still  — the filtered frame as-is (already mirrored by GLSL vertex shader)
 *   [1] live   — same source but horizontally flipped again on a 2D canvas,
 *                restoring the "what you saw in the preview" orientation
 *
 * This way both frames come from the identical pixel state — zero drift.
 */
function captureBothFrames() {
  const source = (glEngine && glEngine.gl) ? glCanvas : null;
  const w = source ? source.width  : (video.videoWidth  || 640);
  const h = source ? source.height : (video.videoHeight || 480);

  // ── Borrow one extra draw call so the canvas is fully up to date ──
  if (glEngine && glEngine.gl) glEngine._drawFrame();

  // Still frame — drawn 1:1 from the source
  const stillCanvas = document.createElement('canvas');
  stillCanvas.width = w; stillCanvas.height = h;
  const sCtx = stillCanvas.getContext('2d');
  if (source) {
    sCtx.drawImage(source, 0, 0, w, h);
  } else {
    // Fallback: video is un-mirrored, mirror it to match the WebGL preview
    sCtx.translate(w, 0); sCtx.scale(-1, 1);
    sCtx.drawImage(video, 0, 0, w, h);
  }

  // Live (mirror) frame — horizontally flip the still canvas
  const liveCanvas = document.createElement('canvas');
  liveCanvas.width = w; liveCanvas.height = h;
  const lCtx = liveCanvas.getContext('2d');
  lCtx.translate(w, 0);
  lCtx.scale(-1, 1);
  lCtx.drawImage(stillCanvas, 0, 0, w, h);

  return [
    stillCanvas.toDataURL('image/png'),
    liveCanvas.toDataURL('image/png'),
  ];
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

function triggerFlash() {
  flashEl.classList.add('flash');
  setTimeout(() => flashEl.classList.remove('flash'), 250);
}

function retakeLast() {
  if (capturedPhotos.length === 0) return;
  capturedPhotos.pop();
  liveFrames.pop();
  const lastLiveClip = liveClips.pop();
  if (lastLiveClip) URL.revokeObjectURL(lastLiveClip);
  updateShotCounter();
  renderBothPreviews();
}

function clearPhotos() {
  capturedPhotos = [];
  liveFrames     = [];
  liveClips.forEach(url => URL.revokeObjectURL(url));
  liveClips = [];
  updateShotCounter();
  renderBothPreviews();
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg) { processingMsg.textContent = msg; processingToast.classList.add('visible'); }
function hideToast()    { processingToast.classList.remove('visible'); }

// ── UI State ───────────────────────────────────────────────────
function updateShotCounter() {
  const needed = currentLayout.count;
  shotCounterEl.textContent = `${capturedPhotos.length} / ${needed} photos`;

  const done = capturedPhotos.length >= needed;
  btnCapture.disabled = done || isShooting;
  btnRetake.disabled  = capturedPhotos.length === 0 || isShooting;

  if (done) {
    btnCapture.textContent = '✓ Done! Download below';
    btnCapture.style.background = 'linear-gradient(135deg,#34d399,#059669)';
  } else {
    btnCapture.textContent = capturedPhotos.length === 0 ? 'Start shooting' : 'Next photo';
    btnCapture.style.background = '';
  }
}

// ── Preview Rendering ──────────────────────────────────────────

/*
 * renderBothPreviews()
 * Renders the Still column (left) and Live column (right) independently,
 * using the same layout logic. The only difference is the source array
 * and whether the live-mirror CSS class is applied.
 */
function renderBothPreviews() {
  renderColumn(collagePreview, capturedPhotos, false);
  renderLiveColumn(livePreview, liveClips);
}

function renderLiveColumn(container, clips) {
  if (!clips.length) {
    container.innerHTML = '<div class="empty-strip">Live moments will appear here</div>';
    return;
  }

  const l = currentLayout;
  const holder = document.createElement('div');
  holder.className = l.id === 'strip' || l.cols === 1 ? 'photo-strip' : 'collage-grid';
  if (l.cols > 1) {
    holder.style.gridTemplateColumns = `repeat(${l.cols}, 1fr)`;
    holder.style.gridTemplateRows = `repeat(${l.rows}, auto)`;
  }

  for (let i = 0; i < l.count; i++) {
    if (clips[i]) {
      const clip = document.createElement('video');
      clip.className = l.id === 'strip' || l.cols === 1 ? 'strip-photo' : 'collage-photo';
      clip.src = clips[i];
      clip.muted = true;
      clip.autoplay = true;
      clip.loop = true;
      clip.playsInline = true;
      clip.setAttribute('loop', '');
      clip.setAttribute('playsinline', '');
      clip.setAttribute('aria-label', `Live moment ${i + 1}`);
      holder.appendChild(clip);
    } else if (l.cols > 1) {
      const empty = document.createElement('div');
      empty.className = 'collage-empty-cell';
      empty.textContent = '+';
      holder.appendChild(empty);
    }
  }

  container.innerHTML = '';
  container.appendChild(holder);
}

function renderColumn(container, photos, applyMirrorClass) {
  if (!photos.length) {
    container.innerHTML = '<div class="empty-strip">No photos yet</div>';
    return;
  }

  const l = currentLayout;
  if (l.id === 'strip' || l.cols === 1) {
    renderColumnStrip(container, photos, applyMirrorClass);
  } else {
    renderColumnGrid(container, photos, l, applyMirrorClass);
  }
}

function renderColumnStrip(container, photos, applyMirrorClass) {
  const strip = document.createElement('div');
  strip.className = 'photo-strip';

  photos.forEach((src, i) => {
    const img = document.createElement('img');
    img.className = 'strip-photo' + (applyMirrorClass ? ' live-mirror' : '');
    img.src = src;
    img.alt = `Photo ${i + 1}`;
    strip.appendChild(img);
  });

  container.innerHTML = '';
  container.appendChild(strip);
}

function renderColumnGrid(container, photos, layout, applyMirrorClass) {
  const grid = document.createElement('div');
  grid.className = 'collage-grid';
  // Use CSS auto to let the grid fill the column width naturally
  grid.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
  grid.style.gridTemplateRows    = `repeat(${layout.rows}, auto)`;

  for (let i = 0; i < layout.cols * layout.rows; i++) {
    if (photos[i]) {
      const img = document.createElement('img');
      img.className = 'collage-photo' + (applyMirrorClass ? ' live-mirror' : '');
      img.src = photos[i];
      img.alt = `Photo ${i + 1}`;
      img.style.aspectRatio = '4/3';
      grid.appendChild(img);
    } else {
      const empty = document.createElement('div');
      empty.className = 'collage-empty-cell';
      empty.textContent = '+';
      grid.appendChild(empty);
    }
  }

  container.innerHTML = '';
  container.appendChild(grid);
}

// ── Download ───────────────────────────────────────────────────

/*
 * downloadCollage(mode)
 * mode: 'still' | 'live' | 'both'
 *
 * Builds a high-resolution PNG from capturedPhotos (still) and/or
 * liveFrames (live) at FULL NATIVE camera resolution.
 *
 * 'both' places the two collages side by side on a single canvas
 * with a dividing gap between them, like a diptych.
 */
function downloadCollage(mode) {
  const photos = mode === 'live' ? liveFrames : capturedPhotos;
  if (!photos.length) { alert('Take some photos first!'); return; }
  if (mode === 'live' && !liveFrames.length) { alert('No live frames yet.'); return; }

  showToast(`Preparing ${mode === 'both' ? 'combined' : mode} download…`);

  const photosToRender = capturedPhotos.slice(0, currentLayout.count);
  const liveToRender   = liveFrames.slice(0, currentLayout.count);
  const pickPhotos     = mode === 'live' ? liveToRender : photosToRender;

  // Pre-load all images needed
  const srcArrays = mode === 'both'
    ? [...photosToRender, ...liveToRender]
    : pickPhotos;

  const loaded = {};
  Promise.all(srcArrays.map((src, i) => new Promise(res => {
    const img = new Image();
    img.onload = () => { loaded[i] = img; res(); };
    img.src = src;
  }))).then(() => {
    const refImg = loaded[0];
    const cellW  = refImg.naturalWidth;
    const cellH  = refImg.naturalHeight;
    const l      = currentLayout;

    const scale  = cellW / 400;
    const GAP    = Math.round(6  * scale);
    const PAD    = Math.round(14 * scale);
    const MIDGAP = Math.round(24 * scale); // gap between still and live in "both" mode
    const LABELH = Math.round(28 * scale);

    // Compute single-collage dimensions
    function singleDims() {
      if (l.id === 'strip' || l.cols === 1) {
        return {
          w: cellW + PAD * 2,
          h: cellH * l.count + PAD * 2 + GAP * (l.count - 1) + LABELH,
        };
      }
      return {
        w: cellW * l.cols + PAD * 2 + GAP * (l.cols - 1),
        h: cellH * l.rows + PAD * 2 + GAP * (l.rows - 1) + LABELH,
      };
    }

    const { w: sw, h: sh } = singleDims();

    // Total canvas size
    let totalW, totalH;
    if (mode === 'both') {
      totalW = sw * 2 + MIDGAP;
      totalH = sh;
    } else {
      totalW = sw;
      totalH = sh;
    }

    finalCanvas.width  = totalW;
    finalCanvas.height = totalH;
    const ctx = finalCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = '#1a1e24';
    ctx.fillRect(0, 0, totalW, totalH);

    // Draw a single collage block at offset (ox, oy)
    function drawBlock(imgs, ox, oy) {
      imgs.forEach((img, i) => {
        if (!img) return;
        let x, y;
        if (l.id === 'strip' || l.cols === 1) {
          x = ox + PAD;
          y = oy + PAD + i * (cellH + GAP);
        } else {
          const col = i % l.cols;
          const row = Math.floor(i / l.cols);
          x = ox + PAD + col * (cellW + GAP);
          y = oy + PAD + row * (cellH + GAP);
        }
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, y, cellW, cellH);
      });
    }

    if (mode === 'both') {
      // Left: still, Right: live
      const stillImgs = photosToRender.map((_, i) => loaded[i]);
      const liveImgs  = liveToRender.map((_, i)  => loaded[photosToRender.length + i]);
      drawBlock(stillImgs, 0, 0);
      drawBlock(liveImgs, sw + MIDGAP, 0);

      // Divider line
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth   = Math.max(1, Math.round(2 * scale));
      ctx.beginPath();
      ctx.moveTo(sw + MIDGAP / 2, PAD);
      ctx.lineTo(sw + MIDGAP / 2, sh - LABELH - PAD);
      ctx.stroke();

      // Column labels
      const labelY = sh - Math.round(9 * scale);
      ctx.fillStyle  = 'rgba(255,255,255,0.55)';
      ctx.font       = `${Math.round(12 * scale)}px system-ui, sans-serif`;
      ctx.textAlign  = 'center';
      ctx.fillText('STILL',  sw / 2, labelY);
      ctx.fillText('LIVE',   sw + MIDGAP + sw / 2, labelY);
    } else {
      const imgs = pickPhotos.map((_, i) => loaded[i]);
      drawBlock(imgs, 0, 0);

      const date = new Date().toLocaleDateString();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font      = `${Math.round(11 * scale)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(date, totalW / 2, totalH - Math.round(7 * scale));
    }

    const suffix = mode === 'both' ? 'both' : mode === 'live' ? 'live' : 'still';
    finalCanvas.toBlob(blob => {
      if (!blob) { hideToast(); return; }
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `photobooth-${suffix}-${Date.now()}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      hideToast();
    }, 'image/png');
  });
}

// ── Start ──────────────────────────────────────────────────────
init();
