import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { Avatar, Btn, ErrorNote, Field, Icon, T, useColors } from "@/components/ui";

/** Edit your own profile: cover photo, profile photo, name, username and bio. Sellers also edit their shop details here. */
export default function EditProfile() {
  const c = useColors();
  const { me, reload } = useMe();
  const u = me!.user;
  const sf = me!.seller?.storefront ?? null;
  const [f, setF] = useState({
    displayName: u.displayName,
    handle: u.handle,
    bio: u.bio ?? "",
    avatarUrl: u.avatarUrl ?? null,
    coverUrl: u.coverUrl ?? null,
    shopName: sf?.name ?? "",
    shopDescription: sf?.description ?? "",
    shippingPolicy: sf?.shippingPolicy ?? "",
    returnPolicy: sf?.returnPolicy ?? "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const [uploading, setUploading] = useState<"avatarUrl" | "coverUrl" | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<any>(null);

  async function pick(key: "avatarUrl" | "coverUrl") {
    setErr(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setErr({ message: "Photo access is off. Turn it on in Settings." });
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: key === "avatarUrl" ? [1, 1] : [3, 1] });
    if (r.canceled) return;
    const a = r.assets[0];
    setUploading(key);
    try {
      const fd = new FormData();
      fd.append("file", { uri: a.uri, name: a.fileName ?? `${key}.jpg`, type: a.mimeType ?? "image/jpeg" } as any);
      set({ [key]: (await api<{ url: string }>("/uploads", { form: fd })).url });
    } catch (e) {
      setErr(e);
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await api("/me/profile", {
        method: "PATCH",
        body: { displayName: f.displayName.trim(), handle: f.handle.trim().toLowerCase(), bio: f.bio.trim() || null, avatarUrl: f.avatarUrl, coverUrl: f.coverUrl },
      });
      if (sf) {
        await api("/sellers/me/storefront", {
          method: "PATCH",
          body: { name: f.shopName.trim(), description: f.shopDescription.trim(), shippingPolicy: f.shippingPolicy.trim(), returnPolicy: f.returnPolicy.trim() },
        });
      }
      await reload();
      router.back();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  }

  const badge = (label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#000000aa", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Icon name="camera" size={13} color="#fff" />
      <T size={12} weight="700" color="#fff">{label}</T>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.paper }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* Cover photo: tap to change. */}
        <Pressable onPress={() => pick("coverUrl")} accessibilityRole="button" accessibilityLabel="Change cover photo" style={{ height: 150, backgroundColor: c.card, overflow: "hidden" }}>
          {f.coverUrl ? (
            <Image source={{ uri: f.coverUrl }} style={{ width: "100%", height: "100%" }} />
          ) : (
            <View style={{ flex: 1, flexDirection: "row" }}>
              <View style={{ flex: 1, backgroundColor: c.brand + "40" }} />
              <View style={{ flex: 1, backgroundColor: c.ai + "35" }} />
              <View style={{ flex: 1, backgroundColor: c.live + "30" }} />
            </View>
          )}
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
            {uploading === "coverUrl" ? <ActivityIndicator color="#fff" /> : badge(f.coverUrl ? "Change cover photo" : "Add cover photo")}
          </View>
        </Pressable>

        <View style={{ paddingHorizontal: 16, gap: 14 }}>
          {/* Profile photo: tap to change. */}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: -46 }}>
            <Pressable onPress={() => pick("avatarUrl")} accessibilityRole="button" accessibilityLabel="Change profile photo">
              <View style={{ borderRadius: 999, borderWidth: 3, borderColor: c.paper, backgroundColor: c.paper }}>
                <Avatar uri={f.avatarUrl ?? undefined} name={f.displayName || u.displayName} size={92} />
              </View>
              <View style={{ position: "absolute", right: 2, bottom: 2, width: 30, height: 30, borderRadius: 15, backgroundColor: c.brand, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: c.paper }}>
                {uploading === "avatarUrl" ? <ActivityIndicator color="#fff" size="small" /> : <Icon name="camera" size={15} color="#fff" />}
              </View>
            </Pressable>
            <View style={{ flex: 1, flexDirection: "row", gap: 14, paddingBottom: 6 }}>
              {f.avatarUrl && <Pressable onPress={() => set({ avatarUrl: null })} hitSlop={6}><T size={13} color={c.muted}>Remove photo</T></Pressable>}
              {f.coverUrl && <Pressable onPress={() => set({ coverUrl: null })} hitSlop={6}><T size={13} color={c.muted}>Remove cover</T></Pressable>}
            </View>
          </View>

          <Field label="Name" value={f.displayName} onChangeText={(t) => set({ displayName: t })} maxLength={60} placeholder="Your name" />
          <View style={{ gap: 4 }}>
            <Field label="Username" value={f.handle} onChangeText={(t) => set({ handle: t.toLowerCase().replace(/[^a-z0-9_]/g, "") })} maxLength={30} autoCapitalize="none" autoCorrect={false} placeholder="username" />
            <T size={12} color={c.muted}>Your profile link: @{f.handle || "username"}. Letters, numbers and underscores.</T>
          </View>
          <View style={{ gap: 4 }}>
            <Field label="Bio" value={f.bio} onChangeText={(t) => set({ bio: t })} maxLength={300} multiline placeholder="Tell people what you sell or love to shop for" style={{ minHeight: 90, textAlignVertical: "top" }} />
            <T size={12} color={c.muted} style={{ alignSelf: "flex-end" }}>{f.bio.length}/300</T>
          </View>

          {sf && (
            <>
              <View style={{ height: 1, backgroundColor: c.line, marginVertical: 4 }} />
              <T size={18} weight="800">Your shop</T>
              <Field label="Shop name" value={f.shopName} onChangeText={(t) => set({ shopName: t })} maxLength={80} />
              <Field label="About the shop" value={f.shopDescription} onChangeText={(t) => set({ shopDescription: t })} maxLength={2000} multiline style={{ minHeight: 90, textAlignVertical: "top" }} />
              <Field label="Shipping policy" value={f.shippingPolicy} onChangeText={(t) => set({ shippingPolicy: t })} maxLength={4000} multiline placeholder="e.g. Ships in 2 business days with tracking" style={{ minHeight: 70, textAlignVertical: "top" }} />
              <Field label="Return policy" value={f.returnPolicy} onChangeText={(t) => set({ returnPolicy: t })} maxLength={4000} multiline placeholder="e.g. Returns accepted within 14 days" style={{ minHeight: 70, textAlignVertical: "top" }} />
            </>
          )}

          <ErrorNote error={err} />
          <Btn title="Save" icon="checkmark" onPress={save} busy={saving} disabled={!!uploading || f.displayName.trim().length < 1 || f.handle.length < 3 || (!!sf && f.shopName.trim().length < 2)} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
