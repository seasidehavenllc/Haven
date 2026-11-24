import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { api } from "./api";

/**
 * Push notifications through Expo's push service. The server stores the token (POST /me/push-devices)
 * and sends to it; nothing secret lives in the app.
 *
 * Needs an EAS project id (app.json → expo.extra.eas.projectId, created with `eas init`). Without it
 * Expo can't issue a token, so we skip registration and the in-app inbox still works.
 */
const projectId: string | undefined = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
let registered: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export const pushAvailable = () => !!projectId && Device.isDevice;

/** Ask for permission (once; the OS remembers the answer) and register this device for the signed-in user. */
export async function registerForPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!Device.isDevice) return { ok: false, reason: "Push needs a real phone, not a simulator." };
  if (!projectId) return { ok: false, reason: "Push isn't set up for this build yet." };
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Haven", importance: Notifications.AndroidImportance.HIGH });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return { ok: false, reason: "Notifications are turned off for Haven in your phone settings." };
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api("/me/push-devices", { body: { token, platform: Platform.OS === "ios" ? "ios" : "android" } });
  registered = token;
  return { ok: true };
}

/** Called on log out so the next person on this phone doesn't get the previous account's pushes. */
export async function unregisterPush() {
  if (!registered) return;
  const t = registered;
  registered = null;
  await api(`/me/push-devices/${encodeURIComponent(t)}`, { method: "DELETE" }).catch(() => {});
}

/** Register when signed in, and open the notification's link when the user taps it. */
export function usePush(signedIn: boolean) {
  useEffect(() => {
    if (signedIn && pushAvailable()) registerForPush().catch(() => {});
  }, [signedIn]);
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const link = last?.notification.request.content.data?.link;
    if (typeof link === "string" && link.startsWith("/")) router.push(mobileRoute(link) as any);
  }, [last]);
}

/** Server links are web paths; map the ones the app has screens for. */
export function mobileRoute(link: string) {
  const m = link.match(/^\/(live|p|auctions|videos)\/([^/?#]+)/);
  if (m?.[1] === "live") return `/live/${m[2]}`;
  if (m?.[1] === "videos") return `/video/${m[2]}`;
  if (m?.[1] === "p") return `/p/${m[2]}`;
  if (m?.[1] === "auctions") return `/auctions/${m[2]}`;
  if (link === "/auctions") return "/auctions";
  const u = link.match(/^\/u\/([^/?#]+)/);
  if (u) return `/u/${u[1]}`;
  if (link.startsWith("/orders")) return "/account";
  if (link.startsWith("/sell")) return "/sell";
  if (link.startsWith("/admin")) return "/admin";
  return "/notifications";
}
