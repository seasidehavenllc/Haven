import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, newKey } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { LiveVideo } from "@/components/LiveVideo";
import { AuctionCard, ChatOverlay, Hearts, PinnedComment, PinnedProductCard, RailButton, applyChat, compact, glass, shadow, useLikes, type ChatLine, type HeartsHandle } from "@/components/LiveOverlay";
import { block, choose, report } from "@/lib/safety";
import { Icon, Loading, T, friendlyError, minPrice, stock, useColors } from "@/components/ui";
import { formatMoney } from "@haven/shared";

/**
 * A live show, full screen: the host's video fills the phone, with chat, hearts, the pinned product and any running auction
 * floating on top. Double-tap the video or tap the heart to send hearts. The bag opens everything the host is selling.
 */
export default function LiveViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { me, reload: reloadMe } = useMe();
  const { data: st, loading, error, reload, setData } = useApi<any>(`/streams/${id}`);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [shop, setShop] = useState(false);
  const [bidding, setBidding] = useState(false);
  const [leaders, setLeaders] = useState<Record<string, string>>({});
  const [muted, setMuted] = useState(false);
  const hearts = useRef<HeartsHandle>(null);
  const lastTap = useRef(0);
  const toastTimer = useRef<any>(null);
  const skew = useRef(0);

  const blocked = (uid?: string | null) => !!uid && !!me?.blockedUserIds?.includes(uid);
  const say = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    if (!st) return;
    setLines(st.chat.map((m: any) => ({ kind: "msg", m })));
    setMuted(!!st.youAreMuted);
  }, [st?.id]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const likes = useLikes(id!, st?.likeCount ?? 0, st?.status === "LIVE");

  useRealtime(`stream:${id}`, {
    "stream:chat": (m: any) => !blocked(m.userId) && setLines((cur) => applyChat(cur, m)),
    "stream:joined": (j: any) =>
      j.userId !== me?.user.id && !blocked(j.userId) && setLines((cur) => [...cur.slice(-149), { kind: "join", id: `join-${j.userId}-${Date.now()}`, userId: j.userId, name: j.displayName }]),
    "stream:likes": (l: any) => {
      setData((d: any) => d && { ...d, likeCount: Math.max(d.likeCount ?? 0, l.total) });
      if (l.userId !== me?.user.id) hearts.current?.pop(Math.min(l.added, 5));
    },
    "stream:pinned": (p: any) => setData((d: any) => d && { ...d, pinnedProductId: p.productId }),
    "stream:pinnedMessage": (p: any) => setData((d: any) => d && { ...d, pinnedMessage: p.message && !blocked(p.message.userId) ? p.message : null }),
    "stream:viewers": (p: any) => setData((d: any) => d && { ...d, viewers: p.count }),
    "stream:status": () => reload(),
    "stream:menu": () => reload(),
    "stream:auction": () => reload(),
    "stream:muted": (p: any) => {
      if (p.streamId !== id) return;
      setMuted(p.muted);
      say(p.muted ? "The host muted you in this show. You can still watch and buy." : "The host turned your chat back on.");
    },
    "auction:bid": (b: any) => {
      setData((d: any) => d && { ...d, auctions: d.auctions.map((a: any) => (a.id === b.auctionId ? { ...a, currentPriceCents: b.amountCents, endsAt: b.endsAt, status: "LIVE" } : a)) });
      if (b.bidderId) setLeaders((cur) => ({ ...cur, [b.auctionId]: b.bidderId }));
    },
    "auction:closed": (x: any) => {
      setData((d: any) => d && { ...d, auctions: d.auctions.filter((a: any) => a.id !== x.auctionId) });
      if (x.winnerId && x.winnerId === me?.user.id) say(`You won the auction at ${formatMoney(x.priceCents)}. Check out from Auctions.`);
      else if (x.winnerId) say(`Auction sold for ${formatMoney(x.priceCents)}`);
    },
    "inventory:changed": (v: any) =>
      setData((d: any) => d && { ...d, products: d.products.map((sp: any) => ({ ...sp, product: { ...sp.product, variants: sp.product.variants.map((x: any) => (x.id === v.id ? { ...x, quantity: v.quantity } : x)) } })) }),
  });

  if (loading) return <Loading />;
  if (error || !st)
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
        <T color="#fff" style={{ textAlign: "center" }}>{friendlyError(error)}</T>
        <Pressable onPress={() => router.back()}><T color={c.brandLight} weight="700">Go back</T></Pressable>
      </View>
    );

  const live = st.status === "LIVE";
  const open = ["LIVE", "PAUSED"].includes(st.status);
  const pinned = st.products.find((p: any) => p.productId === st.pinnedProductId)?.product;
  const auction = st.auctions.find((a: any) => a.status === "LIVE" || new Date(a.startsAt).getTime() <= Date.now());
  const auctionProduct = auction && st.products.find((p: any) => p.productId === auction.productId)?.product;
  const isHost = me?.user.id === st.seller.userId;

  const heart = () => {
    if (!live) return;
    likes.tap();
    hearts.current?.pop();
  };
  const onVideoPress = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) heart();
    lastTap.current = now;
  };

  async function add(p: any) {
    const v = p.variants.find((x: any) => x.quantity > 0);
    if (!v) return;
    try {
      await api("/cart/items", { body: { variantId: v.id, quantity: 1 } });
      say(`${p.title} is in your cart. Check out without leaving the show.`);
    } catch (e) {
      say(friendlyError(e));
    }
  }

  async function bid(cents: number) {
    if (!auction) return;
    setBidding(true);
    try {
      await api(`/auctions/${auction.id}/bids`, { body: { amountCents: cents, idempotencyKey: newKey() } });
      setLeaders((cur) => ({ ...cur, [auction.id]: me!.user.id }));
      say(`You bid ${formatMoney(cents)}`);
    } catch (e: any) {
      say(friendlyError(e));
      reload();
    } finally {
      setBidding(false);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    try {
      await api(`/streams/${id}/chat`, { body: { body } });
      setText("");
    } catch (e: any) {
      if (e?.status === 403) setMuted(true);
      say(friendlyError(e));
    }
  }

  async function onMessageLongPress(m: any) {
    if (!me || !m.userId || m.userId === me.user.id || !m.user?.handle) return;
    const i = await choose(`Message from @${m.user.handle}`, ["Report message", `Block @${m.user.handle}`], 1);
    if (i === 0) await report("chat", m.id, "this message");
    if (i === 1 && (await block(m.user.handle))) {
      await reloadMe();
      setLines((cur) => cur.filter((l) => (l.kind === "msg" ? l.m.userId !== m.userId : l.userId !== m.userId)));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* Video, full screen. Double-tap for hearts. */}
      <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onVideoPress} accessibilityLabel="Double-tap to send hearts">
        {live && st.video.configured ? (
          <LiveVideo streamId={st.id} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
            <T color="#fff" size={14} style={{ textAlign: "center", opacity: 0.85 }}>
              {st.status === "SCHEDULED"
                ? `Starts ${st.scheduledFor ? new Date(st.scheduledFor).toLocaleString() : "soon"}`
                : st.status === "ENDED"
                  ? "This show has ended"
                  : st.status === "PAUSED"
                    ? "The host paused the show. It'll be back shortly."
                    : "Live video isn't connected on this server yet. Chat, the menu and buying still work."}
            </T>
          </View>
        )}
      </Pressable>

      {/* Top: host, live badge, viewers, close. */}
      <View style={{ position: "absolute", top: insets.top + 6, left: 10, right: 10, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            onPress={() => st.seller.storefront?.slug && router.push(`/u/${st.seller.storefront.slug}` as any)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: glass, borderRadius: 999, paddingRight: 12, padding: 3, maxWidth: "60%" }}
          >
            <View style={{ width: 32, height: 32, borderRadius: 16, overflow: "hidden", backgroundColor: c.brand, alignItems: "center", justifyContent: "center" }}>
              {st.seller.storefront?.logoUrl ? <Image source={{ uri: st.seller.storefront.logoUrl }} style={{ width: 32, height: 32 }} /> : <T size={14} weight="700" color="#fff">{(st.seller.storefront?.name ?? st.seller.businessName).slice(0, 1)}</T>}
            </View>
            <View style={{ flexShrink: 1 }}>
              <T size={13} weight="700" color="#fff" lines={1}>{st.seller.storefront?.name ?? st.seller.businessName}</T>
              <T size={11} color="#ffffffcc" lines={1}>{st.title}</T>
            </View>
          </Pressable>
          <View style={{ flex: 1 }} />
          {live && (
            <View style={{ backgroundColor: c.live, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
              <T size={11} weight="800" color="#fff">LIVE</T>
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: glass, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
            <Icon name="eye" size={13} color="#fff" />
            <T size={12} weight="700" color="#fff">{compact(st.viewers)}</T>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Close show" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: glass, alignItems: "center", justifyContent: "center" }}>
            <Icon name="close" size={20} color="#fff" />
          </Pressable>
        </View>
        {st.aiDisclosure && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(102,112,240,0.7)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start" }}>
            <Icon name="sparkles" size={13} color="#fff" />
            <T size={12} weight="600" color="#fff">{st.aiDisclosure}</T>
          </View>
        )}
        {st.pinnedMessage && <PinnedComment m={st.pinnedMessage} />}
      </View>

      <Hearts bottom={insets.bottom + 240} />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        {/* Right rail: hearts, shop, report. */}
        <View style={{ position: "absolute", right: 10, bottom: insets.bottom + 70, gap: 14, alignItems: "center" }}>
          <RailButton icon="heart" color={c.live} label="Send hearts" count={compact(likes.total)} onPress={heart} />
          <RailButton icon="bag-handle" label="Shop this show" count={String(st.products.length)} onPress={() => setShop(true)} />
          {me && !isHost && <RailButton icon="flag-outline" label="Report this live stream" onPress={() => report("stream", st.id, "this live stream")} />}
        </View>

        <View style={{ paddingHorizontal: 10, paddingRight: 72, gap: 8 }}>
          {toast && (
            <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(11,19,28,0.9)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
              <T size={13} color="#fff">{toast}</T>
            </View>
          )}
          <ChatOverlay lines={lines} onLongPress={onMessageLongPress} maxHeight={Math.min(260, height * 0.3)} hostUserId={st.seller.userId} />
          {auction && <AuctionCard a={auction} product={auctionProduct} skewMs={skew.current} leading={leaders[auction.id] === me?.user.id} onBid={isHost ? undefined : bid} busy={bidding} />}
          {pinned && <PinnedProductCard p={pinned} onBuy={isHost ? undefined : () => add(pinned)} />}
        </View>

        {/* Chat box. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: insets.bottom + 8 }}>
          {muted ? (
            <View style={{ flex: 1, backgroundColor: glass, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 11 }}>
              <T size={13} color="#ffffffb3">The host muted you in this show</T>
            </View>
          ) : (
            <TextInput
              style={{ flex: 1, backgroundColor: glass, color: "#fff", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 }}
              placeholder={open ? "Say something…" : "Chat opens when the show starts"}
              placeholderTextColor="#ffffff99"
              editable={open}
              value={text}
              onChangeText={setText}
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={send}
            />
          )}
          {!muted && !!text.trim() && (
            <Pressable onPress={send} accessibilityLabel="Send message" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.brand, alignItems: "center", justifyContent: "center" }}>
              <Icon name="arrow-up" size={20} color="#fff" />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <ShopSheet visible={shop} onClose={() => setShop(false)} products={st.products.map((sp: any) => sp.product)} pinnedId={st.pinnedProductId} onAdd={isHost ? undefined : add} bottom={insets.bottom} />
    </View>
  );
}

/** Everything the host is selling in this show, in a sheet over the video. */
function ShopSheet({ visible, onClose, products, pinnedId, onAdd, bottom }: { visible: boolean; onClose: () => void; products: any[]; pinnedId?: string | null; onAdd?: (p: any) => void; bottom: number }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#0006" }} onPress={onClose} accessibilityLabel="Close shop" />
      <View style={{ backgroundColor: c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "65%", paddingBottom: bottom + 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 8 }}>
          <T size={17} weight="700" style={{ flex: 1 }}>Shop this show</T>
          <Pressable onPress={() => { onClose(); router.push("/cart"); }} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="cart" size={18} color={c.brandLight} />
            <T size={14} weight="700" color={c.brandLight}>Cart</T>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 14, gap: 10 }}>
          {!products.length && <T size={13} color={c.muted}>The host hasn't added anything yet.</T>}
          {products.map((p) => {
            const left = stock(p);
            return (
              <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: left === 0 ? 0.55 : 1 }}>
                <Pressable onPress={() => { onClose(); router.push(`/p/${p.id}`); }} style={{ width: 60, height: 60, borderRadius: 12, overflow: "hidden", backgroundColor: c.line, borderWidth: p.id === pinnedId ? 2 : 0, borderColor: c.brand }}>
                  {p.media[0] && <Image source={{ uri: p.media[0].url }} style={{ width: 60, height: 60 }} />}
                </Pressable>
                <View style={{ flex: 1 }}>
                  {p.id === pinnedId && <T size={11} weight="700" color={c.brandLight}>SHOWING NOW</T>}
                  <T size={14} weight="600" lines={2}>{p.title}</T>
                  <T size={13} color={c.muted}>{minPrice(p) == null ? "" : formatMoney(minPrice(p)!)}{left === 0 ? " · sold out" : left <= 3 ? ` · ${left} left` : ""}</T>
                </View>
                {onAdd && (
                  <Pressable onPress={() => onAdd(p)} disabled={left === 0} style={{ backgroundColor: left === 0 ? c.line : c.brand, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
                    <T size={13} weight="700" color="#fff">{left === 0 ? "Sold out" : "Add"}</T>
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
