/* ═══════════════════════════════════════════════════════════
   Night Caller: A Texas Mystery — App Logic
   Web Audio API · Custom FFT · Spectrogram · Vote System
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ────────────────────────────────────────────────────────────
// CONFIGURATION
// ────────────────────────────────────────────────────────────
const CALL_TIMES    = [3, 20.5, 24.7, 33.2, 37];   // seconds
const FFT_SIZE      = 2048;                          // must be power of 2
const MAX_FREQ_HZ   = 3000;                          // display up to 3 kHz
const SPECT_COLS    = 700;                           // spectrogram columns
const FILTER_FREQ   = 300;                           // high-pass cutoff Hz
const AUDIO_FILE    = 'mystery_call.wav';

// ────────────────────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────────────────────
let audioCtx      = null;
let audioBuffer   = null;
let sourceNode    = null;
let gainNode      = null;
let filterNode    = null;
let isPlaying     = false;
let filterOn      = false;
let startTime     = 0;      // audioCtx.currentTime when play started
let startOffset   = 0;      // position in audio file when play started
let rafId         = null;

// ────────────────────────────────────────────────────────────
// DOM REFS
// ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const playBtn        = $('playBtn');
const playIcon       = $('playIcon');
const pauseIcon      = $('pauseIcon');
const progressTrack  = $('progressTrack');
const progressFill   = $('progressFill');
const progressThumb  = $('progressThumb');
const currentTimeEl  = $('currentTime');
const totalTimeEl    = $('totalTime');
const volSlider      = $('volSlider');
const filterBtn      = $('filterBtn');
const filterLabel    = $('filterLabel');
const spectCanvas    = $('spectCanvas');
const waveCanvas     = $('waveCanvas');
const spectOverlay   = $('spectOverlay');
const spectPlayhead  = $('spectPlayhead');
const wavePlayhead   = $('wavePlayhead');
const audioLoading   = $('audioLoading');
const audioError     = $('audioError');
const loadingStatus  = $('loadingStatus');
const spectSection   = $('spectSection');
const waveContainer  = $('waveContainer');
const playerControls = $('playerControls');
const playerExtras   = $('playerExtras');

// ════════════════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════════════════
async function init() {
  renderFrequencyChart();
  checkVoteState();
  setupSuspectKeyboard();

  try {
    loadingStatus.textContent = 'Fetching ' + AUDIO_FILE + '…';
    const resp = await fetch(AUDIO_FILE);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    loadingStatus.textContent = 'Decoding audio…';
    const arrayBuf = await resp.arrayBuffer();

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioBuffer = await audioCtx.decodeAudioData(arrayBuf);

    totalTimeEl.textContent = fmtTime(audioBuffer.duration);

    setupAudioGraph();

    loadingStatus.textContent = 'Computing spectrogram…';
    await renderSpectrogram();

    renderWaveform();
    addCallMarkers();
    showPlayer();
    startRaf();

  } catch (err) {
    console.warn('Audio load failed:', err.message);
    audioLoading.style.display = 'none';
    audioError.style.display   = 'flex';
  }
}

function showPlayer() {
  audioLoading.style.display = 'none';
  spectSection.style.display = 'flex';
  waveContainer.style.display = 'block';
  playerControls.style.display = 'flex';
  playerExtras.style.display   = 'flex';
}

// ════════════════════════════════════════════════════════════
// AUDIO GRAPH
// ════════════════════════════════════════════════════════════
function setupAudioGraph() {
  gainNode   = audioCtx.createGain();
  gainNode.gain.value = parseFloat(volSlider.value);

  filterNode = audioCtx.createBiquadFilter();
  filterNode.type            = 'highpass';
  filterNode.frequency.value = 20;   // 20 Hz ≈ bypass
  filterNode.Q.value         = 0.5;

  // Chain: source → filter → gain → speakers
  filterNode.connect(gainNode);
  gainNode.connect(audioCtx.destination);
}

// ════════════════════════════════════════════════════════════
// PLAYBACK
// ════════════════════════════════════════════════════════════
function play(fromOffset) {
  if (!audioBuffer) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (sourceNode) {
    try { sourceNode.stop(); } catch(_) {}
    sourceNode.disconnect();
  }

  startOffset = (fromOffset !== undefined) ? fromOffset : startOffset;
  startOffset = Math.max(0, Math.min(startOffset, audioBuffer.duration - 0.01));

  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(filterNode);
  sourceNode.start(0, startOffset);
  startTime  = audioCtx.currentTime;
  isPlaying  = true;
  setPlayIcon(true);

  sourceNode.onended = () => {
    if (isPlaying) {   // natural end (not a seek)
      isPlaying   = false;
      startOffset = 0;
      setPlayIcon(false);
      updateProgress(0);
    }
  };
}

function pause() {
  if (!isPlaying) return;
  startOffset = currentPosition();
  try { sourceNode.stop(); } catch(_) {}
  sourceNode = null;
  isPlaying  = false;
  setPlayIcon(false);
}

function currentPosition() {
  if (!isPlaying || !audioCtx) return startOffset;
  return startOffset + (audioCtx.currentTime - startTime);
}

function seekTo(t) {
  const wasPlaying = isPlaying;
  if (isPlaying) {
    // Stop current source quietly
    isPlaying = false;
    try { sourceNode.stop(); } catch(_) {}
    sourceNode = null;
  }
  startOffset = t;
  if (wasPlaying) {
    play(t);
  } else {
    updateProgress(t / audioBuffer.duration);
  }
}

// ════════════════════════════════════════════════════════════
// ANIMATION LOOP
// ════════════════════════════════════════════════════════════
function startRaf() {
  function frame() {
    if (audioBuffer) {
      const pos  = Math.min(currentPosition(), audioBuffer.duration);
      const frac = pos / audioBuffer.duration;
      updateProgress(frac);

      const pctStr = (frac * 100).toFixed(3) + '%';
      spectPlayhead.style.left = pctStr;
      wavePlayhead.style.left  = pctStr;
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

function updateProgress(frac) {
  const pct = (frac * 100).toFixed(2) + '%';
  progressFill.style.width = pct;
  progressThumb.style.left = pct;
  if (audioBuffer) {
    currentTimeEl.textContent = fmtTime(frac * audioBuffer.duration);
  }
}

// ════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ════════════════════════════════════════════════════════════
playBtn.addEventListener('click', () => {
  if (!audioBuffer) return;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  isPlaying ? pause() : play();
});

progressTrack.addEventListener('click', e => {
  if (!audioBuffer) return;
  const rect = progressTrack.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekTo(frac * audioBuffer.duration);
});

// Touch-drag on progress bar
let dragging = false;
progressTrack.addEventListener('mousedown', () => { dragging = true; });
document.addEventListener('mousemove', e => {
  if (!dragging || !audioBuffer) return;
  const rect = progressTrack.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  updateProgress(frac);
});
document.addEventListener('mouseup', e => {
  if (!dragging || !audioBuffer) return;
  dragging = false;
  const rect = progressTrack.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekTo(frac * audioBuffer.duration);
});

// Touch drag on progress bar
let touchDragging = false;
progressTrack.addEventListener('touchstart', e => {
  if (!audioBuffer) return;
  touchDragging = true;
  const rect = progressTrack.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
  updateProgress(frac);
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchmove', e => {
  if (!touchDragging || !audioBuffer) return;
  const rect = progressTrack.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
  updateProgress(frac);
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', e => {
  if (!touchDragging || !audioBuffer) return;
  touchDragging = false;
  const rect = progressTrack.getBoundingClientRect();
  const touch = e.changedTouches[0];
  const frac = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
  seekTo(frac * audioBuffer.duration);
});

volSlider.addEventListener('input', () => {
  if (gainNode) gainNode.gain.value = parseFloat(volSlider.value);
});

filterBtn.addEventListener('click', () => {
  filterOn = !filterOn;
  filterNode.frequency.value = filterOn ? FILTER_FREQ : 20;
  filterLabel.innerHTML = filterOn
    ? 'Wind Filter: <strong>ON</strong>'
    : 'Wind Filter: <strong>OFF</strong>';
  filterBtn.classList.toggle('active', filterOn);
});

document.querySelectorAll('.jump-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = parseFloat(btn.dataset.time);
    if (!audioBuffer) return;
    document.querySelectorAll('.jump-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    seekTo(t);
    if (!isPlaying) play(t);
  });
});

// Click on spectrogram to seek
const spectContainer = $('spectContainer');
if (spectContainer) {
  spectContainer.addEventListener('click', e => {
    if (!audioBuffer) return;
    const rect = spectContainer.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(frac * audioBuffer.duration);
    if (!isPlaying) play(frac * audioBuffer.duration);
  });
}

// Click on waveform to seek
waveContainer.addEventListener('click', e => {
  if (!audioBuffer) return;
  const rect = waveContainer.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekTo(frac * audioBuffer.duration);
  if (!isPlaying) play(frac * audioBuffer.duration);
});

// ════════════════════════════════════════════════════════════
// FFT — Iterative Cooley-Tukey (in-place, power-of-2)
// ════════════════════════════════════════════════════════════
function computeFFT(re, im) {
  const n = re.length;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k],      uIm = im[i + k];
        const vRe = re[i + k + half], vIm = im[i + k + half];
        const tRe = curRe * vRe - curIm * vIm;
        const tIm = curRe * vIm + curIm * vRe;
        re[i + k]        = uRe + tRe;
        im[i + k]        = uIm + tIm;
        re[i + k + half] = uRe - tRe;
        im[i + k + half] = uIm - tIm;
        const nr = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nr;
      }
    }
  }
}

// ════════════════════════════════════════════════════════════
// WARM COLOR MAP  (0–255 → RGB)
// ════════════════════════════════════════════════════════════
function warmColor(v) {
  // black → deep red → orange-amber → yellow-white
  if (v < 50) {
    const t = v / 50;
    return [Math.round(t * 100), 0, 0];
  } else if (v < 110) {
    const t = (v - 50) / 60;
    return [100 + Math.round(t * 130), Math.round(t * 50), 0];
  } else if (v < 175) {
    const t = (v - 110) / 65;
    return [230 + Math.round(t * 25), 50 + Math.round(t * 130), Math.round(t * 20)];
  } else {
    const t = (v - 175) / 80;
    return [255, 180 + Math.round(t * 75), 20 + Math.round(t * 235)];
  }
}

// ════════════════════════════════════════════════════════════
// SPECTROGRAM RENDERING (pre-computed from AudioBuffer)
// ════════════════════════════════════════════════════════════
async function renderSpectrogram() {
  const data       = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const maxBin     = Math.floor(MAX_FREQ_HZ * FFT_SIZE / sampleRate); // ~139 bins

  const W = SPECT_COLS;
  const H = maxBin;

  spectCanvas.width  = W;
  spectCanvas.height = H;

  const ctx      = spectCanvas.getContext('2d');
  const imgData  = ctx.createImageData(W, H);
  const pixels   = imgData.data;

  // Hanning window
  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
  }

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  // First pass: collect magnitudes + find global peak
  const allMag  = [];
  let   peakMag = 1e-10;

  const CHUNK = 70;  // columns per async chunk (keeps UI responsive)
  for (let col = 0; col < W; col++) {
    const center = Math.round((col / W) * data.length);
    const start  = Math.max(0, center - FFT_SIZE / 2);

    for (let i = 0; i < FFT_SIZE; i++) {
      const s = start + i;
      re[i] = (s < data.length ? data[s] : 0) * hann[i];
      im[i] = 0;
    }
    computeFFT(re, im);

    const colMag = new Float32Array(maxBin);
    for (let b = 0; b < maxBin; b++) {
      const m = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      colMag[b] = m;
      if (m > peakMag) peakMag = m;
    }
    allMag.push(colMag);

    // Yield every CHUNK columns so the browser stays responsive
    if (col % CHUNK === CHUNK - 1) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Second pass: map to colors
  const logRef = peakMag;
  for (let col = 0; col < W; col++) {
    const colMag = allMag[col];
    for (let bin = 0; bin < maxBin; bin++) {
      // Log scale: -60 dB floor → 0 dB peak
      const dB    = 20 * Math.log10(colMag[bin] / logRef + 1e-10);
      const level = Math.max(0, Math.min(255, (dB + 60) * (255 / 60)));

      // Flip y so high freq is at the top
      const row = H - 1 - bin;
      const idx = (row * W + col) * 4;
      const [r, g, b] = warmColor(Math.round(level));
      pixels[idx]     = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// ════════════════════════════════════════════════════════════
// WAVEFORM RENDERING
// ════════════════════════════════════════════════════════════
function renderWaveform() {
  const data = audioBuffer.getChannelData(0);
  const container = waveContainer;
  const W = container.clientWidth  || 800;
  const H = container.clientHeight || 72;

  waveCanvas.width  = W;
  waveCanvas.height = H;

  const ctx    = waveCanvas.getContext('2d');
  const mid    = H / 2;
  const scale  = mid * 20;   // amplify quiet signal for visibility
  const spp    = data.length / W;

  ctx.fillStyle = '#090d18';
  ctx.fillRect(0, 0, W, H);

  // Center line
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid); ctx.lineTo(W, mid);
  ctx.stroke();

  // Draw waveform as a filled mirror shape
  const topPath    = new Path2D();
  const bottomPath = new Path2D();

  topPath.moveTo(0, mid);
  bottomPath.moveTo(0, mid);

  for (let x = 0; x < W; x++) {
    const s = Math.floor(x * spp);
    const e = Math.min(Math.floor((x + 1) * spp), data.length);
    let peak = 0;
    for (let i = s; i < e; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    const h = Math.min(mid, peak * scale);
    topPath.lineTo(x, mid - h);
    bottomPath.lineTo(x, mid + h);
  }
  topPath.lineTo(W, mid);
  bottomPath.lineTo(W, mid);

  // Combine: fill between top and bottom
  const full = new Path2D();
  full.addPath(topPath);
  // Reverse bottom path
  for (let x = W; x >= 0; x--) {
    const s = Math.floor(x * spp);
    const e = Math.min(Math.floor((x + 1) * spp), data.length);
    let peak = 0;
    for (let i = s; i < e; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    const h = Math.min(mid, peak * scale);
    full.lineTo(x, mid + h);
  }

  ctx.fillStyle = 'rgba(212, 148, 26, 0.35)';
  ctx.fill(full);

  // Bright top edge
  ctx.strokeStyle = 'rgba(212, 148, 26, 0.7)';
  ctx.lineWidth   = 1;
  ctx.stroke(topPath);

  // Call event markers on waveform
  CALL_TIMES.forEach(t => {
    const x = (t / audioBuffer.duration) * W;
    ctx.strokeStyle = 'rgba(196, 74, 32, 0.6)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

// ════════════════════════════════════════════════════════════
// CALL MARKERS ON SPECTROGRAM
// ════════════════════════════════════════════════════════════
function addCallMarkers() {
  if (!audioBuffer) return;

  CALL_TIMES.forEach((t, i) => {
    const pct  = (t / audioBuffer.duration) * 100;
    const line = document.createElement('div');
    line.className = 'call-marker-line';
    line.style.left = pct + '%';
    line.title = `Call ${i + 1} — ~${t}s`;

    const label = document.createElement('div');
    label.className = 'call-marker-label';
    label.textContent = `C${i + 1}`;
    line.appendChild(label);

    line.addEventListener('click', e => {
      e.stopPropagation();
      seekTo(t);
      if (!isPlaying) play(t);
    });

    spectOverlay.appendChild(line);

    // Also add interactive pip on waveform
    const pip = document.createElement('div');
    pip.className = 'wave-marker-pip';
    pip.style.left = pct + '%';
    pip.title = `Call ${i + 1} — ~${t}s (click to jump)`;
    pip.addEventListener('click', e => {
      e.stopPropagation();
      seekTo(t);
      if (!isPlaying) play(t);
    });
    waveContainer.appendChild(pip);
  });
}

// ════════════════════════════════════════════════════════════
// FREQUENCY COMPARISON CHART (SVG)
// ════════════════════════════════════════════════════════════
function renderFrequencyChart() {
  const svg = $('freqChart');
  if (!svg) return;

  const VW = 820, VH = 360;
  const ML = 175, MR = 45, MT = 30, MB = 55;
  const CW = VW - ML - MR;    // 600
  const CH = VH - MT - MB;    // 275

  const toX = hz => ML + (hz / 3000) * CW;

  // Species data  (name, freqMin, freqMax, matchColor, matchPct, note)
  // Sorted by match % descending; Mystery Call always first
  const rows = [
    { name: 'Mystery Call ★',    min:1030, max:1060, col:'#f0b830', pct:100, isStar:true },
    { name: 'Jaguarundi',        min: 900, max:1200, col:'#c44a20', pct: 90 },
    { name: 'Ring-Tailed Lemur', min: 800, max:1200, col:'#d4941a', pct: 85 },
    { name: 'Kinkajou',          min: 800, max:1500, col:'#8ab840', pct: 70 },
    { name: 'Pygmy-Owl 🦉',      min: 800, max:1100, col:'#9b6bb5', pct: 60 },
    { name: 'Night-Heron 🦢',    min: 600, max:1100, col:'#4db8a0', pct: 52 },
    { name: 'Coatimundi',        min: 500, max:2000, col:'#5a9abf', pct: 50 },
    { name: 'Pauraque',          min: 800, max:1500, col:'#7a6868', pct: 40, sweep:true },
  ];

  const rowH  = CH / rows.length;   // ~35.8
  const barH  = Math.min(22, rowH * 0.62);
  const barY0 = (rowH - barH) / 2;

  let s = '';

  // Background
  s += `<rect x="0" y="0" width="${VW}" height="${VH}" fill="#0c1220" rx="14"/>`;

  // Grid lines & x-axis labels
  const gridFreqs = [0, 500, 1000, 1500, 2000, 2500, 3000];
  gridFreqs.forEach(f => {
    const x = toX(f);
    s += `<line x1="${x}" y1="${MT}" x2="${x}" y2="${MT + CH}"
            stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    s += `<text x="${x}" y="${MT + CH + 18}" fill="#6a6878"
            font-size="11" text-anchor="middle" font-family="Inter,sans-serif">${f} Hz</text>`;
  });

  // X-axis label
  s += `<text x="${ML + CW / 2}" y="${VH - 6}" fill="#5a5a70"
          font-size="11" text-anchor="middle" font-family="Inter,sans-serif">Frequency (Hz)</text>`;

  // Mystery call vertical band (1030–1060 Hz)
  const mxA = toX(1030), mxB = toX(1060);
  s += `<rect x="${mxA}" y="${MT}" width="${mxB - mxA}" height="${CH}"
          fill="rgba(240,184,48,0.12)" stroke="none"/>`;
  // Mystery call center line
  const mx = toX(1040);
  s += `<line x1="${mx}" y1="${MT - 8}" x2="${mx}" y2="${MT + CH + 8}"
          stroke="#f0b830" stroke-width="2" stroke-dasharray="none"/>`;
  s += `<text x="${mx}" y="${MT - 14}" fill="#f0b830"
          font-size="11" text-anchor="middle" font-weight="bold"
          font-family="Inter,sans-serif">1040 Hz</text>`;

  // Species rows
  rows.forEach((row, i) => {
    const y   = MT + i * rowH;
    const bY  = y + barY0;
    const x1  = toX(row.min);
    const x2  = toX(row.max);
    const bW  = Math.max(4, x2 - x1);

    // Row bg (alt rows)
    if (i % 2 === 1) {
      s += `<rect x="${ML}" y="${y}" width="${CW}" height="${rowH}"
              fill="rgba(255,255,255,0.02)"/>`;
    }

    // Label
    const labelStyle = row.isStar
      ? `fill="#f0b830" font-weight="bold"`
      : `fill="#c8b898"`;
    s += `<text x="${ML - 10}" y="${bY + barH / 2 + 4.5}"
            ${labelStyle} font-size="12" text-anchor="end"
            font-family="Inter,sans-serif">${row.name}</text>`;

    // Bar
    const rx = row.isStar ? 3 : 4;
    const op = row.isStar ? '1' : '0.75';
    s += `<rect x="${x1}" y="${bY}" width="${bW}" height="${barH}"
            fill="${row.col}" rx="${rx}" opacity="${op}"/>`;

    // If sweep, add gradient indicator
    if (row.sweep) {
      s += `<defs><linearGradient id="sweep${i}" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="${row.col}" stop-opacity="0.6"/>
              <stop offset="100%" stop-color="#c8d0e0" stop-opacity="0.8"/>
            </linearGradient></defs>`;
      s += `<rect x="${x1}" y="${bY}" width="${bW}" height="${barH}"
              fill="url(#sweep${i})" rx="${rx}" opacity="0.5"/>`;
    }

    // Range label
    s += `<text x="${x2 + 6}" y="${bY + barH / 2 + 4}"
            fill="${row.col}" font-size="10" opacity="0.8"
            font-family="Inter,sans-serif">${row.min}–${row.max}</text>`;

    // Match % label on right
    s += `<text x="${VW - 8}" y="${bY + barH / 2 + 4}"
            fill="${row.col}" font-size="10.5" text-anchor="end" font-weight="600"
            font-family="Inter,sans-serif">${row.isStar ? '' : row.pct + '%'}</text>`;
  });

  // Pauraque sweep annotation (row index 7)
  s += `<text x="${toX(1150)}" y="${MT + 7 * rowH + rowH / 2 + 4}"
          fill="rgba(122,104,104,0.6)" font-size="9" font-style="italic"
          font-family="Inter,sans-serif"> ↗ sweeps upward</text>`;

  // Border
  s += `<rect x="1" y="1" width="${VW - 2}" height="${VH - 2}"
          fill="none" stroke="rgba(255,255,255,0.06)" rx="13" stroke-width="1"/>`;

  svg.innerHTML = s;
}

// ════════════════════════════════════════════════════════════
// SUSPECT CARD TOGGLE
// ════════════════════════════════════════════════════════════
function toggleSuspect(id) {
  const card = document.querySelector(`.suspect-card[data-id="${id}"]`);
  const body = $(`body-${id}`);
  if (!card || !body) return;

  const isOpen = card.classList.contains('is-open');

  // Close all others
  document.querySelectorAll('.suspect-card.is-open').forEach(c => {
    c.classList.remove('is-open');
    const h = c.querySelector('.suspect-header');
    if (h) h.setAttribute('aria-expanded', 'false');
  });

  if (!isOpen) {
    card.classList.add('is-open');
    const header = card.querySelector('.suspect-header');
    if (header) header.setAttribute('aria-expanded', 'true');
    // Smooth scroll into view on mobile
    setTimeout(() => {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }
}

function setupSuspectKeyboard() {
  document.querySelectorAll('.suspect-header').forEach(header => {
    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const card = header.closest('.suspect-card');
        if (card) toggleSuspect(card.dataset.id);
      }
    });
  });
}

// ════════════════════════════════════════════════════════════
// VOTE SYSTEM
// ════════════════════════════════════════════════════════════
const VOTE_KEY = 'nightcaller_vote';

const VOTE_REVEALS = {
  lemur: {
    emoji: '🐒',
    text: `<strong>The most logical explanation — Occam's Razor at work.</strong>
           The neighbor's pet ring-tailed lemurs are right next door, their acoustic
           fingerprint is a near-perfect match, and their contact call means exactly
           "I'm here, where are you?" — which is exactly what a disoriented or
           exploring pet would broadcast into a dark February night. Check with the
           neighbors and solve this mystery for good!`,
  },
  jaguarundi: {
    emoji: '🐱',
    text: `<strong>You believe in the Ghost Cat.</strong>
           Bold call — and if you're right, this would be the first documented evidence
           of a jaguarundi in Texas in over 40 years. Their bird-like chirp is the
           one feline vocalization that people consistently mistake for a bird, and the
           acoustic match is actually the strongest of any candidate. Could be an escaped
           exotic pet, or... just maybe, a wild cat living ghost-quiet in the Coastal Bend brush.`,
  },
  kinkajou: {
    emoji: '🦝',
    text: `<strong>La Llorona strikes again.</strong>
           These nocturnal escape artists have turned up in stranger places than South Texas,
           and their tonal weedle calls could explain what was heard. The early scientists who
           originally classified kinkajous as <em>Lemur flavus</em> would appreciate the
           connection to our top candidate. Keep your eyes open for any missing exotic pet notices nearby.`,
  },
  coati: {
    emoji: '🦡',
    text: `<strong>The Aransas County connection is real.</strong>
           Coatis have been documented in Aransas County before, and their chirping contact calls
           fit the general pattern. The acoustic match isn't as tight as the top candidates — the
           calls tend to be broader-band and less tonal — but geography puts them squarely in play.
           They're more common in Texas than most people realize.`,
  },
  pauraque: {
    emoji: '🦅',
    text: `<strong>A thoughtful guess, but the acoustics don't line up.</strong>
           Pauraques are genuinely mysterious — they roost on the ground, glow orange-eyed in
           flashlight beams, and are perfectly camouflaged. But their call is a rising buzzy
           whistle that sweeps upward in frequency, which is the opposite of what the spectral
           analysis shows. Still, never rule out a nightjar! They're wild South Texas spirits.`,
  },
  nightheron: {
    emoji: '🦢',
    text: `<strong>Hiding in plain sight — or rather, plain darkness.</strong>
           Black-crowned Night-Herons are one of the most common birds on the Texas coast,
           but almost nobody recognizes their call because they're always heard at night, never
           seen. If this was a night-heron, it was almost certainly flying over the property
           toward Aransas Bay, calling as it went — a perfectly ordinary event that sounded
           extraordinary in the dark. There's an active nesting colony at Aransas NWR just
           30 miles away. Listen for their "quok" on any walk near coastal water after sunset.`,
  },
  pygmyowl: {
    emoji: '🦉',
    text: `<strong>South Texas's best-kept secret.</strong>
           The Ferruginous Pygmy-Owl's flat, monotone toot is genuinely the closest bird call
           to a pure-tone flat-contour signal of any Texas species. If this is your pick, you're
           thinking like a careful birder — the pitch contour match is real. The main challenge
           is the call pattern: pygmy-owls typically toot rapidly in series, not in widely spaced
           single bursts. Still, a bird at the northern fringe of its range could behave
           differently. Worth a dedicated listen on the next quiet February night.`,
  },
};

function checkVoteState() {
  const saved = localStorage.getItem(VOTE_KEY);
  if (saved) showVoteResult(saved);
}

function castVote(candidate) {
  // Highlight selected card
  document.querySelectorAll('.vote-card').forEach(c => {
    c.classList.toggle('voted', c.dataset.candidate === candidate);
  });

  localStorage.setItem(VOTE_KEY, candidate);

  setTimeout(() => showVoteResult(candidate), 280);
}

function showVoteResult(candidate) {
  const data = VOTE_REVEALS[candidate];
  if (!data) return;

  $('voteGrid').style.display    = 'none';
  $('voteResult').style.display  = 'block';
  $('vrEmoji').textContent       = data.emoji;
  $('vrText').innerHTML          = data.text;
}

function changeVote() {
  localStorage.removeItem(VOTE_KEY);
  document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('voted'));
  $('voteResult').style.display = 'none';
  $('voteGrid').style.display   = 'grid';
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function fmtTime(secs) {
  const s = Math.floor(secs);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function setPlayIcon(playing) {
  playIcon.style.display  = playing ? 'none'  : 'block';
  pauseIcon.style.display = playing ? 'block' : 'none';
}

// ════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!audioBuffer) return;
  if (['INPUT', 'BUTTON', 'TEXTAREA'].includes(e.target.tagName)) return;

  if (e.code === 'Space') {
    e.preventDefault();
    isPlaying ? pause() : play();
  } else if (e.code === 'ArrowLeft') {
    seekTo(Math.max(0, currentPosition() - 5));
  } else if (e.code === 'ArrowRight') {
    seekTo(Math.min(audioBuffer.duration - 0.1, currentPosition() + 5));
  } else if (e.code === 'KeyF') {
    filterBtn.click();
  }
});

// ════════════════════════════════════════════════════════════
// HANDLE WINDOW RESIZE (re-render waveform)
// ════════════════════════════════════════════════════════════
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (audioBuffer) renderWaveform();
  }, 200);
});

// ════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);
