import * as ImagePicker from "expo-image-picker";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { api, saveTokens } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { Avatar, Btn, Chip, ErrorNote, Field, Icon, Loading, ModeBadge, Notice, T, s, useColors } from "@/components/ui";
import { GoLive } from "@/components/GoLive";
import { SellerApply } from "@/components/SellerApply";

type Photo = { uri: string; mimeType?: string | null; fileName?: string | null };

export default function Sell() {
  const { me, ready, reload } = useMe();
  // The app only shows the tabs to signed-in people (app/_layout.tsx).
  if (!ready || !me) return <Loading />;
  // Selling and going live are for approved sellers only. Everyone else sees their application.
  if (me.canSell) return <SellerHome />;
  return (
    <SellerApply
      onApproved={async () => {
        // A fresh token carries the new seller id (used to join the seller's live updates).
        const r = await api("/auth/token", { method: "POST" }).catch(() => null);
        if (r?.accessToken) await saveTokens({ accessToken: r.accessToken });
        await reload();
      }}
    />
  );
}

function SellerHome() {
  const c = useColors();
  const { me } = useMe();
  const drafts = useApi<any[]>("/seller/scans");
  const shows = useApi<any[]>("/seller/streams");
  const [adding, setAdding] = useState(false);
  useRealtime(null, { "scan:updated": () => drafts.reload() });

  const seller = me!.seller;
  const pending = (drafts.data ?? []).filter((d) => d.status !== "PUBLISHED");
  const open = (shows.data ?? []).filter((x) => x.status !== "ENDED");
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={drafts.loading || shows.loading} onRefresh={() => (drafts.reload(), shows.reload())} />}>
      {/* The seller's shop: what buyers see on the profile. */}
      <Pressable onPress={() => router.push(`/u/${me!.user.handle}`)} style={[s.card, { borderColor: c.line, backgroundColor: c.card, flexDirection: "row", alignItems: "center", gap: 12 }]} accessibilityRole="button" accessibilityLabel="View your shop">
        <Avatar uri={me!.user.avatarUrl} name={me!.user.displayName} size={48} />
        <View style={{ flex: 1 }}>
          <T size={17} weight="800" lines={1}>{seller?.storefront?.name ?? seller?.businessName ?? me!.user.displayName}</T>
          <T size={12} color={c.muted} lines={1}>@{me!.user.handle} · View your shop</T>
        </View>
        <Icon name="chevron-forward" size={18} color={c.muted} />
      </Pressable>

      {open.some((x) => x.status === "LIVE" || x.status === "PAUSED") ? null : <GoLive />}

      {!!open.length && <T size={18} weight="700">Your shows</T>}
      {open.map((x) => (
        <Link key={x.id} href={`/studio/${x.id}`} asChild>
          <Pressable style={[s.card, { borderColor: x.status === "LIVE" ? c.live : c.line, backgroundColor: c.card }]}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {x.status === "LIVE" && <Chip label="LIVE" color={c.live} />}
              <ModeBadge mode={x.mode} />
            </View>
            <T weight="600">{x.title}</T>
            <T size={12} color={c.muted}>{x.status === "LIVE" ? "You're live. Tap to go back to your show." : `${x._count.products} items · ${x.status.toLowerCase()}`}</T>
          </Pressable>
        </Link>
      ))}

      {!!pending.length && <T size={18} weight="700">Drafts to review</T>}
      {pending.map((d) => (
        <Link key={d.id} href={`/scan/${d.id}`} asChild>
          <Pressable style={[s.card, { borderColor: c.line, backgroundColor: c.card, flexDirection: "row", alignItems: "center" }]}>
            {d.imageUrls[0] && <Image source={{ uri: d.imageUrls[0] }} style={{ width: 56, height: 56, borderRadius: 10 }} />}
            <View style={{ flex: 1 }}>
              <T weight="600" lines={1}>{d.draft?.title || "Untitled item"}</T>
              <T size={12} color={d.status === "FAILED" ? c.live : c.muted}>{d.status === "READY" ? "Ready for your review" : d.status === "FAILED" ? "AI couldn't analyze it. Fill in by hand" : "Analyzing…"}</T>
            </View>
          </Pressable>
        </Link>
      ))}

      {/* Stocking the shop outside a show is secondary: during a show, Sell item does this live. */}
      <Btn kind="ghost" icon={adding ? "chevron-up" : "add"} title={adding ? "Hide" : "Add items to your shop"} onPress={() => setAdding(!adding)} />
      {adding && <AddItems onCreated={() => drafts.reload()} />}
    </ScrollView>
  );
}

/** Photo-to-listing for stocking the shop before or between shows. */
function AddItems({ onCreated }: { onCreated: () => void }) {
  const c = useColors();
  const caps = useApi<any>("/capabilities");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [barcode, setBarcode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);

  async function pick(camera: boolean) {
    setErr(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setErr({ message: camera ? "Camera permission is off. Turn it on in Settings to scan items." : "Photo access is off. Turn it on in Settings." });
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: !camera, selectionLimit: mode === "single" ? 8 : 25 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!r.canceled) setPhotos((cur) => [...cur, ...r.assets].slice(0, mode === "single" ? 8 : 25));
  }

  async function upload() {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("mode", mode);
    if (barcode) fd.append("barcode", barcode);
    photos.forEach((p, i) => fd.append("files", { uri: p.uri, name: p.fileName ?? `photo-${i}.jpg`, type: p.mimeType ?? "image/jpeg" } as any));
    try {
      const r = await api("/seller/scans", { form: fd });
      const denied = r.scans.find((x: any) => x.errorCode);
      if (denied) setErr({ message: denied.error ?? "AI scan was not run", details: denied.errorDetails });
      setPhotos([]);
      setBarcode("");
      onCreated();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
      <T size={13} color={c.muted}>Snap an item and AI drafts the listing. You check it and set the price.</T>
      {caps.data && !caps.data.ai.PRODUCT_SCAN && <Notice>AI scanning isn't connected on this server yet (needs ANTHROPIC_API_KEY or another vision provider). Photos still upload and you can fill in drafts by hand.</Notice>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn style={{ flex: 1 }} kind={mode === "single" ? "primary" : "ghost"} title="One item" onPress={() => setMode("single")} />
        <Btn style={{ flex: 1 }} kind={mode === "batch" ? "primary" : "ghost"} title="Many items" onPress={() => setMode("batch")} />
      </View>
      <T size={12} color={c.muted}>{mode === "single" ? "Several photos of the same item: front, back, labels, wear." : "One photo per item, up to 25 at once."}</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn style={{ flex: 1 }} kind="ghost" icon="camera-outline" title="Take photo" onPress={() => pick(true)} />
        <Btn style={{ flex: 1 }} kind="ghost" icon="images-outline" title="Choose" onPress={() => pick(false)} />
      </View>
      {!!photos.length && (
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {photos.map((p, i) => (
            <Pressable key={p.uri + i} onLongPress={() => setPhotos(photos.filter((_, j) => j !== i))}>
              <Image source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: 10 }} />
            </Pressable>
          ))}
        </ScrollView>
      )}
      {mode === "single" && !!photos.length && <Field label="Barcode / UPC (optional)" keyboardType="number-pad" value={barcode} onChangeText={(v) => setBarcode(v.replace(/\D/g, ""))} />}
      <ErrorNote error={err} />
      {!!photos.length && <Btn title={busy ? "Analyzing…" : mode === "batch" && photos.length > 1 ? `Create ${photos.length} listings` : "Create listing"} busy={busy} onPress={upload} />}
    </View>
  );
}
