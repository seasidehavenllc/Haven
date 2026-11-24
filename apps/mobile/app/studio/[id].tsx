import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { LiveVideo, type HostCamera } from "@/components/LiveVideo";
import { AuctionCard, ChatOverlay, Hearts, PinnedComment, PinnedProductCard, applyChat, compact, glass, type ChatLine, type HeartsHandle } from "@/components/LiveOverlay";
import { block, choose } from "@/lib/safety";
import { Btn, Chip, ErrorNote, Field, Icon, Loading, ModeBadge, Money, Notice, T, friendlyError, minPrice, s, stock, useColors } from "@/components/ui";
import { formatMoney } from "@haven/shared";

const PRESETS = ["What's pinned and how many are left?", "Summarize the chat questions", "What should I show next?"];

/**
 * The seller's side of a live show. Before going live it's a setup page. Once live, the camera fills the screen with
 * chat, hearts and the pinned item over it, and a toolbar to sell a new item, manage items and auctions, and talk to the AI co-host.
 */
export default function Studio() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { me, reload: reloadMe } = useMe();
  const { data: st, loading, error, reload, setData } = useApi<any>(`/streams/${id}`);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [err, setErr] = useState<any>(null);
  const [sheet, setSheet] = useState<null | "add" | "items" | "ai">(null);
  const [toast, setToast] = useState<string | null>(null);
  const hearts = useRef<HeartsHandle>(null);
  const camera = useRef<HostCamera | null>(null);
  const toastTimer = useRef<any>(null);

  const say = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (st?.chat) setLines(st.chat.map((m: any) => ({ kind: "msg", m })));
  }, [st?.id]);

  useRealtime(
    `stream:${id}`,
    {
      "stream:chat": (m: any) => setLines((cur) => applyChat(cur, m)),
      "stream:joined": (j: any) => setLines((cur) => [...cur.slice(-149), { kind: "join", id: `join-${j.userId}-${Date.now()}`, userId: j.userId, name: j.displayName }]),
      "stream:likes": (l: any) => {
        setData((d: any) => d && { ...d, likeCount: Math.max(d.likeCount ?? 0, l.total) });
        hearts.current?.pop(Math.min(l.added, 5));
      },
      "stream:viewers": (p: any) => setData((d: any) => d && { ...d, viewers: p.count }),
      "stream:pinned": (p: any) => setData((d: any) => d && { ...d, pinnedProductId: p.productId }),
      "stream:pinnedMessage": (p: any) => setData((d: any) => d && { ...d, pinnedMessage: p.message }),
      "stream:auction": () => reload(),
      "auction:bid": (b: any) => setData((d: any) => d && { ...d, auctions: d.auctions.map((a: any) => (a.id === b.auctionId ? { ...a, currentPriceCents: b.amountCents, endsAt: b.endsAt, status: "LIVE" } : a)) }),
      "auction:closed": (x: any) => {
        setData((d: any) => d && { ...d, auctions: d.auctions.filter((a: any) => a.id !== x.auctionId) });
        say(x.winnerId ? `Auction sold for ${formatMoney(x.priceCents)}` : "Auction ended with no sale");
      },
      "inventory:changed": () => reload(),
      "stream:menu": () => reload(),
      "order:created": () => reload(),
    },
    { host: true },
  );

  if (loading) return <Loading />;
  if (error || !st) return <View style={s.screen}><ErrorNote error={error} /></View>;
  const act = (path: string, body: unknown = {}, method = "POST") =>
    api(`/seller/streams/${id}${path}`, { method, body })
      .then(() => reload())
      .catch((e) => {
        setErr(e);
        say(friendlyError(e));
      });

  const ai = st.mode !== "HUMAN";
  const onAir = ["LIVE", "PAUSED"].includes(st.status);

  // ── Before the show (or after it ends): a plain setup page. ──
  if (!onAir)
    return (
      <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ headerShown: true }} />
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Chip label={st.status.toLowerCase()} color={c.line} text={c.ink} />
          <ModeBadge mode={st.mode} />
        </View>
        <T size={20} weight="700">{st.title}</T>
        {st.status === "SCHEDULED" && (
          <>
            <T size={14} color={c.muted}>
              When you go live, your camera fills the screen with chat and hearts on top. Tap Sell item any time to snap a new item and say its price. It goes straight into your shop and onto the show for people to buy.
            </T>
            {st.video?.configured ? <T size={13} color={c.muted}>Your camera and microphone turn on when you go live.</T> : <Notice>Video isn't connected on this server (LiveKit keys needed). Viewers can still chat and buy.</Notice>}
            <Btn title="Go live" onPress={() => act("/start")} />
          </>
        )}
        {st.status === "ENDED" && <Notice tone="ok">{`This show has ended. It got ${compact(st.likeCount ?? 0)} hearts and sold from ${st.products.length} items.`}</Notice>}
        <ErrorNote error={err} />
        <T size={18} weight="700">Items in this show</T>
        <ItemsList st={st} act={act} />
      </ScrollView>
    );

  const pinned = st.products.find((p: any) => p.productId === st.pinnedProductId)?.product;
  const auction = st.auctions.find((a: any) => a.status === "LIVE" || new Date(a.startsAt).getTime() <= Date.now());
  const auctionProduct = auction && st.products.find((p: any) => p.productId === auction.productId)?.product;

  async function moderate(m: any) {
    if (m.isAi || !m.userId) {
      const i = await choose("AI message", ["Pin to top", "Hide message"]);
      if (i === 0) act("/pin-message", { messageId: m.id });
      if (i === 1) act(`/chat/${m.id}/hide`);
      return;
    }
    if (m.userId === me?.user.id) {
      const i = await choose("Your message", ["Pin to top", "Hide message"]);
      if (i === 0) act("/pin-message", { messageId: m.id });
      if (i === 1) act(`/chat/${m.id}/hide`);
      return;
    }
    const isMuted = st.mutedUserIds?.includes(m.userId);
    const name = m.user?.handle ? `@${m.user.handle}` : "this viewer";
    const opts = ["Pin to top", "Hide message", isMuted ? `Unmute ${name}` : `Mute ${name} in this show`, `Block ${name}`];
    if (ai && st.aiPublicSpeech) opts.splice(1, 0, "Let AI answer");
    const i = await choose(`Message from ${name}`, opts, opts.length - 1);
    const pick = opts[i];
    if (!pick) return;
    if (pick === "Pin to top") act("/pin-message", { messageId: m.id });
    else if (pick === "Let AI answer") act("/ai/respond", { messageId: m.id });
    else if (pick === "Hide message") act(`/chat/${m.id}/hide`);
    else if (pick.startsWith("Unmute")) act(`/mutes/${m.userId}`, undefined, "DELETE").then(() => say(`${name} can chat again`));
    else if (pick.startsWith("Mute")) act("/mutes", { userId: m.userId }).then(() => say(`${name} is muted in this show. Their messages are hidden.`));
    else if (pick.startsWith("Block") && m.user?.handle && (await block(m.user.handle))) {
      await reloadMe();
      setLines((cur) => cur.filter((l) => (l.kind === "msg" ? l.m.userId !== m.userId : l.userId !== m.userId)));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
        {st.video?.configured && st.status === "LIVE" ? (
          <LiveVideo streamId={st.id} host cameraRef={camera} controlsStyle={{ top: insets.top + 56, bottom: undefined, flexDirection: "column" }} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
            <T color="#fff" style={{ textAlign: "center", opacity: 0.85 }}>{st.status === "PAUSED" ? "Paused. Viewers see a short break message." : "Video isn't connected on this server. Chat and selling still work."}</T>
          </View>
        )}
      </View>

      {/* Top bar */}
      <View style={{ position: "absolute", top: insets.top + 6, left: 10, right: 10, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ backgroundColor: st.status === "LIVE" ? c.live : c.warn, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
            <T size={11} weight="800" color="#fff">{st.status === "LIVE" ? "LIVE" : "PAUSED"}</T>
          </View>
          <Pill icon="eye" text={compact(st.viewers)} />
          <Pill icon="heart" text={compact(st.likeCount ?? 0)} />
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ backgroundColor: glass, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
            <T size={12} weight="700" color="#fff">Minimize</T>
          </Pressable>
          <Pressable
            onPress={async () => {
              if ((await choose("End the show for everyone?", ["End show"], 0)) === 0) act("/end");
            }}
            style={{ backgroundColor: c.live, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <T size={12} weight="700" color="#fff">End</T>
          </Pressable>
        </View>
        {st.pinnedMessage && <PinnedComment m={st.pinnedMessage} onClear={() => act("/pin-message", { messageId: null })} />}
      </View>

      <Hearts bottom={insets.bottom + 260} right={60} />

      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <View style={{ paddingHorizontal: 10, paddingRight: 64, gap: 8 }}>
          {toast && (
            <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(11,19,28,0.9)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
              <T size={13} color="#fff">{toast}</T>
            </View>
          )}
          <ChatOverlay lines={lines} onLongPress={moderate} maxHeight={230} hostUserId={st.seller.userId} />
          {auction && <AuctionCard a={auction} product={auctionProduct} />}
          {pinned && <PinnedProductCard p={pinned} />}
          <T size={11} color="#ffffff99">Press and hold a message to pin it, mute or block.</T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingTop: 10, paddingBottom: insets.bottom + 10 }}>
          <Pressable onPress={() => setSheet("add")} style={{ flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: c.brand, borderRadius: 999, paddingVertical: 12 }}>
            <Icon name="add-circle" size={20} color="#fff" />
            <T size={15} weight="700" color="#fff">Sell item</T>
          </Pressable>
          <Tool icon="list" label={`Items (${st.products.length})`} onPress={() => setSheet("items")} />
          {ai && <Tool icon="sparkles" label="AI" onPress={() => setSheet("ai")} />}
          <Tool icon={st.status === "LIVE" ? "pause" : "play"} label={st.status === "LIVE" ? "Pause" : "Resume"} onPress={() => act(st.status === "LIVE" ? "/pause" : "/resume")} />
        </View>
      </View>

      <Sheet visible={sheet === "add"} onClose={() => setSheet(null)} title="Sell a new item">
        <AddItem
          streamId={st.id}
          aiOff={!!me?.seller?.aiDisabled}
          camera={camera}
          onDone={(msg) => {
            setSheet(null);
            say(msg);
            reload();
          }}
        />
      </Sheet>
      <Sheet visible={sheet === "items"} onClose={() => setSheet(null)} title="Items in this show">
        <ItemsList st={st} act={act} onAuction={(msg) => say(msg)} />
      </Sheet>
      <Sheet visible={sheet === "ai"} onClose={() => setSheet(null)} title="AI co-host (only you see this)">
        <CohostPanel st={st} act={act} />
      </Sheet>
    </View>
  );
}

const Pill = ({ icon, text }: { icon: any; text: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: glass, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
    <Icon name={icon} size={13} color="#fff" />
    <T size={12} weight="700" color="#fff">{text}</T>
  </View>
);

function Tool({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={{ alignItems: "center", minWidth: 54 }}>
      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: glass, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} color="#fff" />
      </View>
      <T size={10} weight="600" color="#fff" lines={1}>{label}</T>
    </Pressable>
  );
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={{ flex: 1, backgroundColor: "#0006" }} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ backgroundColor: c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", paddingBottom: insets.bottom + 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: 14 }}>
            <T size={17} weight="700" style={{ flex: 1 }}>{title}</T>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Icon name="close" size={22} color={c.muted} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 10, gap: 10 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Snap the item, say what it is and the price, and it's listed. The live camera turns off for the moment the photo is
 * taken (the phone can only use the camera for one thing at a time) and comes straight back.
 */
function AddItem({ streamId, aiOff, camera, onDone }: { streamId: string; aiOff: boolean; camera: React.MutableRefObject<HostCamera | null>; onDone: (msg: string) => void }) {
  const c = useColors();
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [said, setSaid] = useState("");
  const [qty, setQty] = useState(1);
  const [useAi, setUseAi] = useState(!aiOff);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);

  async function snap(fromCamera: boolean) {
    setErr(null);
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setErr({ message: fromCamera ? "Camera permission is off. Turn it on in Settings." : "Photo access is off. Turn it on in Settings." });
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, allowsMultipleSelection: !fromCamera, selectionLimit: 4 };
    if (fromCamera) await camera.current?.setCamera(false).catch(() => {});
    try {
      const r = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (!r.canceled) setPhotos((cur) => [...cur, ...r.assets].slice(0, 4));
    } finally {
      if (fromCamera) await camera.current?.setCamera(true).catch(() => {});
    }
  }

  async function list() {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("said", said);
    fd.append("quantity", String(qty));
    fd.append("ai", useAi ? "true" : "false");
    photos.forEach((p, i) => fd.append("photos", { uri: p.uri, name: p.fileName ?? `item-${i}.jpg`, type: p.mimeType ?? "image/jpeg" } as any));
    try {
      const r = await api(`/seller/streams/${streamId}/quick-list`, { form: fd });
      setPhotos([]);
      setSaid("");
      setQty(1);
      onDone(r.aiNote ? `Listed "${r.product.title}". ${r.aiNote}` : `Listed "${r.product.title}" and pinned it for viewers.`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn style={{ flex: 1 }} kind="ghost" icon="camera" title="Snap it" onPress={() => snap(true)} />
        <Btn style={{ flex: 1 }} kind="ghost" icon="images" title="Photos" onPress={() => snap(false)} />
      </View>
      {photos.length > 0 && (
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {photos.map((p, i) => (
            <Pressable key={p.uri} onPress={() => setPhotos((cur) => cur.filter((_, j) => j !== i))} accessibilityLabel="Remove photo">
              <Image source={{ uri: p.uri }} style={{ width: 64, height: 64, borderRadius: 10 }} />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <T size={13} color={c.muted}>Say what it is and the price. Tap the mic on the keyboard to speak it, like "Vintage denim jacket, size medium, $45".</T>
      <TextInput
        value={said}
        onChangeText={setSaid}
        placeholder="What is it, and how much?"
        placeholderTextColor={c.muted}
        multiline
        maxLength={500}
        style={{ minHeight: 70, borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 12, color: c.ink, fontSize: 16, textAlignVertical: "top" }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <T size={14} style={{ flex: 1 }}>How many do you have?</T>
        <Btn kind="ghost" title="−" onPress={() => setQty((q) => Math.max(1, q - 1))} style={{ minHeight: 34, paddingHorizontal: 14 }} />
        <T size={16} weight="700">{qty}</T>
        <Btn kind="ghost" title="+" onPress={() => setQty((q) => Math.min(999, q + 1))} style={{ minHeight: 34, paddingHorizontal: 14 }} />
      </View>
      {!aiOff && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <T size={14} style={{ flex: 1 }}>Let AI write the title and description from the photo (uses AI credits)</T>
          <Switch value={useAi} onValueChange={setUseAi} />
        </View>
      )}
      <ErrorNote error={err} />
      <Btn title={busy ? (useAi && photos.length ? "AI is writing the listing…" : "Listing…") : "List it and pin it"} busy={busy} disabled={!said.trim()} onPress={list} />
      <T size={12} color={c.muted}>It goes into your shop, onto this show's items, and gets pinned so viewers can tap Buy. You can edit it later from your listings.</T>
    </>
  );
}

/** Every item in the show: pin it, hide it, or start a quick auction. */
function ItemsList({ st, act, onAuction }: { st: any; act: (path: string, body?: unknown, method?: string) => Promise<any>; onAuction?: (msg: string) => void }) {
  const c = useColors();
  const [auctionFor, setAuctionFor] = useState<string | null>(null);
  const [start, setStart] = useState("1");
  const [err, setErr] = useState<any>(null);
  const onAir = ["LIVE", "PAUSED"].includes(st.status);
  const running = st.auctions.some((a: any) => a.status === "LIVE");

  async function startAuction(productId: string, seconds: number) {
    setErr(null);
    const cents = Math.round(Number(start.replace(/[^0-9.]/g, "")) * 100);
    if (!(cents > 0)) return setErr({ message: "Enter a starting price" });
    try {
      await api("/seller/auctions", { body: { productId, streamId: st.id, startingPriceCents: cents, minIncrementCents: cents >= 5000 ? 200 : 100, durationSeconds: seconds } });
      setAuctionFor(null);
      onAuction?.(`Auction started at ${formatMoney(cents)}`);
    } catch (e) {
      setErr(e);
    }
  }

  if (!st.products.length) return <T size={13} color={c.muted}>No items yet. Tap Sell item to add one while you're live.</T>;
  return (
    <>
      {st.products.map(({ product: p, hidden }: any) => {
        const pinned = st.pinnedProductId === p.id;
        return (
          <View key={p.id} style={{ gap: 8 }}>
            <View style={[s.card, { borderColor: pinned ? c.brand : c.line, backgroundColor: c.card, flexDirection: "row", alignItems: "center", opacity: hidden ? 0.55 : 1 }]}>
              <View style={{ width: 48, height: 48, borderRadius: 10, overflow: "hidden", backgroundColor: c.line }}>{p.media[0] && <Image source={{ uri: p.media[0].url }} style={{ width: 48, height: 48 }} />}</View>
              <View style={{ flex: 1 }}>
                <T size={14} weight="600" lines={1}>{p.title}</T>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Money cents={minPrice(p)} size={13} />
                  <T size={12} color={stock(p) === 0 ? c.live : c.muted}>{stock(p) === 0 ? "sold out" : `${stock(p)} left`}</T>
                </View>
              </View>
              <Btn kind={pinned ? "primary" : "ghost"} title={pinned ? "Pinned" : "Pin"} disabled={hidden} onPress={() => act("/pin", { productId: pinned ? null : p.id })} style={{ minHeight: 34, paddingHorizontal: 10 }} />
              {onAir && !hidden && stock(p) > 0 && !running && (
                <Btn kind="ghost" title="Auction" onPress={() => setAuctionFor(auctionFor === p.id ? null : p.id)} style={{ minHeight: 34, paddingHorizontal: 10 }} />
              )}
              <Btn kind="ghost" title={hidden ? "Show" : "Hide"} onPress={() => act(`/products/${p.id}`, { hidden: !hidden }, "PATCH")} style={{ minHeight: 34, paddingHorizontal: 10 }} />
            </View>
            {auctionFor === p.id && (
              <View style={{ gap: 8, paddingHorizontal: 4 }}>
                <Field label="Starting bid ($)" keyboardType="decimal-pad" value={start} onChangeText={setStart} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[
                    ["30 sec", 30],
                    ["1 min", 60],
                    ["2 min", 120],
                    ["5 min", 300],
                  ].map(([label, sec]) => (
                    <Btn key={label as string} style={{ flex: 1, minHeight: 36, paddingHorizontal: 6 }} kind="ghost" title={label as string} onPress={() => startAuction(p.id, sec as number)} />
                  ))}
                </View>
                <ErrorNote error={err} />
              </View>
            )}
          </View>
        );
      })}
    </>
  );
}

function CohostPanel({ st, act }: { st: any; act: (path: string, body?: unknown, method?: string) => Promise<any> }) {
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const [err, setErr] = useState<any>(null);

  async function ask(question: string) {
    setAsking(true);
    setErr(null);
    try {
      const r = await api(`/seller/streams/${st.id}/cohost/ask`, { body: { question } });
      setAnswers((a) => [{ q: question, a: r.answer }, ...a]);
      setQ("");
    } catch (e) {
      setErr(e);
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T size={13} style={{ flex: 1 }}>Let AI answer viewers in chat (labeled as AI)</T>
        <Switch value={st.aiPublicSpeech} onValueChange={(v) => act("/ai", { aiPublicSpeech: v }, "PATCH")} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T size={13}>Pause AI</T>
        <Switch value={st.aiPaused} onValueChange={(v) => act("/ai", { aiPaused: v }, "PATCH")} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {PRESETS.map((p) => (
          <Btn key={p} kind="ghost" title={p} onPress={() => ask(p)} style={{ minHeight: 34, paddingHorizontal: 10 }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field placeholder="Ask the co-host privately" value={q} onChangeText={setQ} />
        </View>
        <Btn kind="ai" title="Ask" busy={asking} disabled={!q.trim()} onPress={() => ask(q)} />
      </View>
      <ErrorNote error={err} />
      {answers.map((x, i) => (
        <View key={i} style={{ gap: 2 }}>
          <T size={12}>{x.q}</T>
          <T size={14}>{x.a}</T>
        </View>
      ))}
    </>
  );
}
