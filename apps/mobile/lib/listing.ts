import { Alert } from "react-native";
import { api } from "./api";
import { choose } from "./safety";

export type ListingStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

/** Confirm, then delete a listing. Old orders keep their record, so a deleted listing is archived, not erased. */
export function confirmDelete(p: { id: string; title: string }): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(`Delete "${p.title}"?`, "It comes off your shop and out of your shows. Past orders keep their details.", [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/seller/products/${p.id}`, { method: "PATCH", body: { status: "ARCHIVED" } });
            resolve(true);
          } catch (e: any) {
            Alert.alert("Couldn't delete it", e?.message ?? "Try again in a moment.");
            resolve(false);
          }
        },
      },
    ]);
  });
}

/** Show or hide a listing in your shop without deleting it. */
export async function setShown(id: string, shown: boolean) {
  await api(`/seller/products/${id}`, { method: "PATCH", body: { status: shown ? "ACTIVE" : "DRAFT" } });
}

/**
 * The seller's menu for one of their listings: hide it (or put it back) or delete it.
 * Resolves to the listing's new status, or null when nothing changed.
 */
export async function manageListing(p: { id: string; title: string; status?: string }): Promise<ListingStatus | null> {
  const hidden = p.status === "DRAFT";
  const i = await choose(p.title, [hidden ? "Show in my shop" : "Hide from my shop", "Delete listing"], 1);
  if (i === 0) {
    try {
      await setShown(p.id, hidden);
      return hidden ? "ACTIVE" : "DRAFT";
    } catch (e: any) {
      Alert.alert("Couldn't change it", e?.message ?? "Try again in a moment.");
      return null;
    }
  }
  if (i === 1) return (await confirmDelete(p)) ? "ARCHIVED" : null;
  return null;
}
