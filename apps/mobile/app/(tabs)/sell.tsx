import * as ImagePicker from "expo-image-picker";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { api, saveTokens } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { Btn, Chip, Empty, ErrorNote, Field, Loading, ModeBadge, Notice, T, s, useColors } from "@/components/ui";
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
  const caps = useApi<any>("/capabilities");
  const drafts = useApi<any[]>("/seller/scans");
  const shows = useApi<any[]>("/seller/streams");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [barcode, setBarcode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [showMode, setShowMode] = useState<"HUMAN" | "HUMAN_AI_COHOST">("HUMAN_AI_COHOST");
  useRealtime(null, { "scan:updated": () => drafts.reload() });

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
      drafts.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const pending = (drafts.data ?? []).filter((d) => d.status !== "PUBLISHED");
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={drafts.loading} onRefresh={() => (drafts.reload(), shows.reload())} />}>
      <T size={24} weight="800">Scan to sell</T>
      <T size={13} color={c.muted}>Snap the item. AI drafts the listing. You check it, set the price, and it lands in your live menu.</T>
      {caps.data && !caps.data.ai.PRODUCT_SCAN && <Notice>AI scanning isn't connected on this server yet (needs ANTHROPIC_API_KEY or another vision provider). Photos still upload and you can fill in drafts by hand.</Notice>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn style={{ flex: 1 }} kind={mode === "single" ? "primary" : "ghost"} title="One item" onPress={() => setMode("single")} />
        <Btn style={{ flex: 1 }} kind={mode === "batch" ? "primary" : "ghost"} title="Many items" onPress={() => setMode("batch")} />
      </View>
      <T size={12} color={c.muted}>{mode === "single" ? "Several photos of the same item: front, back, labels, wear." : "One photo per item, up to 25 at once."}</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn style={{ flex: 1 }} kind="ghost" icon="camera-outline" title="Take photo" onPress={() => pick(true)} />
        <Btn style={{ flex: 1 }} kind="ghost" icon="images-outline" title="Choose photos" onPress={() => pick(false)} />
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
      {mode === "single" && <Field label="Barcode / UPC (optional)" keyboardType="number-pad" value={barcode} onChangeText={(v) => setBarcode(v.replace(/\D/g, ""))} />}
      <ErrorNote error={err} />
      <Btn title={busy ? "Analyzing…" : mode === "batch" && photos.length > 1 ? `Create ${photos.length} listings` : "Create listing"} busy={busy} disabled={!photos.length} onPress={upload} />

      <T size={18} weight="700">Drafts to review</T>
      {!pending.length && !drafts.loading && <Empty title="No drafts">Scanned items wait here until you confirm them.</Empty>}
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

      <T size={18} weight="700">Live shows</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn style={{ flex: 1 }} kind={showMode === "HUMAN_AI_COHOST" ? "ai" : "ghost"} title="You + AI co-host" onPress={() => setShowMode("HUMAN_AI_COHOST")} />
        <Btn style={{ flex: 1 }} kind={showMode === "HUMAN" ? "primary" : "ghost"} title="Just you" onPress={() => setShowMode("HUMAN")} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field placeholder="Show title" value={title} onChangeText={setTitle} />
        </View>
        <Btn
          title="Create"
          disabled={title.trim().length < 3}
          onPress={async () => {
            setErr(null);
            try {
              const st = await api("/seller/streams", { body: { title, mode: showMode } });
              setTitle("");
              router.push(`/studio/${st.id}`);
            } catch (e) {
              setErr(e);
            }
          }}
        />
      </View>
      <T size={12} color={c.muted}>AI-hosted shows are set up on the website (they need an AI salesperson on the Business plan).</T>
      {(shows.data ?? []).filter((x) => x.status !== "ENDED").map((x) => (
        <Link key={x.id} href={`/studio/${x.id}`} asChild>
          <Pressable style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {x.status === "LIVE" && <Chip label="LIVE" color={c.live} />}
              <ModeBadge mode={x.mode} />
            </View>
            <T weight="600">{x.title}</T>
            <T size={12} color={c.muted}>{x._count.products} products · {x.status.toLowerCase()}</T>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}
