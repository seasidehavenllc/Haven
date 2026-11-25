import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatMoney } from "@haven/shared";
import { api, newKey } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { block, choose, report } from "@/lib/safety";
import { LiveVideo } from "./LiveVideo";
import { AuctionCard, ChatOverlay, Hearts, PinnedComment, PinnedProductCard, ReplyBar, SideTab, applyChat, compact, glass, shadow, useLikes, type ChatLine, type HeartsHandle } from "./LiveOverlay";
import { Avatar, Icon, Loading, T, friendlyError, minPrice, stock, useColors } from "./ui";

/** Public links (share sheet) point at the Haven website, which opens the same show or profile. */
export const SITE = "https://sales.seasidehavenllc.com";

/** Who is hosting a show, from the stream row (works for both the list and the full show). */
export const hostOf = (st: any) => ({
  userId: (st.seller?.userId ?? st.seller?.user?.id) as string | undefined,
  handle: st.seller?.user?.handle as string | undefined,
  name: (st.seller?.user?.displayName ?? st.seller?.storefront?.name ?? st.seller?.businessName ?? "Host") as string,
  avatarUrl: (st.seller?.user?.avatarUrl ?? st.seller?.storefront?.logoUrl) as string | null | undefined,
});

/**
 * One live show, full screen: the host's video with chat, hearts, the item being shown, any running auction, and
 * the comment bar floating on top. Used on its own (opened from a notification or a profile) and inside the
 * swipeable feed of live shows.
 *
 * `standalone` adds a close button. `others` are the other shows for the Lives tab; `onJump` switches to one.
 */
export function LiveShow({ id, standalone, others = [], onJump }: { id: string; standalone?: boolean; others?: any[]; onJump?: (id: string) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottomInset = standalone ? insets.bottom : 0;
  const { height } = useWindowDimensions();
  const { me, reload: reloadMe } = useMe();
  const { data: st, loading, error, reload, setData } = useApi<any>(`/streams/${id}`);
  const cart = useApi<any>(me ? "/cart" : null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<any>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "products" | "lives" | "help">(null);
  const [hideChat, setHideChat] = useState(false);
  const [bidding, setBidding] = useState(false);
  const [leaders, setLeaders] = useState<Record<string, string>>({});
  const [muted, setMuted] = useState(false);
  const [extraInCart, setExtraInCart] = useState(0);
  const hearts = useRef<HeartsHandle>(null);
  const input = useRef<any>(null);
  const lastTap = useRef(0);
  const toastTimer = useRef<any>(null);

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

  const likes = useLikes(id, st?.likeCount ?? 0, st?.status === "LIVE");

  // Events for this show only: the socket is shared, so ignore anything tagged with another show.
  const mine = (p: any) => !p?.streamId || p.streamId === id;
  useRealtime(`stream:${id}`, {
    "stream:chat": (m: any) => mine(m) && !blocked(m.userId) && setLines((cur) => applyChat(cur, m)),
    "stream:joined": (j: any) =>
      mine(j) && j.userId !== me?.user.id && !blocked(j.userId) && setLines((cur) => [...cur.slice(-149), { kind: "join", id: `join-${j.userId}-${Date.now()}`, userId: j.userId, name: j.displayName }]),
    "stream:likes": (l: any) => {
      if (!mine(l)) return;
      setData((d: any) => d && { ...d, likeCount: Math.max(d.likeCount ?? 0, l.total) });
      if (l.userId !== me?.user.id) hearts.current?.pop(Math.min(l.added, 5));
    },
    "stream:pinned": (p: any) => mine(p) && setData((d: any) => d && { ...d, pinnedProductId: p.productId }),
    "stream:pinnedMessage": (p: any) => mine(p) && setData((d: any) => d && { ...d, pinnedMessage: p.message && !blocked(p.message.userId) ? p.message : null }),
    "stream:viewers": (p: any) => mine(p) && setData((d: any) => d && { ...d, viewers: p.count }),
    "stream:status": (p: any) => mine(p) && reload(),
    "stream:menu": (p: any) => mine(p) && reload(),
    "stream:auction": (p: any) => mine(p) && reload(),
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

  if (loading && !st) return <View style={{ flex: 1, backgroundColor: "#000" }}><Loading /></View>;
  if (error || !st)
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
        <T color="#fff" style={{ textAlign: "center" }}>{friendlyError(error)}</T>
        <Pressable onPress={reload}><T color={c.brandLight} weight="700">Try again</T></Pressable>
      </View>
    );

  const live = st.status === "LIVE";
  const open = ["LIVE", "PAUSED"].includes(st.status);
  const host = hostOf(st);
  const isHost = me?.user.id === st.seller.userId;
  const products: any[] = st.products.map((sp: any) => sp.product);
  const pinned = products.find((p) => p.id === st.pinnedProductId);
  const auction = st.auctions.find((a: any) => a.status === "LIVE" || new Date(a.startsAt).getTime() <= Date.now());
  const auctionProduct = auction && products.find((p) => p.id === auction.productId);
  const inCart = (cart.data?.items ?? []).reduce((n: number, i: any) => n + i.quantity, 0) + extraInCart;

  const close = () => (router.canGoBack() ? router.back() : router.replace("/live"));
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

  async function toggleFollow() {
    if (!host.userId) return;
    const next = !st.followingHost;
    setData((d: any) => d && { ...d, followingHost: next });
    try {
      await api(`/users/${host.userId}/follow`, { method: next ? "POST" : "DELETE" });
      if (next) say(`You'll get a notification when ${host.name} goes live.`);
    } catch (e) {
      setData((d: any) => d && { ...d, followingHost: !next });
      say(friendlyError(e));
    }
  }

  async function share() {
    const url = `${SITE}/live/${st.id}`;
    try {
      await Share.share(Platform.OS === "ios" ? { message: `${host.name} is live on Haven: ${st.title}`, url } : { message: `${host.name} is live on Haven: ${st.title} ${url}` });
    } catch {
      /* the share sheet was dismissed */
    }
  }

  async function add(p: any) {
    const v = p.variants.find((x: any) => x.quantity > 0);
    if (!v) return;
    try {
      await api("/cart/items", { body: { variantId: v.id, quantity: 1 } });
      setExtraInCart((n) => n + 1);
      say(`${p.title} is in your cart. Keep watching, check out any time.`);
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
      await api(`/streams/${id}/chat`, { body: { body, ...(replyTo ? { replyToId: replyTo.id } : {}) } });
      setText("");
      setReplyTo(null);
    } catch (e: any) {
      if (e?.status === 403) setMuted(true);
      say(friendlyError(e));
    }
  }

  function startReply(m: any) {
    if (muted || !open) return;
    setReplyTo(m);
    setHideChat(false);
    input.current?.focus();
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

  const otherLive = others.filter((o) => o.id !== id && ["LIVE", "PAUSED"].includes(o.status));
  const upcoming = others.filter((o) => o.status === "SCHEDULED");

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* Video, full screen. Double-tap for hearts. */}
      <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onVideoPress} accessibilityLabel="Double-tap to send hearts">
        {live && st.video.configured ? (
          <LiveVideo streamId={st.id} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, paddingBottom: 260, gap: 14 }}>
            <Avatar uri={host.avatarUrl} name={host.name} size={84} />
            <T color="#fff" size={14} style={{ textAlign: "center", opacity: 0.85 }}>
              {st.status === "SCHEDULED"
                ? `Starts ${st.scheduledFor ? new Date(st.scheduledFor).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "soon"}`
                : st.status === "ENDED"
                  ? "This show has ended"
                  : st.status === "PAUSED"
                    ? "The host paused the show. It'll be back shortly."
                    : "Live video isn't connected on this server yet. Chat, the menu and buying still work."}
            </T>
          </View>
        )}
      </Pressable>

      {/* Top: host with follow, viewers, close. */}
      <View style={{ position: "absolute", top: insets.top + 6, left: 10, right: 10, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: glass, borderRadius: 22, padding: 4, paddingRight: 10, flexShrink: 1 }}>
            <Pressable onPress={() => host.handle && router.push(`/u/${host.handle}`)} accessibilityRole="button" accessibilityLabel={`Open ${host.name}'s profile and shop`}>
              <View style={{ borderRadius: 999, borderWidth: 2, borderColor: live ? c.live : "transparent", padding: 1 }}>
                <Avatar uri={host.avatarUrl} name={host.name} size={36} />
              </View>
              {live && (
                <View style={{ position: "absolute", bottom: -5, alignSelf: "center", backgroundColor: c.live, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 }}>
                  <T size={9} weight="800" color="#fff">LIVE</T>
                </View>
              )}
            </Pressable>
            <View style={{ flexShrink: 1, gap: 3 }}>
              <T size={14} weight="800" color="#fff" lines={1} onPress={() => host.handle && router.push(`/u/${host.handle}`)}>{host.name}</T>
              {!isHost && me ? (
                <Pressable onPress={toggleFollow} accessibilityRole="button" hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: st.followingHost ? "rgba(255,255,255,0.18)" : c.brand }}>
                  <Icon name={st.followingHost ? "checkmark" : "add"} size={12} color="#fff" />
                  <T size={11} weight="700" color="#fff">{st.followingHost ? "Following" : "Follow"}</T>
                </Pressable>
              ) : (
                !!host.handle && <T size={11} color="#ffffffcc" lines={1}>@{host.handle}</T>
              )}
            </View>
          </View>
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: glass, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Icon name="eye" size={14} color="#fff" />
            <T size={13} weight="700" color="#fff">{compact(st.viewers ?? 0)}</T>
          </View>
          {standalone && (
            <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close show" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: glass, alignItems: "center", justifyContent: "center" }}>
              <Icon name="close" size={20} color="#fff" />
            </Pressable>
          )}
        </View>
        <T size={13} weight="600" color="#fff" lines={1} style={[shadow, { marginLeft: 4, marginRight: 50 }]}>{st.title}</T>
        {st.aiDisclosure && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(102,112,240,0.7)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start" }}>
            <Icon name="sparkles" size={13} color="#fff" />
            <T size={12} weight="600" color="#fff">{st.aiDisclosure}</T>
          </View>
        )}
        {st.pinnedMessage && !hideChat && <PinnedComment m={st.pinnedMessage} />}
      </View>

      {/* Left edge: other lives, help, hide chat. */}
      <View style={{ position: "absolute", left: 0, top: insets.top + 120, gap: 8 }}>
        <SideTab side="left" label="Lives" color={c.live} onPress={() => setSheet("lives")} length={74} />
        <SideTab side="left" label="Help" color={c.ai} onPress={() => setSheet("help")} length={64} />
        <SideTab side="left" label={hideChat ? "Show chat" : "Hide chat"} color={c.brand} onPress={() => setHideChat(!hideChat)} length={98} />
      </View>

      {/* Right edge: cart, share, report. */}
      <View style={{ position: "absolute", right: 8, top: insets.top + 120, gap: 14, alignItems: "center" }}>
        <RoundAction icon="cart" label="Cart" bg={c.brand} badge={inCart} onPress={() => router.push("/cart")} />
        <RoundAction icon="arrow-redo" label="Share" onPress={share} />
        {me && !isHost && <RoundAction icon="flag-outline" label="Report" onPress={() => report("stream", st.id, "this live stream")} />}
      </View>

      <Hearts bottom={bottomInset + 70} right={4} />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        {/* Chat sits clear of the side tabs on the left and the buttons on the right. */}
        <View style={{ paddingLeft: 38, paddingRight: 56, gap: 8 }}>
          {toast && (
            <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(11,19,28,0.92)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
              <T size={13} color="#fff">{toast}</T>
            </View>
          )}
          {!hideChat && <ChatOverlay lines={lines} onLongPress={onMessageLongPress} onReply={me && !isHost ? startReply : undefined} maxHeight={Math.min(250, height * 0.27)} hostUserId={st.seller.userId} />}
        </View>
        <View style={{ paddingHorizontal: 10, gap: 8, marginTop: 8 }}>
          {auction && <AuctionCard a={auction} product={auctionProduct} leading={leaders[auction.id] === me?.user.id} onBid={isHost ? undefined : bid} busy={bidding} />}
          {pinned && <PinnedProductCard p={pinned} onBuy={isHost ? undefined : () => add(pinned)} onOpen={() => router.push(`/p/${pinned.id}`)} />}
          {replyTo && <ReplyBar m={replyTo} hostUserId={st.seller.userId} onCancel={() => setReplyTo(null)} />}
        </View>

        {/* Bottom bar: products, comment, hearts. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingTop: 8, paddingBottom: bottomInset + 8 }}>
          <Pressable onPress={() => setSheet("products")} accessibilityLabel={`Products, ${products.length}`} style={{ alignItems: "center" }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.warn, alignItems: "center", justifyContent: "center" }}>
              <Icon name="bag-handle" size={22} color="#03060a" />
            </View>
            <Badge n={products.length} color={c.live} />
            <T size={10} weight="700" color="#fff" style={shadow}>Products</T>
          </Pressable>
          {muted ? (
            <View style={{ flex: 1, backgroundColor: glass, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 12 }}>
              <T size={13} color="#ffffffb3">The host muted you in this show</T>
            </View>
          ) : (
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: glass, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", paddingLeft: 14, paddingRight: 4 }}>
              <TextInput
                ref={input}
                style={{ flex: 1, color: "#fff", paddingVertical: 11, fontSize: 15 }}
                placeholder={open ? (replyTo ? "Write a reply…" : "Comment…") : "Chat opens when the show starts"}
                placeholderTextColor="#ffffff99"
                editable={open}
                value={text}
                onChangeText={setText}
                maxLength={500}
                returnKeyType="send"
                onSubmitEditing={send}
              />
              <Pressable onPress={send} disabled={!text.trim()} accessibilityLabel="Send comment" hitSlop={6} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: text.trim() ? c.brand : "transparent" }}>
                <Icon name="send" size={17} color={text.trim() ? "#fff" : "#ffffff80"} />
              </Pressable>
            </View>
          )}
          <Pressable onPress={heart} accessibilityLabel="Send hearts" disabled={!live} style={{ alignItems: "center" }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: glass, alignItems: "center", justifyContent: "center" }}>
              <Icon name="heart" size={24} color={c.live} />
            </View>
            <T size={10} weight="700" color="#fff" style={shadow}>{compact(likes.total)}</T>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ProductsSheet visible={sheet === "products"} onClose={() => setSheet(null)} products={products} pinnedId={st.pinnedProductId} onAdd={isHost ? undefined : add} inCart={inCart} bottom={insets.bottom} />
      <LivesSheet
        visible={sheet === "lives"}
        onClose={() => setSheet(null)}
        live={otherLive}
        upcoming={upcoming}
        bottom={insets.bottom}
        onPick={(o) => {
          setSheet(null);
          if (onJump && ["LIVE", "PAUSED"].includes(o.status)) onJump(o.id);
          else router.push(`/live/${o.id}`);
        }}
      />
      <HelpSheet visible={sheet === "help"} onClose={() => setSheet(null)} bottom={insets.bottom} />
    </View>
  );
}

function Badge({ n, color }: { n: number; color: string }) {
  if (!n) return null;
  return (
    <View style={{ position: "absolute", top: -4, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 1.5, borderColor: "#000" }}>
      <T size={10} weight="800" color="#fff">{n > 99 ? "99+" : n}</T>
    </View>
  );
}

function RoundAction({ icon, label, onPress, bg = glass, badge = 0 }: { icon: any; label: string; onPress: () => void; bg?: string; badge?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={badge ? `${label}, ${badge} items` : label} hitSlop={6} style={{ alignItems: "center", gap: 2 }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={22} color="#fff" />
      </View>
      <Badge n={badge} color="#ff4d6d" />
      <T size={10} weight="700" color="#fff" style={shadow}>{label}</T>
    </Pressable>
  );
}

function Sheet({ visible, onClose, title, right, bottom, children }: { visible: boolean; onClose: () => void; title: string; right?: React.ReactNode; bottom: number; children: React.ReactNode }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#0008" }} onPress={onClose} accessibilityLabel="Close" />
      <View style={{ backgroundColor: c.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "70%", paddingBottom: bottom + 10 }}>
        <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.line, marginTop: 8 }} />
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
          <T size={18} weight="800" style={{ flex: 1 }}>{title}</T>
          {right}
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Icon name="close" size={22} color={c.muted} />
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** Everything the host is selling in this show. */
function ProductsSheet({ visible, onClose, products, pinnedId, onAdd, inCart, bottom }: { visible: boolean; onClose: () => void; products: any[]; pinnedId?: string | null; onAdd?: (p: any) => void; inCart: number; bottom: number }) {
  const c = useColors();
  const sorted = [...products].sort((a, b) => (a.id === pinnedId ? -1 : b.id === pinnedId ? 1 : 0));
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Products (${products.length})`}
      bottom={bottom}
      right={
        <Pressable onPress={() => { onClose(); router.push("/cart"); }} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: c.brand, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6 }}>
          <Icon name="cart" size={16} color="#fff" />
          <T size={13} weight="700" color="#fff">{inCart ? `Check out (${inCart})` : "Cart"}</T>
        </Pressable>
      }
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
        {!products.length && <T size={13} color={c.muted}>The host hasn't added anything yet.</T>}
        {sorted.map((p) => {
          const left = stock(p);
          return (
            <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: left === 0 ? 0.55 : 1 }}>
              <Pressable onPress={() => { onClose(); router.push(`/p/${p.id}`); }} style={{ width: 68, height: 68, borderRadius: 12, overflow: "hidden", backgroundColor: c.line, borderWidth: p.id === pinnedId ? 2 : 0, borderColor: c.live }}>
                {p.media[0] && <Image source={{ uri: p.media[0].url }} style={{ width: 68, height: 68 }} />}
              </Pressable>
              <View style={{ flex: 1, gap: 1 }}>
                {p.id === pinnedId && <T size={11} weight="800" color={c.live}>SHOWING NOW</T>}
                <T size={14} weight="600" lines={2}>{p.title}</T>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <T size={14} weight="800" color={c.brandLight}>{minPrice(p) == null ? "" : formatMoney(minPrice(p)!)}</T>
                  {left === 0 ? <T size={12} color={c.muted}>Sold out</T> : left <= 3 ? <T size={12} weight="700" color={c.warn}>Only {left} left</T> : null}
                </View>
              </View>
              {onAdd && (
                <Pressable onPress={() => onAdd(p)} disabled={left === 0} accessibilityLabel={`Add ${p.title} to cart`} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: left === 0 ? c.line : c.brand, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="cart" size={18} color="#fff" />
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

/** Other people live right now, and shows coming up. */
function LivesSheet({ visible, onClose, live, upcoming, onPick, bottom }: { visible: boolean; onClose: () => void; live: any[]; upcoming: any[]; onPick: (o: any) => void; bottom: number }) {
  const c = useColors();
  const row = (o: any) => {
    const h = hostOf(o);
    const cover = o.products?.[0]?.product?.media?.[0]?.url;
    const isLive = ["LIVE", "PAUSED"].includes(o.status);
    return (
      <Pressable key={o.id} onPress={() => onPick(o)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 56, height: 56, borderRadius: 14, overflow: "hidden", backgroundColor: c.line, alignItems: "center", justifyContent: "center" }}>
          {cover ? <Image source={{ uri: cover }} style={{ width: 56, height: 56 }} /> : <Avatar uri={h.avatarUrl} name={h.name} size={56} />}
        </View>
        <View style={{ flex: 1 }}>
          <T size={14} weight="700" lines={1}>{h.name}</T>
          <T size={13} color={c.muted} lines={1}>{o.title}</T>
          {!isLive && o.scheduledFor && <T size={12} color={c.brandLight}>{new Date(o.scheduledFor).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</T>}
        </View>
        {isLive ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.live, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 }}>
            <Icon name="eye" size={11} color="#fff" />
            <T size={11} weight="800" color="#fff">{compact(o.viewers ?? 0)}</T>
          </View>
        ) : (
          <Icon name="chevron-forward" size={18} color={c.muted} />
        )}
      </Pressable>
    );
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Lives" bottom={bottom}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
        <T size={13} weight="800" color={c.live}>LIVE NOW</T>
        {live.length ? live.map(row) : <T size={13} color={c.muted}>No one else is live right now.</T>}
        {upcoming.length > 0 && <T size={13} weight="800" color={c.brandLight} style={{ marginTop: 8 }}>COMING UP</T>}
        {upcoming.map(row)}
        <Pressable onPress={() => { onClose(); router.push("/auctions"); }} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
          <Icon name="hammer" size={16} color={c.warn} />
          <T size={14} weight="700" color={c.warn}>See all auctions</T>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

function HelpSheet({ visible, onClose, bottom }: { visible: boolean; onClose: () => void; bottom: number }) {
  const c = useColors();
  const tips: [any, string, string][] = [
    ["bag-handle", "Buy what's on screen", "The card at the bottom is the item the host is showing. Tap Buy and it goes in your cart."],
    ["albums", "See everything", "Products shows every item in this show, with prices and how many are left."],
    ["cart", "Check out any time", "Your cart keeps everything you add. Check out now or after the show."],
    ["hammer", "Auctions", "When an auction runs, tap Bid to bid the next amount. The highest bid when time runs out wins."],
    ["arrow-undo", "Reply to someone", "Tap a comment, or its arrow, to reply to it."],
    ["heart", "Send hearts", "Double-tap the video or tap the heart."],
    ["swap-vertical", "More shows", "Swipe up for the next person selling live, or open Lives."],
    ["flag", "Something wrong?", "Hold a comment to report or block someone, or use Report to flag the show."],
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title="How live shopping works" bottom={bottom}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 14, paddingBottom: 8 }}>
        {tips.map(([icon, title, body]) => (
          <View key={title} style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.line, alignItems: "center", justifyContent: "center" }}>
              <Icon name={icon} size={18} color={c.brandLight} />
            </View>
            <View style={{ flex: 1 }}>
              <T size={14} weight="700">{title}</T>
              <T size={13} color={c.muted}>{body}</T>
            </View>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/** What a show looks like in the feed before you land on it: the host and the first item, no video yet. */
export function LiveCover({ st }: { st: any }) {
  const h = hostOf(st);
  const cover = st.products?.[0]?.product?.media?.[0]?.url;
  return (
    <View style={{ flex: 1, backgroundColor: "#03060a", alignItems: "center", justifyContent: "center", gap: 12 }}>
      {cover && <Image source={{ uri: cover }} blurRadius={18} style={{ position: "absolute", width: "100%", height: "100%", opacity: 0.55 }} />}
      <Avatar uri={h.avatarUrl} name={h.name} size={84} />
      <T size={17} weight="800" color="#fff">{h.name}</T>
      <T size={14} color="#ffffffcc" style={{ textAlign: "center", paddingHorizontal: 30 }}>{st.title}</T>
    </View>
  );
}
