import * as ImagePicker from "expo-image-picker";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { api, saveTokens } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { Avatar, Btn, Chip, ErrorNote, Field, Icon, Loading, ModeBadge, Notice, T, s, useColors } from "@/components/ui";
import { GoLive } from "@/components/GoLive";
import { manageListing } from "@/lib/listing";
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

      <MyProducts key={pending.length} />

      {/* Stocking the shop outside a show is secondary: during a show, Sell item does this live. */}
      <Btn kind="ghost" icon={adding ? "chevron-up" : "add"} title={adding ? "Hide" : "Add items to your shop"} onPress={() => setAdding(!adding)} />
      {adding && <AddItems onCreated={() => drafts.reload()} />}
    </ScrollView>
  );
}

/** Everything in the seller's shop, hidden ones too, with a menu to hide, show or delete each one. */
function MyProducts() {
  const c = useColors();
  const list = useApi<any[]>("/seller/products");
  const [all, setAll] = useState(false);
  const items = (list.data ?? []).filter((p) => p.status === "ACTIVE" || p.status === "DRAFT");
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 5);
  async function manage(p: any) {
    const status = await manageListing(p);
    if (status) list.setData((cur) => (cur ?? []).map((x) => (x.id === p.id ? { ...x, status } : x)));
  }
  return (
    <View style={{ gap: 8 }}>
      <T size={18} weight="700">Your products · {items.length}</T>
      {shown.map((p) => {
        const left = p.variants.reduce((n: number, v: any) => n + v.quantity, 0);
        return (
          <Pressable key={p.id} onPress={() => router.push(`/p/${p.id}`)} style={[s.card, { borderColor: c.line, backgroundColor: c.card, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }]}>
            <View style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", backgroundColor: c.line }}>
              {p.media?.[0] && <Image source={{ uri: p.media[0].url }} style={{ width: 52, height: 52, opacity: p.status === "DRAFT" ? 0.45 : 1 }} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T weight="600" lines={1}>{p.title}</T>
              <T size={12} color={p.status === "DRAFT" ? c.warn : c.muted}>{p.status === "DRAFT" ? "Hidden from your shop" : left === 0 ? "Sold out" : `${left} in stock`}</T>
            </View>
            <Pressable onPress={() => manage(p)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Hide or delete ${p.title}`} style={{ padding: 6 }}>
              <Icon name="ellipsis-horizontal" size={20} color={c.muted} />
            </Pressable>
          </Pressable>
        );
      })}
      {items.length > 5 && <Btn kind="ghost" title={all ? "Show fewer" : `See all ${items.length}`} onPress={() => setAll(!all)} />}
    </View>
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
      <T size={12} color={c.muted}>{mode === "single" ? "Up to 8 photos of the same item (front, back, labels, wear). They all go into one listing." : "One photo per item, up to 25 at once. Each photo becomes its own listing."}</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn style={{ flex: 1 }} kind="ghost" icon="camera-outline" title="Take photo" onPress={() => pick(true)} />
        <Btn style={{ flex: 1 }} kind="ghost" icon="images-outline" title="Choose" onPress={() => pick(false)} />
      </View>
      {!!photos.length && (
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {photos.map((p, i) => (
            <View key={p.uri + i} style={{ paddingTop: 6, paddingRight: 6 }}>
              <Image source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: 10 }} />
              <Pressable
                onPress={() => setPhotos(photos.filter((_, j) => j !== i))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${i + 1}`}
                style={{ position: "absolute", top: 0, right: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.75)", borderWidth: 1, borderColor: "#fff", alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      {mode === "single" && !!photos.length && <Field label="Barcode / UPC (optional)" keyboardType="number-pad" value={barcode} onChangeText={(v) => setBarcode(v.replace(/\D/g, ""))} />}
      <ErrorNote error={err} />
      {!!photos.length && <Btn title={busy ? "Analyzing…" : mode === "batch" && photos.length > 1 ? `Create ${photos.length} listings` : "Create listing"} busy={busy} onPress={upload} />}
    </View>
  );
}
