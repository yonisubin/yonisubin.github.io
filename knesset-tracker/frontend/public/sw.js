// Service worker for Web Push. Pushes carry no payload (see backend/app/push.py): on a
// push we fetch the user's latest alert from our own API, with their session cookie.
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let title = "Knesset Tracker · מעקב הכנסת";
    let body = "";
    let path = "/he/account";
    try {
      const res = await fetch("/api/v1/me/notifications?limit=1", { credentials: "include" });
      const [latest] = await res.json();
      if (latest) {
        const he = latest.path.startsWith("/he");
        title = he ? "מעקב הכנסת" : "Knesset Tracker";
        body = he ? latest.text.he : latest.text.en;
        path = latest.path;
      }
    } catch (e) { /* offline or signed out: show a generic notice */ }
    await self.registration.showNotification(title, {
      body, data: { path }, icon: "/favicon.svg", tag: "knesset-tracker", renotify: true,
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.path || "/"));
});
