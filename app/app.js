// 高次元SNS リラ ステップ1: 最小のトーク(ログイン / 1対1 / 文章と画像 / 通知)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from "./config.js";
import { EMOJIS, createStrokeEditor, renderEmojiAura } from "./aura.js";

const APP_VERSION = "1.5(パスワードの再設定)";

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
  sparkle: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"],
};

function iconBtn(label, icon, onclick) {
  return h("button", { class: "icon-btn", type: "button", "aria-label": label, onclick }, svg(icon));
}

const safeColor = (c, fallback) => (/^#[0-9a-fA-F]{6}$/.test(c || "") ? c : fallback);

function avatar(p, size = 52) {
  const a = safeColor(p && p.color_a, "#c9a8ff");
  const b = safeColor(p && p.color_b, "#ff9ec7");
  const initial = Array.from((p && p.name ? p.name : "?").trim())[0] || "?";
  return h("div", {
    class: "av",
    style: `width:${size}px;height:${size}px;background:conic-gradient(from 20deg,${a},${b},${a});box-shadow:0 0 ${Math.round(size / 3)}px ${a}99`,
  },
  h("div", { class: "av-in" },
    h("div", { class: "av-pic", style: `background:linear-gradient(135deg,${a},${b});font-size:${Math.round(size * 0.4)}px` }, initial)));
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
  if (/not authorized|email_address_not_authorized/i.test(m)) return "いまはメールを送れない設定です。管理している人に連絡してください";
  if (/over_email_send_rate_limit|email rate limit/i.test(m)) return "メールを送る回数の上限に達しました。しばらく待ってからもう一度どうぞ";
  if (/same.*password|should be different/i.test(m)) return "前と同じパスワードは使えません";
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

// パスワード再設定のメールから開いたときの、URLの中身を読む
function readAuthLink() {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!/(access_token|error_description)=/.test(raw)) return { recovery: false, error: "" };
  const q = new URLSearchParams(raw);
  const err = q.get("error_code") === "otp_expired"
    ? "メールのリンクの期限が切れています。もう一度「パスワードを忘れた方はこちら」からどうぞ"
    : (q.get("error_description") || "").replace(/\+/g, " ");
  return { recovery: q.get("type") === "recovery", error: err };
}

function clearAuthLink() {
  if (/(access_token|error_description)=/.test(location.hash)) {
    history.replaceState(null, "", location.pathname + location.search + "#/");
  }
}

async function boot() {
  if (!configured) return showSetupNeeded();

  const link = readAuthLink();
  S.recovering = link.recovery;
  S.linkError = link.error;

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      S.recovering = true;
      if (S.me) setTimeout(route, 0);
    }
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
    clearAuthLink();
    const msg = S.linkError;
    S.linkError = "";
    return showAuth("login", msg);
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
  const { data, error } = await supabase.from("profiles").select("id, name, email, color_a, color_b").order("name").limit(500);
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
      supabase.from("conversation_members").select("conversation_id, profiles(id, name, email, color_a, color_b)").in("conversation_id", ids),
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
  if (m.kind === "image") return m.body === "aura" ? "今日のイメージを送りました" : "画像を送りました";
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
  clearAuthLink();
  S.nav += 1;
  S.chat = null;
  if (S.recovering) return showNewPassword(true);
  const parts = (location.hash || "#/").split("/");
  const a = parts[1];
  const b = parts[2];
  if (a === "chat" && b) return showChat(b);
  if (a === "aura" && b) return showAura(b);
  if (a === "new") return showNew();
  if (a === "password") return showNewPassword(false);
  if (a === "settings") return showSettings();
  return showList();
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
        isSignup ? "すでに登録している方はこちら" : "はじめての方はこちら"),
      isSignup ? null : h("button", { class: "link sub", type: "button", onclick: () => showForgot(email.value.trim()) },
        "パスワードを忘れた方はこちら"))));
}

/* ---------- パスワードを忘れたとき ---------- */

function showForgot(prefill = "") {
  S.view = { name: "forgot" };
  const email = h("input", { type: "email", placeholder: "登録したメールアドレス", autocomplete: "email", required: true, value: prefill });
  const note = h("div", { class: "note", role: "alert" });
  const btn = h("button", { class: "primary", type: "submit" }, "再設定のメールを送る");
  const form = h("form", {
    class: "auth-form",
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      note.textContent = "";
      try {
        const redirectTo = location.origin + location.pathname;
        const { error } = await supabase.auth.resetPasswordForEmail(email.value.trim(), { redirectTo });
        if (error) throw error;
        form.replaceChildren(h("div", { class: "panel" },
          h("p", {}, "メールを送りました。メールの中のリンクを開くと、新しいパスワードを決められます。"),
          h("p", {}, "届かないときは、迷惑メールのフォルダも見てください。")));
      } catch (err) {
        note.textContent = jpError(err);
        btn.disabled = false;
      }
    },
  }, h("p", { class: "lead" }, "登録したメールアドレスに、パスワードを決め直すためのリンクを送ります。"), email, note, btn);

  setScreen(h("div", { class: "screen" },
    h("div", { class: "auth" },
      logo(),
      h("h2", { class: "auth-title" }, "パスワードを忘れた方"),
      form,
      h("button", { class: "link", type: "button", onclick: () => showAuth("login") }, "ログインにもどる"))));
}

/* ---------- 新しいパスワードを決める ---------- */

function showNewPassword(fromMail) {
  S.view = { name: "password" };
  const pass = h("input", { type: "password", placeholder: "新しいパスワード(6文字以上)", required: true, minLength: 6, autocomplete: "new-password" });
  const again = h("input", { type: "password", placeholder: "もう一度入力", required: true, minLength: 6, autocomplete: "new-password" });
  const note = h("div", { class: "note", role: "alert" });
  const btn = h("button", { class: "primary", type: "submit" }, "このパスワードにする");
  const done = () => {
    S.recovering = false;
    location.hash = "#/";
    route();
  };
  const form = h("form", {
    class: "auth-form",
    onsubmit: async (e) => {
      e.preventDefault();
      note.textContent = "";
      if (pass.value !== again.value) {
        note.textContent = "2つのパスワードがちがいます";
        return;
      }
      btn.disabled = true;
      try {
        const { error } = await supabase.auth.updateUser({ password: pass.value });
        if (error) throw error;
        toast("新しいパスワードにしました");
        done();
      } catch (err) {
        note.textContent = jpError(err);
        btn.disabled = false;
      }
    },
  }, h("p", { class: "lead" }, fromMail
    ? "新しいパスワードを決めてください。次からは、このパスワードでログインします。"
    : "いまのパスワードの代わりに使う、新しいパスワードを決めます。"), pass, again, note, btn);

  setScreen(h("div", { class: "screen" },
    h("div", { class: "auth" },
      logo(),
      h("h2", { class: "auth-title" }, "新しいパスワード"),
      form,
      h("button", { class: "link", type: "button", onclick: done }, fromMail ? "あとで決める" : "もどる"))));
}

/* ---------- トーク一覧 ---------- */

function showList() {
  S.view = { name: "list" };
  const body = h("div", { class: "list" });
  S.listEl = body;
  setScreen(h("div", { class: "screen" },
    h("div", { class: "topbar" },
      h("h1", {}, "トーク"),
      h("div", { class: "top-actions" },
        iconBtn("新しいトークをつくる", ICON.plus, () => { location.hash = "#/new"; }),
        h("button", { class: "me-btn", type: "button", "aria-label": "設定", onclick: () => { location.hash = "#/settings"; } }, avatar(S.me, 40)))),
    pushBanner(),
    body));
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
      iconBtn("もどる", ICON.back, () => { location.hash = "#/"; }),
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
    if (!conv) { location.hash = "#/"; return; }
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
  input, sendBtn);

  setScreen(h("div", {
    class: "screen",
    style: `background:radial-gradient(110% 55% at 10% 0%,${a}66 0%,${a}00 62%),radial-gradient(90% 50% at 100% 40%,${b}66 0%,${b}00 62%),radial-gradient(120% 60% at 30% 100%,#e7cfff 0%,rgba(231,207,255,0) 65%),#fff6f8`,
  },
  h("div", { class: "topbar" },
    iconBtn("もどる", ICON.back, () => { location.hash = "#/"; }),
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
    const img = h("img", { class: "pic", alt: isAura ? "今日のイメージ" : "送られた画像" });
    img.addEventListener("load", () => { if (chat.stick) scrollBottom(); });
    img.addEventListener("click", () => openViewer(m.file_path));
    signedUrl(m.file_path).then((u) => { if (u) img.src = u; });
    content = h("div", { class: "pic-wrap" + (isAura ? " aura" : "") }, img);
  } else {
    content = h("div", { class: "bubble" }, m.body || previewOf(m));
  }
  chat.scroll.append(h("div", { class: "msg " + (mine ? "mine" : "theirs") }, mine ? [time, content] : [content, time]));
  if (chat.stick || mine) scrollBottom();
}

/* ---------- 画像 ---------- */

const urlCache = new Map();
async function signedUrl(path, opts) {
  const key = path + (opts ? "|dl" : "");
  const hit = urlCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from("chat").createSignedUrl(path, 3600, opts);
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
  const path = `${conv.id}/${crypto.randomUUID()}.jpg`;
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

async function openViewer(path) {
  const url = await signedUrl(path);
  if (!url) return toast("画像を開けませんでした");
  const close = () => viewer.remove();
  const save = h("button", { type: "button" }, "保存する");
  save.addEventListener("click", async () => {
    const dl = await signedUrl(path, { download: "image.jpg" });
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

/* ---------- 今日のイメージ ---------- */

function showAura(cid) {
  const conv = S.convs.find((c) => c.id === cid);
  if (!conv) { location.hash = "#/"; return; }
  S.view = { name: "aura", cid };

  const st = { mode: "draw", picks: [], seed: Math.floor(Math.random() * 1e9), colors: [] };

  const canvas = h("canvas", { class: "aura-canvas", role: "img", "aria-label": "今日のイメージ" });
  const hint = h("p", { class: "hint" });
  const chips = h("div", { class: "chips" });
  const ring = h("input", { type: "checkbox", checked: true });
  const sendBtn = h("button", { class: "primary", type: "button", style: "flex:2" }, "送る");
  const redoBtn = h("button", { class: "secondary", type: "button", style: "flex:1" }, "やり直す");
  const grid = h("div", { class: "emoji-grid", hidden: true });
  const tabDraw = h("button", { class: "seg-btn on", type: "button" }, "なぞる");
  const tabEmoji = h("button", { class: "seg-btn", type: "button" }, "絵文字");

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
      : st.picks.length ? "絵文字をえらびなおすと、光も変わります(3つまで)" : "絵文字を2〜3個えらんでください(3つまで)";
    grid.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(st.picks.some((p) => p.e === b.dataset.e))));
    grid.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.getAttribute("aria-pressed") === "true"));
  }

  function setMode(mode) {
    st.mode = mode;
    tabDraw.classList.toggle("on", mode === "draw");
    tabEmoji.classList.toggle("on", mode === "emoji");
    grid.hidden = mode !== "emoji";
    editor.setEnabled(mode === "draw");
    if (mode === "draw") {
      editor.reset();
      st.colors = [];
    } else {
      st.colors = renderEmojiAura(canvas, st.picks, st.seed);
    }
    sync();
  }

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
  redoBtn.addEventListener("click", () => {
    if (st.mode === "draw") {
      editor.reset();
      st.colors = [];
    } else {
      st.seed = Math.floor(Math.random() * 1e9);
      st.colors = renderEmojiAura(canvas, st.picks, st.seed);
    }
    sync();
  });

  sendBtn.addEventListener("click", async () => {
    if (!st.colors.length) return;
    sendBtn.disabled = true;
    redoBtn.disabled = true;
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("画像を作れませんでした");
      const path = `${conv.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("chat").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const { data, error } = await supabase
        .from("messages")
        .insert({ conversation_id: conv.id, sender_id: S.me.id, kind: "image", file_path: path, body: "aura" })
        .select()
        .single();
      if (error) throw error;
      onNewMessage(data);
      if (ring.checked) await applyRingColors(st.colors);
      location.hash = "#/chat/" + conv.id;
    } catch (err) {
      toast("送れませんでした: " + (err.message || err));
      sendBtn.disabled = false;
      redoBtn.disabled = false;
    }
  });

  setScreen(h("div", { class: "screen" },
    h("div", { class: "topbar" },
      iconBtn("とじる", ICON.back, () => { location.hash = "#/chat/" + conv.id; }),
      h("h2", {}, "今日のイメージ")),
    h("div", { class: "aura-body" },
      h("div", { class: "seg" }, tabDraw, tabEmoji),
      hint,
      h("div", { class: "aura-wrap" }, canvas),
      chips,
      grid,
      h("label", { class: "check" }, ring, h("span", {}, "アイコンの縁も、今日の色にする"))),
    h("div", { class: "aura-actions" }, redoBtn, sendBtn)));
  sync();
}

// アイコンの縁の色を、今日の色に変える
async function applyRingColors(colors) {
  const a = colors[0];
  const b = colors.find((c) => c !== a) || a;
  const { error } = await supabase.from("profiles").update({ color_a: a, color_b: b }).eq("id", S.me.id);
  if (error) return toast("縁の色は変えられませんでした");
  const apply = (p) => { if (p && p.id === S.me.id) { p.color_a = a; p.color_b = b; } };
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
      iconBtn("もどる", ICON.back, () => { location.hash = "#/"; }),
      h("h2", {}, "設定")),
    h("div", { class: "settings" },
      h("div", { class: "panel" },
        h("div", { class: "me-head" }, avatar(S.me, 64), h("div", { class: "em" }, S.me.email)),
        h("div", { class: "field" }, h("h3", {}, "表示する名前"), nameIn),
        saveBtn),
      h("div", { class: "panel" },
        h("h3", {}, "パスワード"),
        h("button", { class: "secondary", type: "button", onclick: () => { location.hash = "#/password"; } }, "パスワードを変える")),
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

boot();
