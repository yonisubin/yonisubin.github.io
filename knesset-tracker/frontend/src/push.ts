// Web Push: register the service worker and a payload-less push subscription.
import { api, send, type Me } from "./api";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function enablePush(): Promise<Me> {
  const { public_key } = await api<{ public_key: string | null }>("/push/public-key");
  if (!public_key) throw new Error("push is not configured on this server");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("permission denied");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) }));
  return send<Me>("POST", "/me/push", sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await send("DELETE", "/me/push", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}
