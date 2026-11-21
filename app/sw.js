// 通知を受け取って表示する
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {};
  }
  const options = {
    body: data.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: data.conversationId || "message",
    data: { conversationId: data.conversationId || null },
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "新着メッセージ", options),
      bumpBadge(),
    ]),
  );
});

// アプリを閉じているときに通知が届いたら、アイコンの数字を1つ増やす
// (アプリを開くと、本当の未読の数に合わせ直されます)
async function bumpBadge() {
  try {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((c) => c.visibilityState === "visible")) return; // 開いているときは、アプリ側が数える
    const cache = await caches.open("badge-v1");
    const res = await cache.match("/badge-count");
    const n = (res ? parseInt(await res.text(), 10) || 0 : 0) + 1;
    await cache.put("/badge-count", new Response(String(n)));
    if (self.navigator && "setAppBadge" in self.navigator) await self.navigator.setAppBadge(n);
  } catch (_) {
    /* 数字が出せなくても、通知は出す */
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const cid = event.notification.data && event.notification.data.conversationId;
  const url = new URL(cid ? "./#/chat/" + cid : "./", self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch (_) {
              /* 開けなくてもそのままにする */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
