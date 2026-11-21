// 今日のイメージ: なぞった動き、または選んだ絵文字から、色の光を描く
// (AIは使わず、端末の中だけで描きます。速くて、費用もかかりません)

export const SIZE = 720;
const TAU = Math.PI * 2;

// 絵文字と、その色
export const EMOJIS = [
  { e: "🌸", c: "#ff9ec7", n: "さくら" }, { e: "✨", c: "#fff0a8", n: "キラキラ" }, { e: "💎", c: "#8fe3ff", n: "ダイヤ" },
  { e: "🪽", c: "#d9c8ff", n: "羽" }, { e: "🍀", c: "#9ef0c6", n: "クローバー" }, { e: "💕", c: "#ff8fb8", n: "ハート" },
  { e: "🌙", c: "#ffe58a", n: "月" }, { e: "☀️", c: "#ffc58a", n: "太陽" }, { e: "🌊", c: "#7fd6ff", n: "なみ" },
  { e: "🔥", c: "#ff9a76", n: "ほのお" }, { e: "🌿", c: "#a8e6a0", n: "はっぱ" }, { e: "🦋", c: "#a99bff", n: "ちょうちょ" },
  { e: "🍓", c: "#ff8a9e", n: "いちご" }, { e: "🍋", c: "#fff08a", n: "レモン" }, { e: "🫧", c: "#bfeaff", n: "あわ" },
  { e: "⭐", c: "#ffe07a", n: "ほし" }, { e: "🌷", c: "#ffb0d0", n: "チューリップ" }, { e: "🍊", c: "#ffb870", n: "みかん" },
  { e: "🌌", c: "#9a8cff", n: "ぎんが" }, { e: "🌈", c: "#ffd08a", n: "にじ" }, { e: "😊", c: "#ffd89a", n: "にっこり" },
  { e: "🥰", c: "#ffa9c8", n: "うっとり" }, { e: "😌", c: "#c8e8ff", n: "ほっと" }, { e: "😴", c: "#b9b0ff", n: "ねむい" },
  { e: "🤩", c: "#ffd0f0", n: "わくわく" }, { e: "😢", c: "#9ec8ff", n: "なみだ" }, { e: "😤", c: "#ff9c9c", n: "ぷんぷん" },
  { e: "🎵", c: "#c4a8ff", n: "おんぷ" }, { e: "☕", c: "#e0b896", n: "コーヒー" }, { e: "🍵", c: "#b8e0a0", n: "おちゃ" },
  { e: "🌻", c: "#ffd35c", n: "ひまわり" }, { e: "🌺", c: "#ff90b8", n: "ハイビスカス" }, { e: "❄️", c: "#cfeeff", n: "ゆき" },
  { e: "⚡", c: "#ffe66a", n: "いなずま" }, { e: "💜", c: "#c9a8ff", n: "むらさき" }, { e: "💙", c: "#8fc0ff", n: "あお" },
];

/* ---------- 小さな道具 ---------- */

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return "#" + to(f(0)) + to(f(8)) + to(f(4));
}
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paintBase(ctx) {
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, "#fff4f9");
  g.addColorStop(1, "#eee6ff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

export function glow(ctx, x, y, r, hex, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(hex, a));
  g.addColorStop(0.55, rgba(hex, a * 0.45));
  g.addColorStop(1, rgba(hex, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

export function sparkle(ctx, x, y, r, a) {
  glow(ctx, x, y, r * 2.2, "#ffffff", a * 0.7);
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${a})`;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.restore();
}

/* ---------- なぞって描く ---------- */

export function createStrokeEditor(canvas, onChange) {
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  let enabled = true;
  let drawing = false;
  let last = null;
  let hue = 330;
  let speed = 0.4;
  let count = 0;
  let colors = [];

  function reset(silent) {
    canvas.width = SIZE; // 描き直しのたびに、まっさらにする
    paintBase(ctx);
    colors = [];
    hue = 330;
    speed = 0.4;
    last = null;
    count = 0;
    if (silent !== true) onChange();
  }

  function toPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * SIZE) / r.width, y: ((e.clientY - r.top) * SIZE) / r.height, t: e.timeStamp };
  }

  function dot(p) {
    const color = hslToHex(hue, 80, 74);
    glow(ctx, p.x, p.y, 60, color, 0.4);
    glow(ctx, p.x, p.y, 22, "#ffffff", 0.9);
    colors.push(color);
  }

  function segment(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1.5) return;
    const dt = Math.max(1, b.t - a.t);
    speed = speed * 0.8 + Math.min(2.5, d / dt) * 0.2;
    const sn = Math.min(1, speed / 1.6); // 0=ゆっくり 1=はやい

    // 向きが色に、速さが明るさと大きさになる
    const frac = (Math.atan2(dy, dx) + Math.PI) / TAU;
    const target = (300 + frac * 300) % 360;
    const diff = ((target - hue + 540) % 360) - 180;
    hue = (hue + diff * 0.15 + 360) % 360;
    const color = hslToHex(hue, 78 + sn * 14, 76 - sn * 8);
    const radius = 62 - sn * 30;

    const steps = Math.ceil(d / 6);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      glow(ctx, a.x + dx * t, a.y + dy * t, radius, color, 0.2);
    }
    if (count++ % 4 === 0) colors.push(color);

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 7 + (1 - sn) * 3;
    ctx.lineCap = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!enabled) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* なくても描ける */ }
    drawing = true;
    last = toPoint(e);
    dot(last);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!enabled || !drawing) return;
    e.preventDefault();
    const p = toPoint(e);
    segment(last, p);
    last = p;
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    onChange();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  reset(true);

  return {
    reset: () => reset(),
    setEnabled(v) { enabled = v; },
    hasContent: () => colors.length > 0,
    palette() {
      if (!colors.length) return [];
      const picks = [0.1, 0.4, 0.7, 0.95].map((q) => colors[Math.min(colors.length - 1, Math.floor(q * colors.length))]);
      return [...new Set(picks)];
    },
  };
}

/* ---------- 絵文字から描く ---------- */

export function renderEmojiAura(canvas, picks, seed) {
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  paintBase(ctx);
  if (!picks.length) return [];

  const rnd = mulberry32(seed);
  const cols = picks.map((p) => p.c);
  const centers = [];

  cols.forEach((c, i) => {
    const angle = (i / cols.length) * TAU + rnd() * 1.2;
    const rad = 120 + rnd() * 90;
    const x = SIZE / 2 + Math.cos(angle) * rad;
    const y = SIZE / 2 + Math.sin(angle) * rad;
    centers.push({ x, y });
    glow(ctx, x, y, 300 + rnd() * 70, c, 0.9);
    glow(ctx, x + (rnd() - 0.5) * 160, y + (rnd() - 0.5) * 160, 200, c, 0.6);
  });
  for (let i = 0; i < 3; i++) {
    glow(ctx, rnd() * SIZE, rnd() * SIZE, 160 + rnd() * 120, cols[Math.floor(rnd() * cols.length)], 0.35);
  }
  glow(ctx, SIZE / 2, SIZE / 2, 230, "#ffffff", 0.55);
  glow(ctx, SIZE / 2, SIZE / 2, 90, "#fff4c2", 0.8);
  for (let i = 0; i < 12; i++) {
    sparkle(ctx, rnd() * SIZE * 0.9 + SIZE * 0.05, rnd() * SIZE * 0.9 + SIZE * 0.05, 6 + rnd() * 12, 0.5 + rnd() * 0.4);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '120px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  picks.forEach((p, i) => {
    ctx.save();
    ctx.shadowColor = p.c;
    ctx.shadowBlur = 36;
    ctx.globalAlpha = 0.95;
    ctx.fillText(p.e, centers[i].x, centers[i].y);
    ctx.restore();
  });
  return [...new Set(cols)];
}
