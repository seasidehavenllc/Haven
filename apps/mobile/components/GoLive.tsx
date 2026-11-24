import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { Btn, ErrorNote, Field, Icon, T, useColors } from "./ui";

/**
 * One tap to go live from a seller's profile: an optional title and an AI co-host switch, then the show
 * starts and the studio opens with the camera on. Items are added during the show (Sell item / Snap).
 */
export function GoLive({ compact = false }: { compact?: boolean }) {
  const c = useColors();
  const { me } = useMe();
  const [title, setTitle] = useState("");
  const [cohost, setCohost] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const shopName = me?.seller?.storefront?.name ?? me?.seller?.businessName ?? me?.user.displayName ?? "My shop";

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const name = title.trim().length >= 3 ? title.trim() : `${shopName} is live`.slice(0, 140);
      const st = await api<{ id: string }>("/seller/streams", { body: { title: name, mode: cohost ? "HUMAN_AI_COHOST" : "HUMAN" } });
      // Start right away. If that fails, the studio still opens with its own Go live button.
      await api(`/seller/streams/${st.id}/start`, { method: "POST", body: {} }).catch(() => null);
      setTitle("");
      router.push(`/studio/${st.id}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: c.live + "66", backgroundColor: c.live + "12" }}>
      <View style={{ gap: 2 }}>
        <T size={compact ? 17 : 20} weight="800">Go live</T>
        {!compact && <T size={13} color={c.muted}>Your camera opens with chat and hearts on top. Sell items as you show them: tap Sell item, snap it, say the price.</T>}
      </View>
      <Field placeholder={`Title (optional): ${shopName} is live`} value={title} onChangeText={setTitle} maxLength={140} />
      <Pressable onPress={() => setCohost(!cohost)} accessibilityRole="switch" accessibilityState={{ checked: cohost }} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon name={cohost ? "checkbox" : "square-outline"} size={22} color={cohost ? c.ai : c.muted} />
        <View style={{ flex: 1 }}>
          <T size={14} weight="600">AI co-host</T>
          <T size={12} color={c.muted}>Answers questions in chat and helps write listings while you talk.</T>
        </View>
      </Pressable>
      <ErrorNote error={err} />
      <Btn kind="danger" icon="radio" title={busy ? "Starting…" : "Go live now"} busy={busy} onPress={start} />
    </View>
  );
}
