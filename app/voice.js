// 声から色と光をつくる: 声の高さが色に、大きさが光の大きさに、響きの明るさがきらめきになる
// (録音も計算も端末の中だけ。声はどこにも送りません)
import { SIZE, paintBase, glow, sparkle, hslToHex } from "./aura.js";

const TAU = Math.PI * 2;

// 声の高さ・大きさ・明るさを、少しずつ区切って読み取る
export function analyzeVoice(data, sampleRate) {
  const k = Math.max(1, Math.floor(sampleRate / 11025));
  const n = Math.min(Math.floor(data.length / k), Math.floor((20 * sampleRate) / k));
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += data[i * k + j];
    d[i] = s / k;
  }
  const r = sampleRate / k;
  const F = 512, H = 256, lo = Math.floor(r / 600), hi = Math.ceil(r / 85);
  const frames = [];
  const vals = new Float32Array(hi + 1);
  let maxR = 0;
  for (let o = 0; o + F + hi < n; o += H) {
    let e = 0, z = 0;
    for (let i = 0; i < F; i++) {
      e += d[o + i] * d[o + i];
      if (i && (d[o + i] >= 0) !== (d[o + i - 1] >= 0)) z++;
    }
    const rms = Math.sqrt(e / F);
    let best = 0, bl = 0;
    if (e > 1e-7) {
      for (let l = lo; l <= hi; l++) {
        let c = 0, e2 = 0;
        for (let i = 0; i < F; i++) { c += d[o + i] * d[o + i + l]; e2 += d[o + i + l] * d[o + i + l]; }
        vals[l] = c / Math.sqrt(e * e2 || 1);
        if (vals[l] > best) best = vals[l];
      }
      for (let l = lo + 1; l < hi; l++) {
        if (vals[l] >= best * 0.9 && vals[l] >= vals[l - 1] && vals[l] >= vals[l + 1]) { bl = l; break; }
      }
    }
    frames.push({ rms, pitch: best > 0.5 && bl ? r / bl : 0, bright: z / F });
    if (rms > maxR) maxR = rms;
  }

  // 低い声は青やすみれ、高い声はピンクやひだまりの色
  const pitchHue = (p) => {
    const t = Math.max(0, Math.min(1, Math.log(p / 90) / Math.log(520 / 90)));
    return (250 + t * 170) % 360;
  };
  let lastHue = null;
  const hues = [], pitches = [];
  for (const f of frames) {
    f.on = f.rms > 0.12 * maxR && maxR > 0.003;
    if (f.on && f.pitch) { lastHue = pitchHue(f.pitch); pitches.push(f.pitch); }
    f.hue = f.on ? lastHue : null;
    if (f.on && lastHue != null) hues.push(lastHue);
  }
  pitches.sort((a, b) => a - b);
  return { frames, maxR, duration: n / r, hues, pitch: pitches.length ? Math.round(pitches[pitches.length >> 1]) : 0 };
}

// 読み取った声を、うずを巻く光として描く。使った色を返す
export function paintVoice(canvas, v, onFrame) {
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  paintBase(ctx);
  const fr = v.frames, N = fr.length, stride = Math.max(1, Math.ceil(N / 70));
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const t0 = performance.now();
  let i = 0;
  const step = (now) => {
    const upTo = reduced ? N : Math.min(N, Math.ceil(((now - t0) / 2200) * N));
    for (; i < upTo; i++) {
      const f = fr[i];
      if (i % stride || !f.on || f.hue == null) continue;
      const j = i / stride, a = j * 0.62, rad = SIZE * (0.03 + 0.4 * (i / N));
      const x = SIZE / 2 + Math.cos(a) * rad, y = SIZE / 2 + Math.sin(a) * rad;
      glow(ctx, x, y, 34 + 100 * (f.rms / v.maxR), hslToHex(f.hue, 80, 74), 0.32);
      if (j % 2 === 0) sparkle(ctx, x + Math.sin(i * 7.1) * 40, y + Math.cos(i * 5.3) * 40, 5 + Math.min(16, f.bright * 120), 0.85);
    }
    if (i < N) requestAnimationFrame(step);
    else if (onFrame) onFrame();
  };
  requestAnimationFrame(step);
  const picks = [0.15, 0.5, 0.85].map((q) => v.hues[Math.min(v.hues.length - 1, Math.floor(q * v.hues.length))]);
  return [...new Set(picks.map((h) => hslToHex(h, 80, 74)))];
}

// マイクで録音する。stop() を呼ぶと、録った音を返す
export async function startRecording(maxSeconds = 8) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    throw new Error("この端末では録音が使えません。音声ファイルをえらんでください");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.addEventListener("dataavailable", (e) => { if (e.data && e.data.size) chunks.push(e.data); });
  const done = new Promise((resolve) => rec.addEventListener("stop", () => {
    stream.getTracks().forEach((t) => t.stop());
    resolve(new Blob(chunks, { type: rec.mimeType || "audio/mp4" }));
  }));
  rec.start();
  const timer = setTimeout(() => { if (rec.state === "recording") rec.stop(); }, maxSeconds * 1000);
  return {
    stop() { clearTimeout(timer); if (rec.state === "recording") rec.stop(); return done; },
    done,
  };
}

let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// 録った音やファイルを、計算できる形にする
export async function decodeAudio(blob) {
  const buf = await blob.arrayBuffer();
  const c = ctx();
  return await new Promise((resolve, reject) => c.decodeAudioData(buf, resolve, () => reject(new Error("この音声は読みこめませんでした"))));
}

export function playBuffer(buffer) {
  try {
    const c = ctx();
    if (c.state === "suspended") c.resume();
    const s = c.createBufferSource();
    s.buffer = buffer;
    s.connect(c.destination);
    s.start();
  } catch (_) { /* 鳴らせなくても、ほかは動く */ }
}
