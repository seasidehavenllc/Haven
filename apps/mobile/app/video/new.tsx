import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { Btn, ErrorNote, Field, Icon, Money, T, minPrice, s, useColors } from "@/components/ui";

const MAX_TAGS = 6;

export default function NewVideo() {
  const c = useColors();
  const { me } = useMe();
  const isSeller = !!me?.canSell;
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const mine = useApi<any[]>(isSeller ? "/seller/products" : null, [isSeller]);
  const search = useApi<{ items: any[] }>(!isSeller && q.trim().length > 1 ? `/products?q=${encodeURIComponent(q)}&pageSize=8` : null, [q]);
  const options = isSeller ? (mine.data ?? []).filter((p) => p.status === "ACTIVE") : (search.data?.items ?? []);

  async function pick(camera: boolean) {
    setErr(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setErr({ message: camera ? "Camera permission is off. Turn it on in Settings." : "Photo library access is off. Turn it on in Settings." });
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["videos"], videoMaxDuration: 180, quality: 1 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled) return;
    const a = r.assets[0]!;
    if (a.fileSize && a.fileSize > 100 * 1024 * 1024) return setErr({ message: "That video is over 100 MB. Try a shorter clip." });
    setAsset(a);
    setCover((await VideoThumbnails.getThumbnailAsync(a.uri, { time: 500, quality: 0.8 }).catch(() => null))?.uri ?? null);
  }

  async function post() {
    if (!asset) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("video", { uri: asset.uri, name: asset.fileName ?? "video.mp4", type: asset.mimeType ?? "video/mp4" } as any);
    if (cover) fd.append("poster", { uri: cover, name: "cover.jpg", type: "image/jpeg" } as any);
    fd.append("caption", caption);
    fd.append("productIds", JSON.stringify(tags.map((t) => t.id)));
    if (asset.duration) fd.append("durationSec", String(Math.round(asset.duration / 100) / 10));
    if (asset.width) fd.append("width", String(asset.width));
    if (asset.height) fd.append("height", String(asset.height));
    try {
      const v = await api("/videos", { form: fd });
      router.replace(`/video/${v.id}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      {asset ? (
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View style={{ width: 90, height: 160, borderRadius: 12, overflow: "hidden", backgroundColor: c.line }}>{cover && <Image source={{ uri: cover }} style={{ width: 90, height: 160 }} />}</View>
          <View style={{ flex: 1, gap: 6 }}>
            <T size={13} color={c.muted}>{asset.duration ? `${Math.round(asset.duration / 1000)}s` : "Video"} selected</T>
            <Btn kind="ghost" title="Choose another" onPress={() => pick(false)} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn style={{ flex: 1 }} title="Record" onPress={() => pick(true)} />
          <Btn style={{ flex: 1 }} kind="ghost" title="From library" onPress={() => pick(false)} />
        </View>
      )}
      <Field label="Caption" value={caption} onChangeText={setCaption} multiline maxLength={500} style={{ minHeight: 80, textAlignVertical: "top", paddingTop: 10 }} />
      <T size={12} weight="600" color={c.muted}>TAG PRODUCTS ({tags.length}/{MAX_TAGS})</T>
      {!isSeller && <Field placeholder="Search products" value={q} onChangeText={setQ} />}
      {options.map((p) => {
        const on = tags.some((t) => t.id === p.id);
        return (
          <Pressable
            key={p.id}
            onPress={() => setTags((t) => (on ? t.filter((x) => x.id !== p.id) : t.length >= MAX_TAGS ? t : [...t, p]))}
            style={[s.card, { flexDirection: "row", alignItems: "center", borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brand + "22" : c.card }]}
          >
            <View style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", backgroundColor: c.line }}>{p.media?.[0] && <Image source={{ uri: p.media[0].url }} style={{ width: 40, height: 40 }} />}</View>
            <T size={14} style={{ flex: 1 }} lines={1}>{p.title}</T>
            <Money cents={minPrice(p)} size={13} />
            <Icon name={on ? "checkmark-circle" : "add-circle-outline"} size={22} color={on ? c.brandLight : c.muted} />
          </Pressable>
        );
      })}
      <ErrorNote error={err} />
      <Btn title={busy ? "Uploading…" : "Post video"} busy={busy} disabled={!asset} onPress={post} />
    </ScrollView>
  );
}
