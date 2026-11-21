// 高次元SNS リラ: ひろば・部活・トーク・プロフィール
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from "./config.js";
import { EMOJIS, createStrokeEditor, renderEmojiAura, hslToHex } from "./aura.js";
import { TEMPLATES, recognize, drawStamp, FACES, DECOS, BORDERS } from "./stamp.js";
import { analyzeVoice, paintVoice, startRecording, decodeAudio, playBuffer } from "./voice.js";

const APP_VERSION = "2.0(ひろば・部活・プロフィール)";

const app = document.getElementById("app");
const configured = /^https:\/\/[^\s]+\.supabase\.co/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;
const pushConfigured = VAPID_PUBLIC_KEY.length > 40;

let supabase = null;

const S = {
  userId: undefined, // undefined=まだ不明 / null=ログインしていない
  me: null,
  people: [],
  convs: [],
  view: null,
  chat: null,
  channel: null,
  lastRead: {},
  counted: new Set(),
  nav: 0,
};

/* ------------------------------------------------------------------ */
/* 小さな道具                                                          */
/* ------------------------------------------------------------------ */

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(paths, size = 24) {
  const s = document.createElementNS(SVG_NS, "svg");
  const attrs = {
    viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
    "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
  };
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}
const ICON = {
  plus: ["M12 5v14M5 12h14"],
  back: ["M15 5l-7 7 7 7"],
  image: ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M9 10.5a1.5 1.5 0 1 0 0 .01", "M21 16l-5-4-8 7"],
  send: ["M21 3L3 10.5l7 2.5 2.5 7z", "M10 13L21 3"],
  stamp: ["M12 20.5s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1z"],
  sparkle: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"],
};

function iconBtn(label, icon, onclick) {
  return h("button", { class: "icon-btn", type: "button", "aria-label": label, onclick }, svg(icon));
}

const safeColor = (c, fallback) => (/^#[0-9a-fA-F]{6}$/.test(c || "") ? c : fallback);

function avatar(p, size = 52) {
  const cols = colorsOf(p);
  const kind = p && p.icon_kind;
  const val = p && p.icon_value;
  const initial = Array.from((p && p.name ? p.name : "?").trim())[0] || "?";
  let pic;
  if (kind === "photo" && val) {
    const img = h("img", { class: "av-img", alt: "" });
    mediaUrl(val).then((u) => { if (u) img.src = u; });
    pic = h("div", { class: "av-pic photo" }, img);
  } else if (kind === "emoji" && val) {
    pic = h("div", { class: "av-pic emoji", style: `background:${softGradient(cols, 0.72)};font-size:${Math.round(size * 0.46)}px` }, val);
  } else {
    pic = h("div", { class: "av-pic", style: `background:linear-gradient(135deg,${cols[0]},${cols[1]});font-size:${Math.round(size * 0.4)}px` }, initial);
  }
  return h("div", {
    class: "av",
    style: `width:${size}px;height:${size}px;background:conic-gradient(from 20deg,${cols[0]},${cols[1]},${cols[2]},${cols[0]});box-shadow:0 0 ${Math.round(size / 3)}px ${cols[0]}99`,
  }, h("div", { class: "av-in" }, pic));
}

// ファイル名に使う、かぶらない名前(古い端末でも動くように)
function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const x = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const pad = (n) => String(n).padStart(2, "0");
const WEEK = "日月火水木金土";
function hhmm(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dayLabel(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`;
}
function listTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays <= 0) return hhmm(iso);
  if (diffDays === 1) return "昨日";
  if (diffDays < 7) return `${WEEK[d.getDay()]}曜`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

let toastTimer = null;
function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3800);
}

function jpError(err) {
  const m = (err && err.message) || String(err);
  if (/Invalid login credentials/i.test(m)) return "メールアドレスかパスワードがちがいます";
  if (/already registered|already been registered/i.test(m)) return "このメールアドレスはすでに登録されています";
  if (/at least \d+ characters/i.test(m)) return "パスワードは6文字以上にしてください";
  if (/valid email|invalid format/i.test(m)) return "メールアドレスの形がちがうようです";
  if (/signups? not allowed|signup is disabled/i.test(m)) return "いまは新しい登録を受け付けていません";
  if (/rate limit/i.test(m)) return "短い時間に何度も試したようです。少し待ってからもう一度どうぞ";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "通信できませんでした。電波のよいところでもう一度どうぞ";
  if (missingTable(err)) return "この機能はまだ準備中です(SETUP.md の「ステップ2」)";
  if (/row-level security/i.test(m)) return "この操作はできない設定になっています";
  return m;
}

function setScreen(el) {
  app.replaceChildren(el);
}

/* ------------------------------------------------------------------ */
/* 起動                                                                */
/* ------------------------------------------------------------------ */

function showSetupNeeded() {
  setScreen(h("div", { class: "screen" },
    h("div", { class: "auth" },
      h("div", { class: "orb" }),
      h("h1", {}, "もう少しで始められます"),
      h("p", { class: "tagline" }, "config.js に、Supabase の情報を貼ってください。"),
      h("div", { class: "panel", style: "width:100%;max-width:360px" },
        h("p", {}, "手順は SETUP.md の「5」に書いてあります。貼り終えたら、このページを開き直してください。")))));
}

async function boot() {
  if (!configured) return showSetupNeeded();

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    const id = session && session.user ? session.user.id : null;
    if (id === S.userId) return; // 更新(トークンの再取得など)のときは何もしない
    S.userId = id;
    setTimeout(onUserChange, 0);
  });

  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.me) refreshAll();
  });
}

async function onUserChange() {
  if (S.channel) {
    supabase.removeChannel(S.channel);
    S.channel = null;
  }
  S.me = null;
  S.convs = [];
  S.people = [];
  S.chat = null;
  S.counted = new Set();

  if (!S.userId) {
    S.view = null;
    clearBadge();
    return showAuth("login");
  }

  try {
    const { data: me, error } = await supabase.from("profiles").select("*").eq("id", S.userId).single();
    if (error) throw error;
    S.me = me;
    S.lastRead = readLastRead();
    await Promise.all([loadPeople(), loadConvs()]);
    subscribeRealtime();
    syncPush();
    route();
  } catch (err) {
    showAuth("login", "うまく読み込めませんでした: " + jpError(err));
  }
}

function readLastRead() {
  try {
    return JSON.parse(localStorage.getItem("lastRead:" + S.userId) || "{}");
  } catch (_) {
    return {};
  }
}
function saveLastRead() {
  try {
    localStorage.setItem("lastRead:" + S.userId, JSON.stringify(S.lastRead));
  } catch (_) { /* 保存できなくても動く */ }
}

/* ------------------------------------------------------------------ */
/* データ                                                              */
/* ------------------------------------------------------------------ */

async function loadPeople() {
  const { data, error } = await supabase.from("profiles").select("*").order("name").limit(500);
  if (error) throw error;
  S.people = data || [];
}

async function loadConvs() {
  const { data: mine, error } = await supabase
    .from("conversation_members")
    .select("conversation_id, conversations(id, kind, title, created_at)")
    .eq("user_id", S.me.id);
  if (error) throw error;

  const convMap = new Map();
  (mine || []).forEach((row) => {
    if (row.conversations) convMap.set(row.conversations.id, { ...row.conversations, members: [], last: null, unread: 0 });
  });
  const ids = [...convMap.keys()];

  if (ids.length) {
    const [{ data: mem, error: e2 }, { data: msgs, error: e3 }] = await Promise.all([
      supabase.from("conversation_members").select("conversation_id, profiles(*)").in("conversation_id", ids),
      supabase.from("messages").select("*").in("conversation_id", ids).order("created_at", { ascending: false }).limit(300),
    ]);
    if (e2) throw e2;
    if (e3) throw e3;
    (mem || []).forEach((m) => {
      const c = convMap.get(m.conversation_id);
      if (c && m.profiles) c.members.push(m.profiles);
    });
    (msgs || []).forEach((m) => {
      const c = convMap.get(m.conversation_id);
      if (!c) return;
      if (!c.last) c.last = m;
      const readAt = S.lastRead[c.id];
      if (m.sender_id !== S.me.id && (!readAt || m.created_at > readAt)) c.unread += 1;
      S.counted.add(m.id);
    });
  }

  S.convs = [...convMap.values()];
  sortConvs();
}

function sortConvs() {
  const key = (c) => (c.last ? c.last.created_at : c.created_at);
  S.convs.sort((a, b) => (key(a) < key(b) ? 1 : -1));
}

function partnerOf(conv) {
  return conv.members.find((p) => p.id !== S.me.id) || S.me;
}
function convName(conv) {
  if (conv.kind === "group") return conv.title || conv.members.map((p) => p.name).join("、");
  return partnerOf(conv).name || "(名前なし)";
}
function previewOf(m) {
  if (!m) return "まだメッセージはありません";
  if (m.kind === "text") return m.body || "";
  if (m.kind === "image") return m.body === "aura" ? "今日のイメージを送りました" : m.body === "stamp" ? "スタンプを送りました" : "画像を送りました";
  if (m.kind === "voice") return "音声メッセージ";
  return "ファイルを送りました";
}

function markRead(conv) {
  if (conv.last) {
    S.lastRead[conv.id] = conv.last.created_at;
    saveLastRead();
  }
  conv.unread = 0;
  refreshBadge();
}

// ホーム画面のアイコンに、未読の合計を出す(ホーム画面に追加したアプリで動きます)
function refreshBadge() {
  if (!S.me) return;
  const n = S.convs.reduce((sum, c) => sum + c.unread, 0);
  try {
    if (n > 0 && "setAppBadge" in navigator) navigator.setAppBadge(n).catch(() => {});
    else if (n === 0 && "clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
    // アプリを閉じているときに通知が届いたら、ここから数え続ける
    if ("caches" in window) {
      caches.open("badge-v1").then((c) => c.put("/badge-count", new Response(String(n)))).catch(() => {});
    }
  } catch (_) { /* 数字が出せない端末でも、ほかは動く */ }
}

function clearBadge() {
  try {
    if ("clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
    if ("caches" in window) caches.delete("badge-v1").catch(() => {});
  } catch (_) { /* 何もしない */ }
}

/* ------------------------------------------------------------------ */
/* リアルタイム                                                        */
/* ------------------------------------------------------------------ */

function subscribeRealtime() {
  S.channel = supabase
    .channel("messages-all")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => onNewMessage(payload.new))
    .subscribe();
}

async function onNewMessage(m) {
  if (!m || S.counted.has(m.id)) return;
  S.counted.add(m.id);

  let conv = S.convs.find((c) => c.id === m.conversation_id);
  if (!conv) {
    // 新しく始まったトーク。まるごと読み直す(未読の数もここで数える)
    try { await loadConvs(); } catch (_) { return; }
    renderList();
    return;
  }
  if (!conv.last || m.created_at >= conv.last.created_at) conv.last = m;

  const viewing = S.view && S.view.name === "chat" && S.view.cid === conv.id;
  if (viewing) {
    appendMessage(m);
    if (document.visibilityState === "visible") markRead(conv);
  } else if (m.sender_id !== S.me.id) {
    conv.unread += 1;
  }

  sortConvs();
  renderList();
}

async function refreshAll() {
  try {
    await loadConvs();
    if (S.view && S.view.name === "chat" && S.chat) {
      const { data } = await supabase.from("messages").select("*").eq("conversation_id", S.chat.cid).order("created_at", { ascending: false }).limit(50);
      (data || []).reverse().forEach(appendMessage);
      const conv = S.convs.find((c) => c.id === S.chat.cid);
      if (conv) markRead(conv);
    }
    renderList();
  } catch (_) { /* 次の機会にまた読む */ }
}

/* ------------------------------------------------------------------ */
/* 画面の切り替え                                                      */
/* ------------------------------------------------------------------ */

function route() {
  if (!S.me) return;
  S.nav += 1;
  S.chat = null;
  const parts = (location.hash || "#/").split("/");
  const a = parts[1];
  const b = parts[2];
  if (a === "chat" && b) return showChat(b);
  if (a === "aura" && b) return showAura(b);
  if (a === "stamp" && b) return showStamp(b);
  if (a === "talks") return showList();
  if (a === "clubs") return b ? showClub(b) : showClubs();
  if (a === "u" && b) return showProfile(b);
  if (a === "me") return b === "edit" ? showProfileEdit() : showProfile(S.me.id);
  if (a === "new") return showNew();
  if (a === "settings") return showSettings();
  return showHome();
}

/* ---------- ログイン ---------- */

// ログイン画面のロゴ(アイコンと、筆記体の Lila)
function logo() {
  const spread = (text, cls) => h("div", { class: "logo-line " + cls, "aria-hidden": "true" }, Array.from(text).map((c) => h("span", {}, c)));
  const star = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 40 68", width: "18", height: "31", "aria-hidden": "true" })) star.setAttribute(k, v);
  const sp = document.createElementNS(SVG_NS, "path");
  sp.setAttribute("d", "M20,2 Q21.44,31.44 38,34 Q21.44,36.56 20,66 Q18.56,36.56 2,34 Q18.56,31.44 20,2 Z");
  sp.setAttribute("fill", "#f1d480");
  star.append(sp);
  return h("div", { class: "logo" },
    h("img", { class: "logo-icon", src: "apple-touch-icon.png", alt: "" }),
    h("div", { class: "logo-word" },
      spread("高次元SNSリラ", "l1"),
      h("h1", { class: "logo-name", "aria-label": "高次元SNS リラ 声と色でつながる場所" }, "Lila", star),
      spread("声と色でつながる場所", "l2")));
}

function showAuth(mode = "login", msg = "") {
  S.view = { name: "auth" };
  const isSignup = mode === "signup";

  const name = isSignup
    ? h("input", { type: "text", placeholder: "表示する名前", autocomplete: "nickname", required: true, maxLength: 20 })
    : null;
  const email = h("input", { type: "email", placeholder: "メールアドレス", autocomplete: "email", required: true });
  const pass = h("input", {
    type: "password", placeholder: "パスワード(6文字以上)", required: true, minLength: 6,
    autocomplete: isSignup ? "new-password" : "current-password",
  });
  const note = h("div", { class: "note", role: "alert" }, msg);
  const btn = h("button", { class: "primary", type: "submit" }, isSignup ? "はじめる" : "ログイン");

  const form = h("form", {
    class: "auth-form",
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      note.textContent = "";
      try {
        if (isSignup) {
          const { data, error } = await supabase.auth.signUp({
            email: email.value.trim(),
            password: pass.value,
            options: { data: { name: name.value.trim() } },
          });
          if (error) throw error;
          if (!data.session) note.textContent = "確認メールを送りました。メールのリンクを開いてから、ログインしてください。";
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
          if (error) throw error;
        }
      } catch (err) {
        note.textContent = jpError(err);
      } finally {
        btn.disabled = false;
      }
    },
  }, name, email, pass, note, btn);

  setScreen(h("div", { class: "screen" },
    h("div", { class: "auth" },
      logo(),
      form,
      h("button", { class: "link", type: "button", onclick: () => showAuth(isSignup ? "login" : "signup") },
        isSignup ? "すでに登録している方はこちら" : "はじめての方はこちら"))));
}

/* ---------- トーク一覧 ---------- */

function showList() {
  S.view = { name: "list" };
  const body = h("div", { class: "list" });
  S.listEl = body;
  setScreen(h("div", { class: "screen" },
    brandbar(),
    h("div", { class: "page-title split" },
      h("div", {}, h("h1", {}, "トーク"), h("p", {}, "1対1でやりとりする場所")),
      iconBtn("新しいトークをつくる", ICON.plus, () => { location.hash = "#/new"; })),
    pushBanner(),
    body,
    tabbar("talks")));
  renderList();
}

function renderList() {
  refreshBadge();
  if (!S.view || S.view.name !== "list" || !S.listEl) return;
  const el = S.listEl;
  el.replaceChildren();
  if (!S.convs.length) {
    el.append(h("div", { class: "empty" }, "まだトークはありません", h("br"), "右上の＋から、話したい人を選びましょう"));
    return;
  }
  const card = h("div", { class: "card" });
  S.convs.forEach((c) => {
    card.append(h("button", { class: "row", type: "button", onclick: () => { location.hash = "#/chat/" + c.id; } },
      avatar(c.kind === "group" ? { name: convName(c) } : partnerOf(c), 52),
      h("div", { class: "row-main" },
        h("div", { class: "row-name" }, convName(c)),
        h("div", { class: "row-sub" }, previewOf(c.last))),
      h("div", { class: "row-side" },
        h("span", { class: "row-time" }, c.last ? listTime(c.last.created_at) : ""),
        c.unread > 0 ? h("span", { class: "badge" }, c.unread > 99 ? "99+" : c.unread) : null)));
  });
  el.append(card);
}

/* ---------- 新しいトーク ---------- */

function showNew() {
  S.view = { name: "new" };
  const list = h("div", { class: "list" });
  const input = h("input", { type: "search", placeholder: "名前やメールアドレスでさがす", "aria-label": "さがす", autocomplete: "off" });

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const people = S.people.filter((p) => p.id !== S.me.id && (!q || (p.name || "").toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q)));
    list.replaceChildren();
    if (!people.length) {
      list.append(h("div", { class: "empty" }, q ? "見つかりませんでした" : "まだ他の人が登録していません", h("br"), "登録してもらってから、もう一度ひらいてください"));
      return;
    }
    const card = h("div", { class: "card" });
    people.forEach((p) => {
      card.append(h("button", { class: "row", type: "button", onclick: () => startDm(p.id) },
        avatar(p, 48),
        h("div", { class: "row-main" },
          h("div", { class: "row-name" }, p.name || "(名前なし)"),
          h("div", { class: "row-sub" }, p.email))));
    });
    list.append(card);
  };
  input.addEventListener("input", draw);

  setScreen(h("div", { class: "screen" },
    h("div", { class: "topbar" },
      iconBtn("もどる", ICON.back, () => { location.hash = "#/talks"; }),
      h("h2", {}, "だれと話す?")),
    h("div", { class: "search" }, input),
    list));
  draw();
}

async function startDm(otherId) {
  const { data, error } = await supabase.rpc("start_dm", { other: otherId });
  if (error) return toast("トークを始められませんでした: " + error.message);
  try { await loadConvs(); } catch (_) { /* 開いたときに読み直す */ }
  location.hash = "#/chat/" + data;
}

/* ---------- トーク画面 ---------- */

async function showChat(cid) {
  const nav = S.nav;
  let conv = S.convs.find((c) => c.id === cid);
  if (!conv) {
    try { await loadConvs(); } catch (_) { /* 下で判断する */ }
    conv = S.convs.find((c) => c.id === cid);
    if (!conv) { location.hash = "#/talks"; return; }
  }
  if (nav !== S.nav) return;

  S.view = { name: "chat", cid };
  const partner = partnerOf(conv);
  const a = safeColor(partner.color_a, "#ffd6ea");
  const b = safeColor(partner.color_b, "#ffe0bd");

  const scroll = h("div", { class: "chat-scroll" });
  const chat = { cid, scroll, seen: new Set(), lastDay: "", stick: true, loaded: false, pending: [] };
  S.chat = chat;
  scroll.addEventListener("scroll", () => {
    chat.stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140;
  });

  const input = h("input", {
    class: "text-in", type: "text", placeholder: "メッセージ", "aria-label": "メッセージ", autocomplete: "off", enterKeyHint: "send",
  });
  const sendBtn = h("button", { class: "send-btn", type: "submit", "aria-label": "送る" }, svg(ICON.send));
  const fileIn = h("input", { type: "file", accept: "image/*", hidden: true });
  const imgBtn = iconBtn("画像をえらぶ", ICON.image, () => fileIn.click());

  fileIn.addEventListener("change", async () => {
    const file = fileIn.files && fileIn.files[0];
    fileIn.value = "";
    if (!file) return;
    imgBtn.disabled = true;
    try {
      await sendImage(conv, file);
    } catch (err) {
      toast("画像を送れませんでした: " + (err.message || err));
    } finally {
      imgBtn.disabled = false;
    }
  });

  const form = h("form", {
    class: "composer",
    onsubmit: async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      input.value = "";
      const { data, error } = await supabase
        .from("messages")
        .insert({ conversation_id: conv.id, sender_id: S.me.id, kind: "text", body })
        .select()
        .single();
      if (error) {
        input.value = body;
        return toast("送れませんでした: " + error.message);
      }
      onNewMessage(data);
      input.focus();
    },
  }, imgBtn, fileIn,
  iconBtn("今日のイメージを作る", ICON.sparkle, () => { location.hash = "#/aura/" + conv.id; }),
  iconBtn("スタンプを作る", ICON.stamp, () => { location.hash = "#/stamp/" + conv.id; }),
  input, sendBtn);

  setScreen(h("div", {
    class: "screen",
    style: `background:radial-gradient(110% 55% at 10% 0%,${a}66 0%,${a}00 62%),radial-gradient(90% 50% at 100% 40%,${b}66 0%,${b}00 62%),radial-gradient(120% 60% at 30% 100%,#e7cfff 0%,rgba(231,207,255,0) 65%),#fff6f8`,
  },
  h("div", { class: "topbar" },
    iconBtn("もどる", ICON.back, () => { location.hash = "#/talks"; }),
    avatar(conv.kind === "group" ? { name: convName(conv) } : partner, 42),
    h("h2", {}, convName(conv))),
  scroll,
  form));

  const { data, error } = await supabase
    .from("messages").select("*").eq("conversation_id", cid).order("created_at", { ascending: false }).limit(100);
  if (nav !== S.nav) return;
  if (error) {
    scroll.append(h("div", { class: "empty" }, "メッセージを読み込めませんでした"));
    return;
  }
  (data || []).reverse().forEach((m) => { S.counted.add(m.id); renderMessage(m); });
  chat.loaded = true;
  chat.pending.sort((x, y) => (x.created_at < y.created_at ? -1 : 1)).forEach(renderMessage);
  chat.pending = [];
  if (!chat.seen.size) scroll.append(h("div", { class: "empty", id: "empty-chat" }, "最初のひとことを送ってみましょう"));
  scrollBottom();
  markRead(S.convs.find((c) => c.id === cid) || conv);
}

function scrollBottom() {
  if (S.chat) S.chat.scroll.scrollTop = S.chat.scroll.scrollHeight;
}

// 開いているトークに新着を足す(履歴を読み込み中なら、読み終わるまで待たせる)
function appendMessage(m) {
  const chat = S.chat;
  if (!chat || m.conversation_id !== chat.cid) return;
  if (!chat.loaded) {
    chat.pending.push(m);
    return;
  }
  renderMessage(m);
}

function renderMessage(m) {
  const chat = S.chat;
  if (!chat || m.conversation_id !== chat.cid || chat.seen.has(m.id)) return;
  chat.seen.add(m.id);
  const empty = chat.scroll.querySelector("#empty-chat");
  if (empty) empty.remove();

  const day = new Date(m.created_at).toDateString();
  if (day !== chat.lastDay) {
    chat.lastDay = day;
    chat.scroll.append(h("div", { class: "day" }, dayLabel(m.created_at)));
  }

  const mine = m.sender_id === S.me.id;
  const time = h("span", { class: "time" }, hhmm(m.created_at));
  let content;
  if (m.kind === "image" && m.file_path) {
    const isAura = m.body === "aura";
    const isStamp = m.body === "stamp";
    const img = h("img", { class: "pic", alt: isAura ? "今日のイメージ" : isStamp ? "スタンプ" : "送られた画像" });
    img.addEventListener("load", () => { if (chat.stick) scrollBottom(); });
    img.addEventListener("click", () => openViewer(m.file_path));
    signedUrl(m.file_path).then((u) => { if (u) img.src = u; });
    content = h("div", { class: "pic-wrap" + (isAura ? " aura" : isStamp ? " stamp" : "") }, img);
  } else {
    content = h("div", { class: "bubble" }, m.body || previewOf(m));
  }
  chat.scroll.append(h("div", { class: "msg " + (mine ? "mine" : "theirs") }, mine ? [time, content] : [content, time]));
  if (chat.stick || mine) scrollBottom();
}

/* ---------- 画像 ---------- */

const urlCache = new Map();
async function signedUrl(path, opts, bucket = "chat") {
  const key = bucket + ":" + path + (opts ? "|dl" : "");
  const hit = urlCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600, opts);
  if (error || !data) return null;
  urlCache.set(key, { url: data.signedUrl, exp: Date.now() + 3000 * 1000 });
  return data.signedUrl;
}

async function downscale(file, max = 1600, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("この画像は読み込めませんでした"));
      i.src = url;
    });
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * r));
    const hh = Math.max(1, Math.round(img.naturalHeight * r));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = hh;
    canvas.getContext("2d").drawImage(img, 0, 0, w, hh);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("画像を小さくできませんでした");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function sendImage(conv, file) {
  const blob = await downscale(file);
  const path = `${conv.id}/${newId()}.jpg`;
  const up = await supabase.storage.from("chat").upload(path, blob, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conv.id, sender_id: S.me.id, kind: "image", file_path: path })
    .select()
    .single();
  if (error) throw error;
  onNewMessage(data);
}

async function openViewer(path, bucket = "chat") {
  const url = await signedUrl(path, undefined, bucket);
  if (!url) return toast("画像を開けませんでした");
  const close = () => viewer.remove();
  const save = h("button", { type: "button" }, "保存する");
  save.addEventListener("click", async () => {
    const dl = await signedUrl(path, { download: "image.jpg" }, bucket);
    if (!dl) return toast("保存できませんでした");
    const a = h("a", { href: dl, download: "image.jpg" });
    document.body.append(a);
    a.click();
    a.remove();
  });
  const viewer = h("div", { class: "viewer", role: "dialog", "aria-label": "画像" },
    h("img", { src: url, alt: "送られた画像" }),
    h("div", { class: "vbar" }, save, h("button", { type: "button", onclick: close }, "とじる")));
  viewer.addEventListener("click", (e) => { if (e.target === viewer) close(); });
  document.body.append(viewer);
}

// アイコンの縁の色を、今日の色に変える
async function applyRingColors(colors) {
  const a = colors[0];
  const b = colors.find((c) => c !== a) || a;
  const c = colors.find((x) => x !== a && x !== b) || a;
  let { error } = await supabase.from("profiles").update({ color_a: a, color_b: b, colors: [a, b, c] }).eq("id", S.me.id);
  if (error && /column/i.test(error.message || "")) ({ error } = await supabase.from("profiles").update({ color_a: a, color_b: b }).eq("id", S.me.id));
  if (error) return toast("縁の色は変えられませんでした");
  const apply = (p) => { if (p && p.id === S.me.id) { p.color_a = a; p.color_b = b; p.colors = [a, b, c]; } };
  apply(S.me);
  S.people.forEach(apply);
  S.convs.forEach((c) => c.members.forEach(apply));
}

/* ---------- 設定 ---------- */

function showSettings() {
  S.view = { name: "settings" };
  const nameIn = h("input", { type: "text", value: S.me.name || "", maxLength: 20, "aria-label": "表示する名前", autocomplete: "nickname" });
  const saveBtn = h("button", { class: "secondary", type: "button" }, "名前を保存");
  saveBtn.addEventListener("click", async () => {
    const name = nameIn.value.trim();
    if (!name) return toast("名前を入れてください");
    saveBtn.disabled = true;
    const { error } = await supabase.from("profiles").update({ name }).eq("id", S.me.id);
    saveBtn.disabled = false;
    if (error) return toast("保存できませんでした: " + error.message);
    S.me.name = name;
    const p = S.people.find((x) => x.id === S.me.id);
    if (p) p.name = name;
    toast("保存しました");
  });

  const pushPanel = h("div", { class: "panel" }, h("h3", {}, "通知"));
  const supported = pushSupported();
  if (!pushConfigured) {
    pushPanel.append(h("p", {}, "通知の鍵がまだ設定されていません(SETUP.md の「4」「5」)。"));
  } else if (!supported) {
    pushPanel.append(h("p", {}, isIos() && !isStandalone()
      ? "iPhoneでは、共有ボタンから「ホーム画面に追加」して、ホーム画面のアイコンから開くと、通知が使えます。"
      : "この端末・ブラウザでは通知が使えません。"));
  } else if (Notification.permission === "granted") {
    pushPanel.append(h("p", {}, "通知はオンです。"));
  } else if (Notification.permission === "denied") {
    pushPanel.append(h("p", {}, "通知がブロックされています。端末の設定から、このアプリの通知を許可してください。"));
  } else {
    const b = h("button", { class: "secondary", type: "button" }, "通知をオンにする");
    b.addEventListener("click", async () => {
      try {
        await enablePush();
        toast("通知をオンにしました");
        showSettings();
      } catch (err) {
        toast(err.message || "通知をオンにできませんでした");
      }
    });
    pushPanel.append(h("p", {}, "新しいメッセージが届いたら、スマホにお知らせします。"), b);
  }

  const badgeOk = "setAppBadge" in navigator;
  const badgePanel = h("div", { class: "panel" }, h("h3", {}, "アイコンの数字"));
  if (!badgeOk) {
    badgePanel.append(h("p", {}, isIos() && !isStandalone()
      ? "いまは、ブラウザで開いています。ホーム画面に追加したアイコンから開くと、数字が使えます。"
      : "この端末・ブラウザでは、アイコンの数字が使えません。"));
  } else {
    const testBtn = h("button", { class: "secondary", type: "button" }, "アイコンに「3」を出してみる");
    testBtn.addEventListener("click", async () => {
      try {
        await navigator.setAppBadge(3);
        toast("「3」を出しました。ホーム画面に戻って、アイコンを見てください");
      } catch (err) {
        toast("出せませんでした: " + (err.message || err));
      }
    });
    const clearBtn = h("button", { class: "secondary", type: "button" }, "数字を消す");
    clearBtn.addEventListener("click", async () => {
      try { await navigator.clearAppBadge(); refreshBadge(); toast("消しました"); } catch (_) { /* 何もしない */ }
    });
    badgePanel.append(h("p", {}, "この画面では、アイコンの数字が使えます。テストしてみてください。"), testBtn, clearBtn);
  }

  const logout = h("button", { class: "secondary", type: "button" }, "ログアウト");
  logout.addEventListener("click", async () => {
    try {
      if (pushSupported()) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    } catch (_) { /* 失敗してもログアウトは続ける */ }
    await supabase.auth.signOut();
    location.hash = "#/";
  });

  setScreen(h("div", { class: "screen" },
    h("div", { class: "topbar" },
      iconBtn("もどる", ICON.back, () => { location.hash = "#/me"; }),
      h("h2", {}, "設定")),
    h("div", { class: "settings" },
      h("div", { class: "panel" },
        h("div", { class: "me-head" }, avatar(S.me, 64), h("div", { class: "em" }, S.me.email)),
        h("div", { class: "field" }, h("h3", {}, "表示する名前"), nameIn),
        saveBtn),
      pushPanel,
      badgePanel,
      h("div", { class: "panel" },
        h("h3", {}, "ホーム画面に追加"),
        h("p", {}, "iPhone: Safariの共有ボタン →「ホーム画面に追加」"),
        h("p", {}, "Android: Chromeのメニュー →「ホーム画面に追加」または「アプリをインストール」")),
      h("div", { class: "panel" }, logout, h("p", { style: "text-align:center;font-size:12px" }, "バージョン " + APP_VERSION)))));
}

/* ---------- 通知 ---------- */

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
}
function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlB64ToUint8Array(b64) {
  const pad4 = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad4).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: S.me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

async function enablePush() {
  if (!pushConfigured) throw new Error("通知の鍵がまだ設定されていません");
  if (!pushSupported()) {
    throw new Error(isIos() ? "iPhoneでは、ホーム画面に追加してから開いてください" : "この端末では通知が使えません");
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("通知が許可されませんでした");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) });
  }
  await saveSubscription(sub);
}

// すでに許可ずみなら、この端末の登録がサーバーにあるか確かめる
async function syncPush() {
  try {
    if (!pushConfigured || !pushSupported() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await saveSubscription(sub);
  } catch (_) { /* 次の起動でもう一度ためす */ }
}

function pushBanner() {
  if (!pushConfigured) return null;
  if (!pushSupported()) {
    if (isIos() && !isStandalone()) {
      return h("div", { class: "banner" }, "通知を使うには、共有ボタンから「ホーム画面に追加」して、そのアイコンから開いてください。");
    }
    return null;
  }
  if (Notification.permission !== "default") return null;
  const banner = h("div", { class: "banner" }, h("span", {}, "新着をお知らせします"));
  const b = h("button", { class: "mini", type: "button" }, "通知をオンにする");
  b.addEventListener("click", async () => {
    try {
      await enablePush();
      banner.remove();
      toast("通知をオンにしました");
    } catch (err) {
      toast(err.message || "通知をオンにできませんでした");
    }
  });
  banner.append(b);
  return banner;
}

/* ================================================================== */
/* ステップ2: ひろば・部活・プロフィール・スタンプ                         */
/* ================================================================== */

/* ---------- 色 ---------- */

// すきな色(45色)。あわい・あざやか・ふかい × 15色
const SWATCH_HUES = [0, 15, 30, 45, 60, 90, 120, 150, 175, 195, 215, 240, 270, 300, 330];
const SWATCH_TONES = [["あわい", 80, 82], ["あざやか", 82, 65], ["ふかい", 76, 51]];
const SWATCHES = SWATCH_TONES.map(([name, s, l]) => ({ name, colors: SWATCH_HUES.map((hh) => hslToHex(hh, s, l)) }));

function colorsOf(p) {
  const list = (p && Array.isArray(p.colors) ? p.colors : []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c || ""));
  if (list.length >= 3) return list.slice(0, 3);
  const a = safeColor(p && p.color_a, "#c9a8ff");
  const b = safeColor(p && p.color_b, "#ff9ec7");
  const base = list.length ? list : [a, b];
  return [base[0], base[1] || b, base[2] || base[0]];
}

function hexToRgbArr(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// 色を白に寄せて、背景に使える淡さにする
function soften(hex, amt = 0.62) {
  const [r, g, b] = hexToRgbArr(hex);
  const m = (x) => Math.round(x + (255 - x) * amt);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
function softGradient(colors, amt) {
  return `linear-gradient(140deg,${colors.map((c) => soften(c, amt)).join(",")})`;
}

/* ---------- 写真の保存場所(ひろば・アイコン用) ---------- */

function mediaUrl(path) {
  return signedUrl(path, undefined, "media");
}

async function uploadMedia(blob, ext, contentType) {
  const path = `${S.me.id}/${newId()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, blob, { contentType });
  if (error) throw error;
  return path;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を作れませんでした"))), type, quality));
}

// データの置き場がまだない(まっちーのSQLがまだ)ときの見分け
function missingTable(err) {
  const m = (err && (err.message || "")) + " " + (err && err.code ? err.code : "");
  return /42P01|PGRST205|does not exist|Could not find the table|schema cache/i.test(m);
}
function notReadyPanel() {
  return h("div", { class: "panel" },
    h("h3", {}, "準備中です"),
    h("p", {}, "ひろばと部活のデータの置き場が、まだ作られていません。管理している人が SETUP.md の「ステップ2」を済ませると使えるようになります。"));
}

/* ---------- 画面の共通部品 ---------- */

const TABS = [["home", "ひろば", "#/"], ["clubs", "部活", "#/clubs"], ["talks", "トーク", "#/talks"], ["me", "わたし", "#/me"]];

function tabbar(active) {
  const unread = S.convs.reduce((sum, c) => sum + c.unread, 0);
  return h("nav", { class: "tabbar", "aria-label": "メニュー" },
    TABS.map(([id, label, href]) => h("a", { class: "tab" + (id === active ? " on" : ""), href, "aria-current": id === active ? "page" : null },
      h("span", { class: "tab-dot", "aria-hidden": "true" }),
      label,
      id === "talks" && unread > 0 ? h("span", { class: "tab-badge" }, unread > 99 ? "99+" : unread) : null)));
}

function brandbar() {
  return h("div", { class: "brandbar" },
    h("a", { class: "brand", href: "#/", "aria-label": "リラ ひろばへ" },
      h("img", { class: "brand-icon", src: "apple-touch-icon.png", alt: "" }),
      h("span", { class: "brand-word" }, "Lila")),
    h("button", { class: "me-btn", type: "button", "aria-label": "わたしのページ", onclick: () => { location.hash = "#/me"; } }, avatar(S.me, 40)));
}

function pageTitle(title, sub) {
  return h("div", { class: "page-title" }, h("h1", {}, title), sub ? h("p", {}, sub) : null);
}

function tabScreen(active, ...children) {
  return h("div", { class: "screen" }, brandbar(), h("div", { class: "page" }, ...children), tabbar(active));
}

function personById(id) {
  if (S.me && id === S.me.id) return S.me;
  return S.people.find((p) => p.id === id) || { id, name: "(名前なし)" };
}

const STAR_D = "M20,2 Q21.44,31.44 38,34 Q21.44,36.56 20,66 Q18.56,36.56 2,34 Q18.56,31.44 20,2 Z";
function starSvg(w, hgt, fill) {
  const s = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 40 68", width: w, height: hgt, "aria-hidden": "true" })) s.setAttribute(k, v);
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", STAR_D);
  p.setAttribute("fill", fill);
  s.append(p);
  return s;
}

// ひろばの一番上の、横幅いっぱいのタイトル
function hero() {
  const wrap = h("section", { class: "hero", "aria-label": "高次元SNS リラ 声と色でつながる場所" });
  const t = document.createElement("template");
  const sp = (x, y, r, fill, o = 1) => {
    const a = r * 0.14;
    return `<path d="M${x},${y - r} Q${x + a},${y - a} ${x + r},${y} Q${x + a},${y + a} ${x},${y + r} Q${x - a},${y + a} ${x - r},${y} Q${x - a},${y - a} ${x},${y - r} Z" fill="${fill}" opacity="${o}"/>`;
  };
  t.innerHTML = `<svg class="hero-art" viewBox="0 0 400 190" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs><linearGradient id="heroBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<g transform="rotate(-10 200 100)"><ellipse cx="200" cy="100" rx="176" ry="46" fill="none" stroke="#fff" stroke-width="1.6" opacity=".4"/><ellipse cx="200" cy="100" rx="196" ry="58" fill="none" stroke="#fff" stroke-width="1" opacity=".2"/></g>
<g transform="translate(358 26) scale(.82)"><polygon points="-10,6 10,6 26,70 -26,70" fill="url(#heroBeam)"/><path d="M-15,-2 A15,15 0 0 1 15,-2 Z" fill="#fff" opacity=".8"/><ellipse cx="0" cy="0" rx="34" ry="9.5" fill="#fff"/><ellipse cx="0" cy="3" rx="23" ry="4.5" fill="#e6dcfa"/><circle cx="-15" cy="2" r="1.9" fill="#fff3c4"/><circle cx="0" cy="4" r="1.9" fill="#fff3c4"/><circle cx="15" cy="2" r="1.9" fill="#fff3c4"/></g>
${[[40, 34, 9, 1], [78, 150, 6, 0.9], [24, 104, 5, 0.85], [120, 22, 5, 0.9], [262, 24, 6, 0.9], [372, 128, 7, 0.95], [300, 164, 5, 0.85], [196, 172, 4, 0.8], [58, 70, 3.5, 0.8]].map((s) => sp(s[0], s[1], s[2], "#fff", s[3])).join("")}
${[[338, 96, 6], [150, 160, 4.5], [96, 44, 4]].map((s) => sp(s[0], s[1], s[2], "#fff3c4")).join("")}
</svg>`;
  wrap.append(t.content.firstChild,
    h("div", { class: "hero-in", "aria-hidden": "true" },
      h("div", { class: "hero-l1" }, "高次元SNSリラ"),
      h("div", { class: "hero-name" }, "Lila", starSvg(20, 34, "#fff3c4")),
      h("div", { class: "hero-l2" }, "声と色でつながる場所")));
  return wrap;
}

/* ---------- データ(ひろば・部活) ---------- */

const SOC = { clubs: [], members: [], progress: [], loaded: false, ready: true };

async function loadClubs() {
  const [c, m, p] = await Promise.all([
    supabase.from("clubs").select("*").order("created_at"),
    supabase.from("club_members").select("club_id, user_id"),
    supabase.from("club_progress").select("club_id, user_id, amount"),
  ]);
  const err = c.error || m.error || p.error;
  if (err) {
    if (missingTable(err)) { SOC.ready = false; return; }
    throw err;
  }
  SOC.ready = true;
  SOC.clubs = c.data || [];
  SOC.members = m.data || [];
  SOC.progress = p.data || [];
  SOC.loaded = true;
}

const clubMembers = (cid) => SOC.members.filter((x) => x.club_id === cid).map((x) => x.user_id);
const inClub = (cid) => SOC.members.some((x) => x.club_id === cid && x.user_id === S.me.id);
function clubContrib(cid) {
  const map = new Map();
  SOC.progress.filter((x) => x.club_id === cid).forEach((x) => map.set(x.user_id, (map.get(x.user_id) || 0) + x.amount));
  return map;
}
const clubDone = (cid) => [...clubContrib(cid).values()].reduce((a, b) => a + b, 0);

async function loadPosts(filter) {
  let q = supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(60);
  if (filter && filter.club) q = q.eq("club_id", filter.club);
  if (filter && filter.author) q = q.eq("author_id", filter.author);
  const { data, error } = await q;
  if (error) {
    if (missingTable(error)) { SOC.ready = false; return []; }
    throw error;
  }
  const posts = data || [];
  if (posts.length) {
    const { data: lights } = await supabase.from("post_lights").select("post_id, user_id").in("post_id", posts.map((p) => p.id));
    posts.forEach((p) => { p.lights = (lights || []).filter((l) => l.post_id === p.id).map((l) => l.user_id); });
  }
  return posts;
}

/* ---------- 投稿 ---------- */

async function createPost(fields) {
  const { error } = await supabase.from("posts").insert({ author_id: S.me.id, ...fields });
  if (error) throw error;
}

function composer(club) {
  let tag = null;
  const input = h("textarea", { class: "post-in", rows: 2, maxLength: 2000, placeholder: "いまの気持ち、やってみたいこと", "aria-label": "つぶやき" });
  const tags = ["きもち", "やってみたい"].map((t) => h("button", {
    type: "button", class: "chip-btn", "aria-pressed": "false",
    onclick: () => {
      tag = tag === t ? null : t;
      tags.forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === tag)));
    },
  }, t));
  const fileIn = h("input", { type: "file", accept: "image/*", hidden: true });
  const target = club ? "club-" + club : "home";
  const sendBtn = h("button", { class: "primary small", type: "submit" }, "つぶやく");
  const photoBtn = h("button", { class: "secondary small", type: "button", onclick: () => fileIn.click() }, "写真");

  fileIn.addEventListener("change", async () => {
    const file = fileIn.files && fileIn.files[0];
    fileIn.value = "";
    if (!file) return;
    photoBtn.disabled = true;
    try {
      const blob = await downscale(file);
      const path = await uploadMedia(blob, "jpg", "image/jpeg");
      await createPost({ kind: "photo", file_path: path, body: input.value.trim(), tag, club_id: club || null });
      input.value = "";
      toast("写真を投稿しました");
      route();
    } catch (err) {
      toast("投稿できませんでした: " + jpError(err));
    } finally {
      photoBtn.disabled = false;
    }
  });

  return h("form", {
    class: "panel composer-card",
    onsubmit: async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) { input.focus(); return; }
      sendBtn.disabled = true;
      try {
        await createPost({ kind: "text", body, tag, club_id: club || null });
        input.value = "";
        route();
      } catch (err) {
        toast("投稿できませんでした: " + jpError(err));
      } finally {
        sendBtn.disabled = false;
      }
    },
  },
  h("div", { class: "composer-top" }, avatar(S.me, 40), input),
  h("div", { class: "chips-row" }, h("span", { class: "chips-label" }, "しるし"), tags),
  h("div", { class: "make-row" },
    h("button", { class: "secondary small", type: "button", onclick: () => { location.hash = "#/aura/" + target; } }, "今日のイメージ"),
    h("button", { class: "secondary small", type: "button", onclick: () => { location.hash = "#/stamp/" + target; } }, "スタンプ"),
    photoBtn,
    sendBtn),
  fileIn);
}

function postCard(p) {
  const who = personById(p.author_id);
  const lights = p.lights || [];
  const mine = lights.includes(S.me.id);
  const club = p.club_id ? SOC.clubs.find((c) => c.id === p.club_id) : null;
  const glowColor = lights.length ? colorsOf(personById(lights[lights.length - 1]))[0] : null;

  let media = null;
  if (p.file_path) {
    const img = h("img", { class: "post-img " + p.kind, alt: p.kind === "aura" ? "今日のイメージ" : p.kind === "stamp" ? "スタンプ" : "写真" });
    mediaUrl(p.file_path).then((u) => { if (u) img.src = u; });
    if (p.kind === "photo") img.addEventListener("click", () => openViewer(p.file_path, "media"));
    media = img;
  }

  const lightBtn = h("button", { class: "light-btn" + (mine ? " on" : ""), type: "button", "aria-pressed": String(mine) }, mine ? "光をおくった" : "光をおくる");
  lightBtn.addEventListener("click", async () => {
    lightBtn.disabled = true;
    const q = mine
      ? supabase.from("post_lights").delete().eq("post_id", p.id).eq("user_id", S.me.id)
      : supabase.from("post_lights").insert({ post_id: p.id, user_id: S.me.id });
    const { error } = await q;
    lightBtn.disabled = false;
    if (error) return toast("光をおくれませんでした: " + jpError(error));
    p.lights = mine ? lights.filter((x) => x !== S.me.id) : [...lights, S.me.id];
    card.replaceWith(postCard(p));
  });

  const del = p.author_id === S.me.id
    ? h("button", { class: "mini-link", type: "button", onclick: async () => {
      if (!window.confirm("この投稿を消しますか？")) return;
      const { error } = await supabase.from("posts").delete().eq("id", p.id);
      if (error) return toast("消せませんでした: " + jpError(error));
      card.remove();
    } }, "消す")
    : null;

  const card = h("article", { class: "panel post", style: glowColor ? `box-shadow:0 8px 30px rgba(110,80,200,0.1),0 0 0 1.5px ${soften(glowColor, 0.3)},0 0 26px ${soften(glowColor, 0.2)}` : null },
    h("div", { class: "post-head" },
      h("a", { href: "#/u/" + who.id, class: "post-who", "aria-label": who.name + "のページ" }, avatar(who, 40)),
      h("div", { class: "post-meta" },
        h("a", { href: "#/u/" + who.id, class: "post-name" }, who.name || "(名前なし)"),
        h("span", { class: "post-time" }, listTime(p.created_at))),
      p.tag ? h("span", { class: "tag" }, p.tag) : null),
    club ? h("a", { class: "club-chip", href: "#/clubs/" + club.id }, club.name) : null,
    p.body ? h("p", { class: "post-body" }, p.body) : null,
    media,
    h("div", { class: "post-foot" },
      lightBtn,
      h("div", { class: "dots", "aria-label": lights.length + "人の光" },
        lights.slice(-8).map((id) => h("i", { style: `background:${colorsOf(personById(id))[0]}`, title: personById(id).name }))),
      lights.length ? h("span", { class: "post-time" }, lights.length + "人の色がとどいています") : null,
      h("span", { style: "flex:1" }),
      del));
  return card;
}

function feed(posts) {
  if (!posts.length) return h("div", { class: "empty" }, "まだ投稿がありません", h("br"), "最初のひとことを置いてみましょう");
  return h("div", { class: "feed" }, posts.map(postCard));
}

/* ---------- ひろば ---------- */

async function showHome() {
  S.view = { name: "home" };
  const nav = S.nav;
  const body = h("div", { class: "feed-wrap" }, h("div", { class: "empty" }, "読み込んでいます"));
  setScreen(tabScreen("home", hero(), pageTitle("ひろば", "気持ちや、やってみたいことを置く場所"), pushBanner(), composer(null), body));
  try {
    if (!SOC.loaded) await loadClubs();
    const posts = await loadPosts();
    if (nav !== S.nav) return;
    body.replaceChildren(SOC.ready ? feed(posts) : notReadyPanel());
  } catch (err) {
    if (nav === S.nav) body.replaceChildren(h("div", { class: "empty" }, "読み込めませんでした: " + jpError(err)));
  }
}

/* ---------- 部活 ---------- */

function clubBar(c) {
  const contrib = clubContrib(c.id);
  const done = clubDone(c.id);
  return h("div", { class: "bar", role: "img", "aria-label": `${done}${c.unit} / ${c.target}${c.unit}` },
    [...contrib.entries()].map(([uid, n]) => h("i", { style: `width:${Math.min(100, (n / c.target) * 100)}%;background:${colorsOf(personById(uid))[0]}`, title: personById(uid).name + " " + n + c.unit })));
}

function memberFaces(ids, size = 30) {
  return h("div", { class: "members" }, ids.slice(0, 8).map((id) => avatar(personById(id), size)));
}

async function showClubs() {
  S.view = { name: "clubs" };
  const nav = S.nav;
  const body = h("div", { class: "feed" }, h("div", { class: "empty" }, "読み込んでいます"));
  setScreen(tabScreen("clubs", pageTitle("部活", "同じ「すき」や目標であつまる場所"), body));
  try {
    await loadClubs();
    if (nav !== S.nav) return;
    if (!SOC.ready) return body.replaceChildren(notReadyPanel());
    const name = h("input", { type: "text", maxLength: 40, placeholder: "部活の名前（例：星をながめる会）", "aria-label": "部活の名前" });
    const goal = h("input", { type: "text", maxLength: 80, placeholder: "いっしょの目標（例：星空を20回みる）", "aria-label": "いっしょの目標" });
    const target = h("input", { type: "number", min: 1, max: 1000, value: 20, "aria-label": "目標の数" });
    const unit = h("input", { type: "text", maxLength: 4, value: "回", "aria-label": "単位" });
    const make = h("button", { class: "primary small", type: "submit" }, "つくる");
    body.replaceChildren(
      ...SOC.clubs.map((c) => h("a", { class: "panel club-card", href: "#/clubs/" + c.id },
        h("div", { class: "club-name" }, c.name),
        c.description ? h("p", {}, c.description) : null,
        c.goal ? h("p", { class: "club-goal" }, "いっしょの目標　" + c.goal) : null,
        clubBar(c),
        h("div", { class: "club-foot" },
          memberFaces(clubMembers(c.id)),
          h("span", { class: "post-time" }, `${clubMembers(c.id).length}人　${clubDone(c.id)} / ${c.target}${c.unit}`),
          inClub(c.id) ? h("span", { class: "tag" }, "参加中") : null))),
      h("form", {
        class: "panel",
        onsubmit: async (e) => {
          e.preventDefault();
          if (!name.value.trim()) return name.focus();
          make.disabled = true;
          const { data, error } = await supabase.from("clubs").insert({
            name: name.value.trim(), goal: goal.value.trim() || "これから決める",
            target: Math.max(1, Math.min(1000, parseInt(target.value, 10) || 20)), unit: unit.value.trim() || "回",
            description: `${S.me.name}がつくった部活`, created_by: S.me.id,
          }).select().single();
          make.disabled = false;
          if (error) return toast("つくれませんでした: " + jpError(error));
          SOC.loaded = false;
          location.hash = "#/clubs/" + data.id;
        },
      },
      h("h3", {}, "あたらしい部活をつくる"),
      h("div", { class: "field" }, name),
      h("div", { class: "field" }, goal),
      h("div", { class: "field-row" }, h("label", {}, "目標の数", target), h("label", {}, "単位", unit)),
      make));
  } catch (err) {
    if (nav === S.nav) body.replaceChildren(h("div", { class: "empty" }, "読み込めませんでした: " + jpError(err)));
  }
}

async function showClub(cid) {
  S.view = { name: "club", cid };
  const nav = S.nav;
  const body = h("div", { class: "feed" }, h("div", { class: "empty" }, "読み込んでいます"));
  setScreen(h("div", { class: "screen" },
    h("div", { class: "topbar" }, iconBtn("もどる", ICON.back, () => { location.hash = "#/clubs"; }), h("h2", {}, "部活")),
    h("div", { class: "page" }, body),
    tabbar("clubs")));
  try {
    await loadClubs();
    if (nav !== S.nav) return;
    if (!SOC.ready) return body.replaceChildren(notReadyPanel());
    const c = SOC.clubs.find((x) => x.id === cid);
    if (!c) { location.hash = "#/clubs"; return; }
    const joined = inClub(c.id);
    const members = clubMembers(c.id);
    const posts = await loadPosts({ club: c.id });
    if (nav !== S.nav) return;

    const plus = h("button", { class: "primary small", type: "button" }, "＋1 すすめた");
    plus.addEventListener("click", async () => {
      if (clubDone(c.id) >= c.target) return toast("目標に届いています🎉");
      plus.disabled = true;
      const { error } = await supabase.from("club_progress").insert({ club_id: c.id, user_id: S.me.id, amount: 1 });
      plus.disabled = false;
      if (error) return toast("記録できませんでした: " + jpError(error));
      SOC.loaded = false;
      route();
    });
    const joinBtn = h("button", { class: joined ? "secondary small" : "primary small", type: "button" }, joined ? "ぬける" : "参加する");
    joinBtn.addEventListener("click", async () => {
      joinBtn.disabled = true;
      const q = joined
        ? supabase.from("club_members").delete().eq("club_id", c.id).eq("user_id", S.me.id)
        : supabase.from("club_members").insert({ club_id: c.id, user_id: S.me.id });
      const { error } = await q;
      joinBtn.disabled = false;
      if (error) return toast("できませんでした: " + jpError(error));
      SOC.loaded = false;
      route();
    });

    const mix = members.length ? members.slice(0, 3).map((id) => colorsOf(personById(id))[0]) : colorsOf(S.me);
    body.replaceChildren(
      h("section", { class: "panel club-head", style: `background:${softGradient(mix.length >= 2 ? mix : [mix[0], mix[0]], 0.7)}` },
        h("h1", { class: "club-title" }, c.name),
        c.description ? h("p", {}, c.description) : null),
      h("section", { class: "panel" },
        h("h3", {}, "いっしょの目標"),
        h("p", { class: "club-goal-big" }, c.goal || "これから決める"),
        clubBar(c),
        h("div", { class: "club-foot" },
          h("span", { class: "post-time" }, `${clubDone(c.id)} / ${c.target}${c.unit}　色は、すすめた人の色`),
          h("span", { style: "flex:1" }),
          joined ? plus : null)),
      h("section", { class: "panel" },
        h("div", { class: "club-foot" }, memberFaces(members, 34), h("span", { class: "post-time" }, members.length + "人"), h("span", { style: "flex:1" }), joinBtn)),
      joined ? composer(c.id) : null,
      h("h3", { class: "section-title" }, posts.length ? "この部活の投稿" : "まだ投稿がありません"),
      ...posts.map(postCard));
  } catch (err) {
    if (nav === S.nav) body.replaceChildren(h("div", { class: "empty" }, "読み込めませんでした: " + jpError(err)));
  }
}

/* ---------- プロフィール ---------- */

const ICON_EMOJIS = ["🦄", "🪽", "🌸", "🐴", "🌈", "🌙", "🍀", "⭐", "🌿", "🐱", "☁️", "🔮", "🌻", "🐰", "🦋", "🐬", "🕊️", "🌷", "🍓", "🌼", "🎀", "🫧", "🐚", "🪷"];

async function showProfile(uid) {
  const mine = uid === S.me.id;
  S.view = { name: "profile", uid };
  const nav = S.nav;
  const p = personById(uid);
  const cols = colorsOf(p);
  const body = h("div", { class: "feed" });

  const head = h("section", { class: "panel profile-head", style: `background:${softGradient(cols, 0.55)}` },
    avatar(p, 108),
    h("h1", { class: "profile-name" }, p.name || "(名前なし)"),
    h("div", { class: "profile-label" }, "すきな色"),
    h("div", { class: "swatch-row" }, cols.map((c) => h("i", { class: "swatch", style: `background:${c}` }))),
    mine
      ? h("div", { class: "make-row" },
        h("button", { class: "primary small", type: "button", onclick: () => { location.hash = "#/me/edit"; } }, "プロフィールを編集"),
        h("button", { class: "secondary small", type: "button", onclick: () => { location.hash = "#/settings"; } }, "設定"))
      : h("button", { class: "primary small", type: "button", onclick: () => startDm(p.id) }, "トークする"));

  const likes = Array.isArray(p.likes) ? p.likes : [];
  const about = h("section", { class: "panel" },
    h("h3", {}, "すきなこと"),
    likes.length ? h("div", { class: "chips-row" }, likes.map((l) => h("span", { class: "tag" }, l))) : h("p", {}, mine ? "まだ書いていません。編集から足せます" : "まだ書いていません"),
    h("h3", {}, "ゆめ"),
    h("p", {}, p.dream || (mine ? "まだ書いていません。編集から足せます" : "まだ書いていません")));

  const screen = mine
    ? tabScreen("me", head, about, body)
    : h("div", { class: "screen", style: `background:${softGradient(cols, 0.8)}` },
      h("div", { class: "topbar" }, iconBtn("もどる", ICON.back, () => history.back()), h("h2", {}, p.name + "のページ")),
      h("div", { class: "page" }, head, about, body),
      tabbar(null));
  setScreen(screen);

  try {
    if (!SOC.loaded) await loadClubs();
    const posts = await loadPosts({ author: uid });
    if (nav !== S.nav) return;
    if (!SOC.ready) return body.replaceChildren(notReadyPanel());
    const clubs = SOC.clubs.filter((c) => SOC.members.some((m) => m.club_id === c.id && m.user_id === uid));
    body.replaceChildren(
      h("section", { class: "panel" },
        h("h3", {}, "入っている部活"),
        clubs.length ? h("div", { class: "chips-row" }, clubs.map((c) => h("a", { class: "club-chip", href: "#/clubs/" + c.id }, c.name))) : h("p", {}, "まだありません")),
      h("h3", { class: "section-title" }, posts.length ? "投稿" : "まだ投稿がありません"),
      ...posts.map(postCard));
  } catch (err) {
    if (nav === S.nav) body.replaceChildren(h("div", { class: "empty" }, "読み込めませんでした: " + jpError(err)));
  }
}

function showProfileEdit() {
  S.view = { name: "profile-edit" };
  const draft = {
    name: S.me.name || "",
    colors: colorsOf(S.me).slice(),
    likes: (Array.isArray(S.me.likes) ? S.me.likes : []).join("、"),
    dream: S.me.dream || "",
    icon_kind: S.me.icon_kind || "char",
    icon_value: S.me.icon_value || "",
  };
  let slot = 0;
  const preview = h("div", { class: "edit-preview" });
  const slots = h("div", { class: "swatch-row" });
  const fileIn = h("input", { type: "file", accept: "image/*", hidden: true });
  const nameIn = h("input", { type: "text", maxLength: 20, value: draft.name, "aria-label": "名前" });
  const likesIn = h("input", { type: "text", maxLength: 200, value: draft.likes, placeholder: "阿蘇、お馬さん、きれいな色", "aria-label": "すきなこと" });
  const dreamIn = h("textarea", { rows: 2, maxLength: 300, placeholder: "自然のなかで、お馬さんと暮らすこと", "aria-label": "ゆめ" });
  dreamIn.value = draft.dream;
  const saveBtn = h("button", { class: "primary", type: "button" }, "保存する");

  const draw = () => {
    preview.replaceChildren(avatar({ ...S.me, ...draft, name: nameIn.value || draft.name }, 96));
    slots.replaceChildren(...draft.colors.map((c, i) => h("button", {
      type: "button", class: "swatch big" + (i === slot ? " on" : ""), style: `background:${c}`, "aria-label": `${i + 1}つめの色`, "aria-pressed": String(i === slot),
      onclick: () => { slot = i; draw(); },
    })));
  };

  fileIn.addEventListener("change", async () => {
    const file = fileIn.files && fileIn.files[0];
    fileIn.value = "";
    if (!file) return;
    try {
      const blob = await downscale(file, 480, 0.85);
      draft.icon_value = await uploadMedia(blob, "jpg", "image/jpeg");
      draft.icon_kind = "photo";
      draw();
    } catch (err) {
      toast("写真を使えませんでした: " + jpError(err));
    }
  });

  saveBtn.addEventListener("click", async () => {
    const name = nameIn.value.trim();
    if (!name) return toast("名前を入れてください");
    saveBtn.disabled = true;
    const row = {
      name,
      colors: draft.colors,
      color_a: draft.colors[0],
      color_b: draft.colors[1],
      likes: likesIn.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 12),
      dream: dreamIn.value.trim(),
      icon_kind: draft.icon_kind,
      icon_value: draft.icon_value,
    };
    const { error } = await supabase.from("profiles").update(row).eq("id", S.me.id);
    saveBtn.disabled = false;
    if (error) {
      if (missingTable(error) || /column/i.test(error.message || "")) return toast("プロフィールの新しい項目は、まだ準備中です（SETUP.md の「ステップ2」）");
      return toast("保存できませんでした: " + jpError(error));
    }
    Object.assign(S.me, row);
    const pp = S.people.find((x) => x.id === S.me.id);
    if (pp) Object.assign(pp, row);
    toast("保存しました");
    location.hash = "#/me";
  });

  setScreen(h("div", { class: "screen" },
    h("div", { class: "topbar" }, iconBtn("もどる", ICON.back, () => { location.hash = "#/me"; }), h("h2", {}, "プロフィールを編集")),
    h("div", { class: "page" },
      h("section", { class: "panel" },
        h("h3", {}, "アイコン"),
        preview,
        h("div", { class: "make-row" },
          h("button", { class: "secondary small", type: "button", onclick: () => fileIn.click() }, "写真をえらぶ"),
          h("button", { class: "secondary small", type: "button", onclick: () => { draft.icon_kind = "char"; draft.icon_value = ""; draw(); } }, "名前の文字にする")),
        h("div", { class: "icon-grid" }, ICON_EMOJIS.map((em) => h("button", {
          type: "button", class: "emoji-btn", "aria-label": em + "をアイコンにする",
          onclick: () => { draft.icon_kind = "emoji"; draft.icon_value = em; draw(); },
        }, em))),
        fileIn),
      h("section", { class: "panel" },
        h("h3", {}, "すきな色（3つ）"),
        h("p", {}, "変えたい丸をえらんでから、下の45色からえらびます"),
        slots,
        ...SWATCHES.map((tone) => h("div", { class: "tone" },
          h("span", { class: "chips-label" }, tone.name),
          h("div", { class: "swatch-grid" }, tone.colors.map((c) => h("button", {
            type: "button", class: "swatch", style: `background:${c}`, "aria-label": tone.name + "の色",
            onclick: () => { draft.colors[slot] = c; slot = (slot + 1) % 3; draw(); },
          })))))),
      h("section", { class: "panel" },
        h("div", { class: "field" }, h("h3", {}, "名前"), nameIn),
        h("div", { class: "field" }, h("h3", {}, "すきなこと（「、」でくぎる）"), likesIn),
        h("div", { class: "field" }, h("h3", {}, "ゆめ"), dreamIn)),
      saveBtn)));
  draw();
}

/* ---------- スタンプを作る ---------- */

// target: トークのID、または "home" / "club-<部活のID>"
function auraTarget(target) {
  if (target === "home") return { kind: "post", club: null, back: "#/" };
  if (target.startsWith("club-")) return { kind: "post", club: target.slice(5), back: "#/clubs/" + target.slice(5) };
  const conv = S.convs.find((c) => c.id === target);
  return conv ? { kind: "dm", conv, back: "#/chat/" + conv.id } : null;
}

function showStamp(target) {
  const t = auraTarget(target);
  if (!t) { location.hash = "#/talks"; return; }
  S.view = { name: "stamp" };
  const st = { strokes: [], mode: "kata", kata: "neko", face: "niko", deco: "hane", border: "white", cands: [] };
  const pad = h("canvas", { class: "stamp-pad", width: 500, height: 500, "aria-label": "ここに描く" });
  const out = h("canvas", { class: "stamp-out", width: 360, height: 360, role: "img", "aria-label": "できあがりのスタンプ" });
  const pctx = pad.getContext("2d");
  const hint = h("p", { class: "hint" }, "ねこ・ハート・星などを、指でかんたんに描いてみてね");
  const kataRow = h("div", { class: "chips-row" });
  const faceRow = h("div", { class: "chips-row" });
  const decoRow = h("div", { class: "chips-row" });
  const borderRow = h("div", { class: "chips-row" });
  const tabKata = h("button", { class: "seg-btn on", type: "button" }, "型にする");
  const tabTidy = h("button", { class: "seg-btn", type: "button" }, "線を整える");
  const kataBox = h("div", {}, h("span", { class: "chips-label" }, "これかな？（ちがったら選び直せます）"), kataRow);
  const sendBtn = h("button", { class: "primary", type: "button", style: "flex:2" }, "送る");
  const clearBtn = h("button", { class: "secondary", type: "button", style: "flex:1" }, "ぜんぶ消す");

  const colors = colorsOf(S.me);
  const opts = () => ({ mode: st.mode, kata: st.kata, face: st.face, deco: st.deco, border: st.border, strokes: st.strokes, colors });

  function drawPad() {
    pctx.clearRect(0, 0, 500, 500);
    pctx.lineCap = "round"; pctx.lineJoin = "round"; pctx.lineWidth = 6; pctx.strokeStyle = "#5a5080";
    for (const s of st.strokes) {
      pctx.beginPath();
      s.forEach((q, i) => pctx[i ? "lineTo" : "moveTo"](q[0], q[1]));
      if (s.length === 1) pctx.lineTo(s[0][0] + 0.1, s[0][1]);
      pctx.stroke();
    }
  }
  function chipRow(el, items, key) {
    el.replaceChildren(...items.map(([id, label, guess]) => h("button", {
      type: "button", class: "chip-btn" + (guess ? " guess" : ""), "aria-pressed": String(st[key] === id),
      onclick: () => { st[key] = id; sync(); },
    }, label)));
  }
  function sync() {
    const order = st.cands.length ? st.cands.map((c) => c.id) : TEMPLATES.map((x) => x.id);
    chipRow(kataRow, order.map((id, i) => [id, TEMPLATES.find((x) => x.id === id).name, i < 3 && st.strokes.length]), "kata");
    chipRow(faceRow, FACES, "face");
    chipRow(decoRow, DECOS, "deco");
    chipRow(borderRow, BORDERS, "border");
    kataBox.hidden = st.mode !== "kata";
    tabKata.classList.toggle("on", st.mode === "kata");
    tabTidy.classList.toggle("on", st.mode === "tidy");
    drawStamp(out.getContext("2d"), 360, opts());
    sendBtn.disabled = st.mode === "tidy" && !st.strokes.length;
  }
  function afterDraw() {
    st.cands = recognize(st.strokes);
    if (st.strokes.length) st.kata = st.cands[0].id;
    sync();
  }
  const pos = (e) => {
    const r = pad.getBoundingClientRect();
    return [((e.clientX - r.left) * 500) / r.width, ((e.clientY - r.top) * 500) / r.height];
  };
  let drawing = null;
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { pad.setPointerCapture(e.pointerId); } catch (_) { /* なくても描ける */ }
    drawing = [pos(e)];
    st.strokes.push(drawing);
    drawPad();
  });
  pad.addEventListener("pointermove", (e) => { if (!drawing) return; e.preventDefault(); drawing.push(pos(e)); drawPad(); });
  const end = () => { if (!drawing) return; drawing = null; afterDraw(); };
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  clearBtn.addEventListener("click", () => { st.strokes = []; drawPad(); afterDraw(); });
  tabKata.addEventListener("click", () => { st.mode = "kata"; sync(); });
  tabTidy.addEventListener("click", () => { st.mode = "tidy"; sync(); });

  sendBtn.addEventListener("click", async () => {
    sendBtn.disabled = true;
    try {
      const big = document.createElement("canvas");
      big.width = big.height = 512;
      drawStamp(big.getContext("2d"), 512, opts());
      const blob = await canvasBlob(big, "image/png");
      if (t.kind === "dm") {
        const path = `${t.conv.id}/${newId()}.png`;
        const up = await supabase.storage.from("chat").upload(path, blob, { contentType: "image/png" });
        if (up.error) throw up.error;
        const { data, error } = await supabase.from("messages")
          .insert({ conversation_id: t.conv.id, sender_id: S.me.id, kind: "image", file_path: path, body: "stamp" })
          .select().single();
        if (error) throw error;
        onNewMessage(data);
      } else {
        const path = await uploadMedia(blob, "png", "image/png");
        await createPost({ kind: "stamp", file_path: path, club_id: t.club });
      }
      location.hash = t.back;
    } catch (err) {
      toast("送れませんでした: " + jpError(err));
      sendBtn.disabled = false;
    }
  });

  setScreen(h("div", { class: "screen" },
    h("div", { class: "topbar" }, iconBtn("とじる", ICON.back, () => { location.hash = t.back; }), h("h2", {}, "スタンプを作る")),
    h("div", { class: "aura-body" },
      h("div", { class: "stamp-top" },
        h("div", { class: "stamp-pad-wrap" }, pad),
        h("div", { class: "stamp-out-wrap" }, out, h("span", { class: "chips-label" }, "できあがり"))),
      hint,
      h("div", { class: "seg" }, tabKata, tabTidy),
      kataBox,
      h("div", {}, h("span", { class: "chips-label" }, "かお"), faceRow),
      h("div", {}, h("span", { class: "chips-label" }, "かざり"), decoRow),
      h("div", {}, h("span", { class: "chips-label" }, "ふち"), borderRow),
      h("p", { class: "hint" }, "色は、プロフィールの「すきな色」で染まります")),
    h("div", { class: "aura-actions" }, clearBtn, sendBtn)));
  drawPad();
  sync();
}

/* ---------- 今日のイメージ(なぞる・絵文字・声) ---------- */

function showAura(target) {
  const t = auraTarget(target);
  if (!t) { location.hash = "#/talks"; return; }
  S.view = { name: "aura" };

  const st = { mode: "draw", picks: [], seed: Math.floor(Math.random() * 1e9), colors: [], voice: null, rec: null };

  const canvas = h("canvas", { class: "aura-canvas", role: "img", "aria-label": "今日のイメージ" });
  const hint = h("p", { class: "hint" });
  const chips = h("div", { class: "chips" });
  const ring = h("input", { type: "checkbox", checked: true });
  const sendBtn = h("button", { class: "primary", type: "button", style: "flex:2" }, "送る");
  const redoBtn = h("button", { class: "secondary", type: "button", style: "flex:1" }, "やり直す");
  const grid = h("div", { class: "emoji-grid", hidden: true });
  const tabDraw = h("button", { class: "seg-btn on", type: "button" }, "なぞる");
  const tabEmoji = h("button", { class: "seg-btn", type: "button" }, "絵文字");
  const tabVoice = h("button", { class: "seg-btn", type: "button" }, "声");
  const recBtn = h("button", { class: "primary small", type: "button" }, "● 録音する");
  const fileIn = h("input", { type: "file", accept: "audio/*,video/mp4,.m4a,.mp3,.wav,.aac", hidden: true });
  const fileBtn = h("button", { class: "secondary small", type: "button", onclick: () => fileIn.click() }, "音声ファイルから");
  const playBtn = h("button", { class: "secondary small", type: "button", hidden: true }, "声をきく");
  const voiceInfo = h("p", { class: "hint" });
  const voiceBox = h("div", { class: "voice-box", hidden: true }, h("div", { class: "make-row" }, recBtn, fileBtn, playBtn), voiceInfo, fileIn);
  const caption = t.kind === "post" ? h("input", { class: "caption-in", type: "text", maxLength: 200, placeholder: "ひとこと（なくてもOK）", "aria-label": "ひとこと" }) : null;

  const editor = createStrokeEditor(canvas, () => {
    if (st.mode === "draw") { st.colors = editor.palette(); sync(); }
  });

  function sync() {
    chips.replaceChildren(
      h("span", { class: "chips-label" }, "今日の色"),
      ...st.colors.map((c) => h("span", { class: "chip", style: `background:${safeColor(c, "#c9a8ff")};box-shadow:0 0 10px ${safeColor(c, "#c9a8ff")}cc` })),
    );
    sendBtn.disabled = st.colors.length === 0;
    hint.textContent = st.mode === "draw"
      ? "指でなぞると、今日の色が生まれます。何度でも重ねられます"
      : st.mode === "emoji"
        ? (st.picks.length ? "絵文字をえらびなおすと、光も変わります(3つまで)" : "絵文字を2〜3個えらんでください(3つまで)")
        : "「あー」と声を出してみてね。高い声はピンク、低い声は青むらさきになります";
    grid.querySelectorAll("button").forEach((b) => {
      const on = st.picks.some((p) => p.e === b.dataset.e);
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("on", on);
    });
  }

  function stopRec() {
    if (st.rec) { st.rec.stop(); st.rec = null; }
  }

  function setMode(mode) {
    stopRec();
    st.mode = mode;
    tabDraw.classList.toggle("on", mode === "draw");
    tabEmoji.classList.toggle("on", mode === "emoji");
    tabVoice.classList.toggle("on", mode === "voice");
    grid.hidden = mode !== "emoji";
    voiceBox.hidden = mode !== "voice";
    editor.setEnabled(mode === "draw");
    if (mode === "draw") {
      editor.reset();
      st.colors = [];
    } else if (mode === "emoji") {
      st.colors = renderEmojiAura(canvas, st.picks, st.seed);
    } else {
      editor.reset();
      st.colors = st.voice ? paintVoice(canvas, st.voice) : [];
    }
    sync();
  }

  async function useAudio(blob) {
    try {
      voiceInfo.textContent = "読みこんでいます";
      const buffer = await decodeAudio(blob);
      const v = analyzeVoice(buffer.getChannelData(0), buffer.sampleRate);
      if (!v.hues.length) {
        voiceInfo.textContent = "声をうまく読みとれませんでした。もう少し長く、はっきり「あー」と出してみてね";
        return;
      }
      st.voice = v;
      st.voiceBuffer = buffer;
      st.colors = paintVoice(canvas, v);
      voiceInfo.textContent = `声の高さ 約${v.pitch}Hz　長さ ${v.duration.toFixed(1)}秒`;
      playBtn.hidden = false;
      sync();
    } catch (err) {
      voiceInfo.textContent = err.message || "この音声は読みこめませんでした";
    }
  }

  recBtn.addEventListener("click", async () => {
    if (st.rec) {
      const r = st.rec;
      st.rec = null;
      recBtn.textContent = "● 録音する";
      useAudio(await r.stop());
      return;
    }
    try {
      const r = await startRecording(8);
      st.rec = r;
      recBtn.textContent = "■ とめる";
      voiceInfo.textContent = "録音中…（8秒で自動でとまります）";
      r.done.then((blob) => {
        if (st.rec !== r) return;
        st.rec = null;
        recBtn.textContent = "● 録音する";
        useAudio(blob);
      });
    } catch (err) {
      voiceInfo.textContent = /denied|NotAllowed/i.test(String(err && (err.name || err.message)))
        ? "マイクが許可されていません。端末の設定で、このアプリのマイクを許可してください"
        : (err.message || "録音できませんでした");
    }
  });
  fileIn.addEventListener("change", () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = "";
    if (f) useAudio(f);
  });
  playBtn.addEventListener("click", () => { if (st.voiceBuffer) playBuffer(st.voiceBuffer); });

  EMOJIS.forEach((item) => {
    grid.append(h("button", {
      type: "button", class: "emoji-btn", "aria-label": item.n, "aria-pressed": "false", "data-e": item.e,
      onclick: () => {
        const i = st.picks.findIndex((p) => p.e === item.e);
        if (i >= 0) st.picks.splice(i, 1);
        else if (st.picks.length < 3) st.picks.push(item);
        else return toast("絵文字は3つまでです");
        st.colors = renderEmojiAura(canvas, st.picks, st.seed);
        sync();
      },
    }, item.e));
  });

  tabDraw.addEventListener("click", () => { if (st.mode !== "draw") setMode("draw"); });
  tabEmoji.addEventListener("click", () => { if (st.mode !== "emoji") setMode("emoji"); });
  tabVoice.addEventListener("click", () => { if (st.mode !== "voice") setMode("voice"); });
  redoBtn.addEventListener("click", () => {
    if (st.mode === "draw") {
      editor.reset();
      st.colors = [];
    } else if (st.mode === "emoji") {
      st.seed = Math.floor(Math.random() * 1e9);
      st.colors = renderEmojiAura(canvas, st.picks, st.seed);
    } else {
      stopRec();
      st.voice = null;
      editor.reset();
      st.colors = [];
      playBtn.hidden = true;
      voiceInfo.textContent = "";
    }
    sync();
  });

  sendBtn.addEventListener("click", async () => {
    if (!st.colors.length) return;
    stopRec();
    sendBtn.disabled = true;
    redoBtn.disabled = true;
    try {
      const blob = await canvasBlob(canvas, "image/jpeg", 0.9);
      if (t.kind === "dm") {
        const path = `${t.conv.id}/${newId()}.jpg`;
        const up = await supabase.storage.from("chat").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        const { data, error } = await supabase
          .from("messages")
          .insert({ conversation_id: t.conv.id, sender_id: S.me.id, kind: "image", file_path: path, body: "aura" })
          .select()
          .single();
        if (error) throw error;
        onNewMessage(data);
      } else {
        const path = await uploadMedia(blob, "jpg", "image/jpeg");
        await createPost({ kind: "aura", file_path: path, body: caption.value.trim(), tag: "きもち", club_id: t.club });
      }
      if (ring.checked) await applyRingColors(st.colors);
      location.hash = t.back;
    } catch (err) {
      toast("送れませんでした: " + jpError(err));
      sendBtn.disabled = false;
      redoBtn.disabled = false;
    }
  });

  setScreen(h("div", { class: "screen" },
    h("div", { class: "topbar" },
      iconBtn("とじる", ICON.back, () => { stopRec(); location.hash = t.back; }),
      h("h2", {}, "今日のイメージ")),
    h("div", { class: "aura-body" },
      h("div", { class: "seg" }, tabDraw, tabEmoji, tabVoice),
      hint,
      h("div", { class: "aura-wrap" }, canvas),
      voiceBox,
      chips,
      grid,
      caption,
      h("label", { class: "check" }, ring, h("span", {}, "アイコンの縁も、今日の色にする"))),
    h("div", { class: "aura-actions" }, redoBtn, sendBtn)));
  sync();
}

boot();
