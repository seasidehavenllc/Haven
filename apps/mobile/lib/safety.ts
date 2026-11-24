import { ActionSheetIOS, Alert, Platform } from "react-native";
import { api } from "./api";

export type ReportTarget = "video" | "comment" | "stream" | "chat" | "user" | "product";

const REASONS = ["Spam or scam", "Harassment or hate", "Nudity or sexual content", "Violence or dangerous acts", "Something else"];

/** Pick from a list: an action sheet on iPhone, an alert on Android. Resolves to the index, or -1 for cancel. */
export function choose(title: string, options: string[], destructive?: number): Promise<number> {
  return new Promise((resolve) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ title, options: [...options, "Cancel"], cancelButtonIndex: options.length, destructiveButtonIndex: destructive }, (i) => resolve(i === options.length ? -1 : i));
    } else {
      Alert.alert(title, undefined, [...options.slice(0, 2).map((o, i) => ({ text: o, onPress: () => resolve(i), style: i === destructive ? ("destructive" as const) : undefined })), { text: "Cancel", style: "cancel" as const, onPress: () => resolve(-1) }], { cancelable: true, onDismiss: () => resolve(-1) });
    }
  });
}

/** Ask why, then file the report. Returns true when a report was sent. */
export async function report(targetType: ReportTarget, targetId: string, what = "this"): Promise<boolean> {
  const reasons = Platform.OS === "ios" ? REASONS : [REASONS[0], "Abusive or harmful"];
  const i = await choose(`Why are you reporting ${what}?`, reasons);
  if (i < 0) return false;
  try {
    await api("/reports", { body: { targetType, targetId, reason: reasons[i] } });
    Alert.alert("Thanks for reporting", "Haven's team reviews reports within 24 hours and removes anything that breaks the rules.");
    return true;
  } catch (e: any) {
    Alert.alert("Couldn't send the report", e?.message ?? "Try again in a moment.");
    return false;
  }
}

/** Confirm, then block. Returns true when blocked. */
export function block(handle: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(`Block @${handle}?`, "You won't see each other's videos, comments or chat, and they can't follow you or comment on your videos. They aren't told.", [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/users/${handle}/block`, { body: {} });
            resolve(true);
          } catch (e: any) {
            Alert.alert("Couldn't block", e?.message ?? "Try again in a moment.");
            resolve(false);
          }
        },
      },
    ]);
  });
}
