// Service worker: web-push delivery + notification tap handling.
// (Installable PWA shell; the app's icons are route-served at /pwa/*.)

self.addEventListener("push", (event) => {
  let data = { title: "🟤 Ô Ăn Quan", body: "", url: "/", tag: undefined };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch {
    /* keep defaults; body may be plain text */
    try {
      data.body = event.data.text();
    } catch {
      /* ignore */
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || "",
      icon: "/pwa/icon-192.png",
      badge: "/pwa/icon-192.png",
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing tab on our origin if one is open.
        for (const c of clients) {
          if (c.url.startsWith(self.location.origin)) {
            c.navigate(url);
            return c.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
