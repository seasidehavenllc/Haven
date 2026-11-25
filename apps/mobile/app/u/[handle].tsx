import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Platform, Pressable, ScrollView, Share, TextInput, View, useWindowDimensions } from "react-native";
import { formatMoney } from "@haven/shared";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { block, choose, report } from "@/lib/safety";
import { manageListing } from "@/lib/listing";
import { SITE } from "@/components/LiveShow";
import { Avatar, Empty, ErrorNote, Icon, Loading, T, minPrice, stock, useColors } from "@/components/ui";

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const when = (d: string) => new Date(d).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

type Tab = "shop" | "videos" | "about";
type Sort = "new" | "price_low" | "price_high";

/**
 * Everyone's profile. Sellers' profiles are their shop too: live-now banner, shop stats, upcoming shows, and a
 * searchable Shop tab where you can add things to your cart without leaving. Everyone has Videos and About.
 */
export default function Profile() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { me, reload: reloadMe } = useMe();
  const profile = useApi<any>(`/users/${handle}`);
  const videos = useApi<any[]>(`/users/${handle}/videos`);
  const [tab, setTab] = useState<Tab | null>(null);
  const [err, setErr] = useState<any>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<any>(null);
  const shop = useShop(handle!, !!profile.data?.seller && !profile.data?.blocked);

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  // Coming back from Edit profile or a follower list: show the latest. A changed username moves this screen to the new one.
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) return void (first.current = false);
      if (profile.data?.isMe && me && me.user.handle !== handle) router.setParams({ handle: me.user.handle });
      else profile.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile.data?.isMe, me?.user.handle, handle]),
  );
  const say = (m: string) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  if (profile.loading && !profile.data) return <Loading />;
  if (profile.error || !profile.data) return <View style={{ padding: 16 }}><ErrorNote error={profile.error} /></View>;
  const p = profile.data;
  const seller = p.blocked ? null : p.seller;
  const current: Tab = tab ?? (seller ? "shop" : "videos");
  const cover: string | null = p.blocked ? null : p.coverUrl ?? seller?.storefront?.bannerUrl ?? null;
  const tabs: Tab[] = seller ? ["shop", "videos", "about"] : ["videos", "about"];

  async function toggleFollow() {
    const next = !p.followedByMe;
    setErr(null);
    profile.setData((d: any) => ({ ...d, followedByMe: next, followerCount: d.followerCount + (next ? 1 : -1) }));
    try {
      await api(`/users/${p.id}/follow`, { method: next ? "POST" : "DELETE" });
      if (next && seller) say(`You'll get a notification when ${p.displayName} goes live.`);
    } catch (e) {
      setErr(e);
      profile.reload();
    }
  }

  async function share() {
    const url = `${SITE}/u/${p.handle}`;
    const message = seller ? `Shop ${seller.storefront?.name ?? p.displayName} on Haven` : `${p.displayName} on Haven`;
    try {
      await Share.share(Platform.OS === "ios" ? { message, url } : { message: `${message} ${url}` });
    } catch {
      /* dismissed */
    }
  }

  async function more() {
    if (!me || p.isMe) return;
    const i = await choose(`@${p.handle}`, [`Report @${p.handle}`, p.blockedByMe ? `Unblock @${p.handle}` : `Block @${p.handle}`], 1);
    if (i === 0) await report("user", p.id, `@${p.handle}`);
    if (i === 1) {
      if (p.blockedByMe) await api(`/users/${p.handle}/block`, { method: "DELETE" }).catch(setErr);
      else if (!(await block(p.handle))) return;
      await Promise.all([reloadMe(), profile.reload(), videos.reload()]);
    }
  }

  async function addToCart(prod: any) {
    const v = prod.variants.find((x: any) => x.quantity > 0);
    if (!v) return;
    try {
      await api("/cart/items", { body: { variantId: v.id, quantity: 1 } });
      say(`${prod.title} is in your cart`);
    } catch (e: any) {
      say(e?.message ?? "Couldn't add that. Try again.");
    }
  }

  const header = (
    <View style={{ gap: 14, paddingBottom: 6 }}>
      {/* Banner and photo. A live seller gets a ring and a LIVE tag on their photo; tap it to watch. */}
      <View>
        <Pressable
          disabled={!p.isMe}
          onPress={() => router.push("/profile/edit")}
          accessibilityLabel={p.isMe ? "Change your cover photo" : undefined}
          style={{ height: seller || cover ? 130 : 80, marginHorizontal: -16, backgroundColor: c.brand + "33", overflow: "hidden" }}
        >
          {cover ? (
            <Image source={{ uri: cover }} style={{ width: "100%", height: "100%" }} />
          ) : (
            <View style={{ flex: 1, flexDirection: "row" }}>
              <View style={{ flex: 1, backgroundColor: c.brand + "40" }} />
              <View style={{ flex: 1, backgroundColor: c.ai + "35" }} />
              <View style={{ flex: 1, backgroundColor: c.live + "30" }} />
            </View>
          )}
          {p.isMe && (
            <View style={{ position: "absolute", right: 12, top: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#000000aa", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Icon name="camera" size={13} color="#fff" />
              <T size={12} weight="700" color="#fff">{cover ? "Edit cover" : "Add cover"}</T>
            </View>
          )}
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: -44 }}>
          <Pressable
            disabled={!seller?.liveNow && !p.isMe}
            onPress={() => (seller?.liveNow ? router.push(`/live/${seller.liveNow.id}`) : router.push("/profile/edit"))}
            accessibilityLabel={seller?.liveNow ? `${p.displayName} is live. Watch now` : p.isMe ? "Change your profile photo" : undefined}
          >
            <View style={{ borderRadius: 999, borderWidth: 3, borderColor: seller?.liveNow ? c.live : c.paper, padding: 2, backgroundColor: c.paper }}>
              <Avatar uri={p.avatarUrl} name={p.displayName} size={88} />
            </View>
            {p.isMe && !seller?.liveNow && (
              <View style={{ position: "absolute", right: 2, bottom: 2, width: 28, height: 28, borderRadius: 14, backgroundColor: c.brand, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: c.paper }}>
                <Icon name="camera" size={14} color="#fff" />
              </View>
            )}
            {seller?.liveNow && (
              <View style={{ position: "absolute", bottom: -6, alignSelf: "center", backgroundColor: c.live, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 2, borderColor: c.paper }}>
                <T size={11} weight="800" color="#fff">LIVE</T>
              </View>
            )}
          </Pressable>
          <View style={{ flex: 1, paddingBottom: 4, gap: 2 }}>
            <T size={21} weight="800" lines={1}>{p.displayName}</T>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <T size={13} color={c.muted} lines={1} style={{ flexShrink: 1 }}>@{p.handle}</T>
              {seller && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: c.ai, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Icon name="storefront" size={10} color="#fff" />
                  <T size={10} weight="800" color="#fff">SELLER</T>
                </View>
              )}
            </View>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 14 }}>
        <Pressable onPress={() => router.push(`/follows/${p.handle}?tab=followers`)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${p.followerCount} followers. See who`}>
          <T size={14}><T size={14} weight="800">{compact(p.followerCount)}</T> <T size={14} color={c.muted}>{p.followerCount === 1 ? "follower" : "followers"}</T></T>
        </Pressable>
        <Pressable onPress={() => router.push(`/follows/${p.handle}?tab=following`)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Following ${p.followingCount}. See who`}>
          <T size={14}><T size={14} weight="800">{compact(p.followingCount)}</T> <T size={14} color={c.muted}>following</T></T>
        </Pressable>
        {seller?.stats?.rating != null && (
          <T size={14}><Icon name="star" size={13} color={c.warn} /> <T size={14} weight="800">{seller.stats.rating.toFixed(1)}</T> <T size={14} color={c.muted}>({seller.stats.reviewCount})</T></T>
        )}
      </View>
      {p.bio ? <T size={14}>{p.bio}</T> : null}
      {seller?.storefront?.description && !p.bio ? <T size={14}>{seller.storefront.description}</T> : null}

      <ErrorNote error={err} />
      {p.blockedByMe && <T size={13} color={c.muted}>You blocked @{p.handle}. You won't see each other's shop, videos, comments or chat.</T>}

      {/* Actions. */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {p.isMe ? (
          <>
            <Pill icon="create-outline" label="Edit profile" onPress={() => router.push("/profile/edit")} tone="brand" grow />
            <Pill icon="settings-outline" label="" onPress={() => router.push("/account")} accessibilityLabel="Settings" />
          </>
        ) : (
          !p.blocked && <Pill icon={p.followedByMe ? "checkmark" : "add"} label={p.followedByMe ? "Following" : "Follow"} onPress={toggleFollow} tone={p.followedByMe ? "quiet" : "brand"} grow />
        )}
        <Pill icon="share-outline" label="Share" onPress={share} grow />
        {me && !p.isMe && <Pill icon="ellipsis-horizontal" label="" onPress={more} accessibilityLabel="More: report or block" />}
      </View>

      {seller?.liveNow && (
        <Pressable onPress={() => router.push(`/live/${seller.liveNow.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.live, borderRadius: 16, padding: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#ffffff33", alignItems: "center", justifyContent: "center" }}>
            <Icon name="radio" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <T size={12} weight="800" color="#fff">LIVE NOW</T>
            <T size={15} weight="700" color="#fff" lines={1}>{seller.liveNow.title}</T>
          </View>
          <T size={14} weight="800" color="#fff">Watch</T>
          <Icon name="chevron-forward" size={18} color="#fff" />
        </Pressable>
      )}

      {/* Shop numbers. Only real counts. */}
      {seller && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} style={{ marginHorizontal: -16 }}>
          <Stat icon="cube" value={compact(seller.stats.unitsSold)} label="Units sold" color={c.brandLight} />
          <Stat icon="star" value={seller.stats.rating != null ? seller.stats.rating.toFixed(1) : "New"} label={seller.stats.reviewCount ? `${seller.stats.reviewCount} reviews` : "No reviews yet"} color={c.warn} />
          <Stat icon="pricetags" value={compact(seller.stats.products)} label="Products" color={c.ai} />
          <Stat icon="people" value={compact(p.followerCount)} label="Followers" color={c.live} />
          <Stat icon="receipt" value={compact(seller.stats.orders)} label="Orders" color={c.ok} />
        </ScrollView>
      )}

      {seller?.upcoming?.length > 0 && (
        <View style={{ gap: 8 }}>
          <T size={17} weight="800">Upcoming shows</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {seller.upcoming.map((s: any) => (
              <Pressable key={s.id} onPress={() => router.push(`/live/${s.id}`)} style={{ width: 150, borderRadius: 14, overflow: "hidden", backgroundColor: c.card, borderWidth: 1, borderColor: c.line }}>
                <View style={{ height: 96, backgroundColor: c.line, alignItems: "center", justifyContent: "center" }}>
                  {s.coverUrl ? <Image source={{ uri: s.coverUrl }} style={{ width: "100%", height: "100%" }} /> : <Icon name="calendar" size={28} color={c.muted} />}
                </View>
                <View style={{ padding: 8, gap: 2 }}>
                  <T size={13} weight="700" lines={2}>{s.title}</T>
                  {s.scheduledFor && <T size={11} weight="600" color={c.brandLight}>{when(s.scheduledFor)}</T>}
                </View>
              </Pressable>
            ))}
          </ScrollView>
          {!p.isMe && !p.followedByMe && <T size={12} color={c.muted}>Follow to get a notification when the show starts.</T>}
        </View>
      )}

      {/* Tabs. */}
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.line }}>
        {tabs.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, alignItems: "center", paddingVertical: 10 }} accessibilityRole="tab" accessibilityState={{ selected: current === t }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Icon name={t === "shop" ? "storefront" : t === "videos" ? "play-circle" : "information-circle"} size={16} color={current === t ? c.ink : c.muted} />
              <T size={14} weight="700" color={current === t ? c.ink : c.muted}>
                {t === "shop" ? `Shop${seller?.stats?.products ? ` ${compact(seller.stats.products)}` : ""}` : t === "videos" ? "Videos" : "About"}
              </T>
            </View>
            <View style={{ position: "absolute", bottom: -1, height: 3, width: 44, borderRadius: 2, backgroundColor: current === t ? c.brand : "transparent" }} />
          </Pressable>
        ))}
      </View>

      {current === "shop" && <ShopTools shop={shop} />}
    </View>
  );

  const pad = 16;
  const shopTile = (width - pad * 2 - 10) / 2;
  const videoTile = (width - pad * 2 - 8) / 3;

  return (
    <>
      <Stack.Screen
        options={{
          title: p.isMe ? "Your profile" : seller?.storefront?.name ?? p.displayName,
          headerRight: () => (
            <Pressable onPress={() => router.push("/cart")} hitSlop={10} accessibilityLabel="Cart">
              <Icon name="cart-outline" size={24} color={c.ink} />
            </Pressable>
          ),
        }}
      />
      {current === "shop" ? (
        <FlatList
          key="shop"
          data={shop.items}
          keyExtractor={(x) => x.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ padding: pad, paddingTop: 0, gap: 10, paddingBottom: 40 }}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          onEndReached={shop.more}
          onEndReachedThreshold={0.6}
          ListEmptyComponent={
            shop.loading ? <ActivityIndicator color={c.brand} style={{ marginTop: 20 }} /> : <Empty title={shop.q ? `Nothing matches "${shop.q}"` : "No products yet"}>{shop.q ? "Try another word, like a color or size." : p.isMe ? "Products you list show up here." : "Check back soon."}</Empty>
          }
          ListFooterComponent={shop.loading && shop.items.length ? <ActivityIndicator color={c.brand} /> : undefined}
          renderItem={({ item }) => <ShopCard p={item} width={shopTile} onAdd={p.isMe ? undefined : () => addToCart(item)} onManage={p.isMe ? async () => { if (await manageListing(item)) shop.remove(item.id); } : undefined} />}
        />
      ) : current === "videos" ? (
        <FlatList
          key="videos"
          data={p.blocked ? [] : videos.data ?? []}
          keyExtractor={(v) => v.id}
          numColumns={3}
          columnWrapperStyle={{ gap: 4 }}
          contentContainerStyle={{ padding: pad, paddingTop: 0, gap: 4, paddingBottom: 40 }}
          ListHeaderComponent={header}
          ListEmptyComponent={videos.loading ? undefined : <Empty title="No videos yet" />}
          renderItem={({ item: v }) => (
            <Pressable onPress={() => router.push(`/video/${v.id}`)} style={{ width: videoTile, height: videoTile * 1.6, borderRadius: 8, overflow: "hidden", backgroundColor: c.line }}>
              {v.posterUrl && <Image source={{ uri: v.posterUrl }} style={{ width: "100%", height: "100%" }} />}
              <View style={{ position: "absolute", left: 6, bottom: 4, flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Icon name="play" size={11} color="#fff" />
                <T size={11} weight="700" color="#fff">{compact(v.viewCount)}</T>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: pad, paddingTop: 0, paddingBottom: 40 }}>
          {header}
          <About p={p} seller={seller} />
        </ScrollView>
      )}
      {toast && (
        <View pointerEvents="none" style={{ position: "absolute", bottom: 30, alignSelf: "center", backgroundColor: "rgba(11,19,28,0.95)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: c.line }}>
          <T size={13} weight="600" color="#fff">{toast}</T>
        </View>
      )}
    </>
  );
}

/** The seller's products, searchable and sortable, a page at a time. */
function useShop(handle: string, enabled: boolean) {
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const req = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      if (!enabled) return;
      const n = ++req.current;
      setLoading(true);
      try {
        const qs = new URLSearchParams({ sort, offset: String(offset), limit: "24", ...(q ? { q } : {}) }).toString();
        const r = await api<any>(`/users/${handle}/products?${qs}`);
        if (n !== req.current) return;
        setItems((cur) => (offset ? [...cur, ...r.products] : r.products));
        setTotal(r.total);
        setNext(r.next);
      } catch {
        /* keep what we have */
      } finally {
        if (n === req.current) setLoading(false);
      }
    },
    [handle, q, sort, enabled],
  );

  useEffect(() => {
    load(0);
  }, [load]);
  // Search as you type, after a short pause.
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 350);
    return () => clearTimeout(t);
  }, [typed]);

  // Drop a listing the seller just hid or deleted from their own shop.
  const remove = (id: string) => {
    setItems((cur) => cur.filter((x) => x.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  };
  return { q, typed, setTyped, sort, setSort, items, total, loading, remove, more: () => next != null && !loading && load(next) };
}

function ShopTools({ shop }: { shop: ReturnType<typeof useShop> }) {
  const c = useColors();
  const sorts: [Sort, string][] = [["new", "Newest"], ["price_low", "Price: low"], ["price_high", "Price: high"]];
  return (
    <View style={{ gap: 10, paddingBottom: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: c.brand, borderRadius: 14, paddingHorizontal: 12, backgroundColor: c.card }}>
        <Icon name="search" size={18} color={c.brandLight} />
        <TextInput
          value={shop.typed}
          onChangeText={shop.setTyped}
          placeholder="Search by name, color, size…"
          placeholderTextColor={c.muted}
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1, color: c.ink, fontSize: 15, paddingVertical: 11 }}
        />
        {!!shop.typed && (
          <Pressable onPress={() => shop.setTyped("")} hitSlop={10} accessibilityLabel="Clear search">
            <Icon name="close-circle" size={18} color={c.muted} />
          </Pressable>
        )}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {sorts.map(([k, label]) => (
          <Pressable key={k} onPress={() => shop.setSort(k)} style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: shop.sort === k ? c.ink : c.card, borderWidth: 1, borderColor: shop.sort === k ? c.ink : c.line }}>
            <T size={12} weight="700" color={shop.sort === k ? c.paper : c.ink}>{label}</T>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <T size={12} color={c.muted}>{shop.total} {shop.total === 1 ? "item" : "items"}</T>
      </View>
    </View>
  );
}

function ShopCard({ p, width, onAdd, onManage }: { p: any; width: number; onAdd?: () => void; onManage?: () => void }) {
  const c = useColors();
  const left = stock(p);
  const price = minPrice(p);
  return (
    <Pressable onPress={() => router.push(`/p/${p.id}`)} style={{ width, borderRadius: 16, overflow: "hidden", backgroundColor: c.card, borderWidth: 1, borderColor: c.line }}>
      <View style={{ width, height: width, backgroundColor: "#f4f7fa" }}>
        {p.media?.[0] && <Image source={{ uri: p.media[0].url }} style={{ width, height: width }} resizeMode="cover" />}
        {left === 0 && (
          <View style={{ position: "absolute", top: 8, left: 8, backgroundColor: "#000a", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
            <T size={11} weight="800" color="#fff">SOLD OUT</T>
          </View>
        )}
        {onManage && (
          <Pressable onPress={onManage} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Hide or delete ${p.title}`} style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: "#000000aa", alignItems: "center", justifyContent: "center" }}>
            <Icon name="ellipsis-horizontal" size={18} color="#fff" />
          </Pressable>
        )}
      </View>
      <View style={{ padding: 10, gap: 3 }}>
        <T size={13} weight="700" lines={2} style={{ minHeight: 34 }}>{p.title}</T>
        <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
          <View style={{ flex: 1, gap: 1 }}>
            <T size={15} weight="800" color={c.brandLight}>{price == null ? "" : formatMoney(price)}</T>
            {left > 0 && left <= 3 ? <T size={11} weight="700" color={c.warn}>Only {left} left</T> : <T size={11} color={c.muted}>{left === 0 ? "Sold out" : "In stock"}</T>}
          </View>
          {onAdd && (
            <Pressable onPress={onAdd} disabled={left === 0} hitSlop={6} accessibilityLabel={`Add ${p.title} to cart`} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: left === 0 ? c.line : c.brand, alignItems: "center", justifyContent: "center" }}>
              <Icon name="cart" size={17} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function About({ p, seller }: { p: any; seller: any }) {
  const c = useColors();
  const row = (icon: any, title: string, body?: string | null) =>
    body ? (
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Icon name={icon} size={18} color={c.brandLight} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={13} weight="700" color={c.muted}>{title}</T>
          <T size={14}>{body}</T>
        </View>
      </View>
    ) : null;
  return (
    <View style={{ gap: 16, paddingTop: 14 }}>
      {row("person", "Bio", p.bio)}
      {seller && row("storefront", "Shop", [seller.storefront?.name ?? seller.businessName, seller.storefront?.description].filter(Boolean).join("\n"))}
      {seller && row("cube", "Shipping", seller.storefront?.shippingPolicy ?? "The seller hasn't added a shipping policy yet.")}
      {seller && row("return-down-back", "Returns", seller.storefront?.returnPolicy ?? "The seller hasn't added a return policy yet.")}
      {row("calendar", "On Haven since", new Date(seller?.since ?? p.createdAt).toLocaleDateString([], { month: "long", year: "numeric" }))}
      {row("shield-checkmark", "Safe buying", seller ? "Every Haven seller is reviewed by our team before they can sell. Payments go through Haven, never straight to the seller." : null)}
    </View>
  );
}

function Pill({ icon, label, onPress, tone = "quiet", grow, accessibilityLabel }: { icon: any; label: string; onPress: () => void; tone?: "brand" | "quiet"; grow?: boolean; accessibilityLabel?: string }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({ flex: grow ? 1 : undefined, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 42, paddingHorizontal: 14, borderRadius: 12, backgroundColor: tone === "brand" ? c.brand : c.card, borderWidth: 1, borderColor: tone === "brand" ? c.brand : c.line, opacity: pressed ? 0.8 : 1 })}
    >
      <Icon name={icon} size={17} color={tone === "brand" ? "#fff" : c.ink} />
      {!!label && <T size={14} weight="700" color={tone === "brand" ? "#fff" : c.ink}>{label}</T>}
    </Pressable>
  );
}

function Stat({ icon, value, label, color }: { icon: any; value: string; label: string; color: string }) {
  const c = useColors();
  return (
    <View style={{ width: 104, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, padding: 10, gap: 4 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color + "26", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={15} color={color} />
      </View>
      <T size={18} weight="800">{value}</T>
      <T size={11} color={c.muted} lines={1}>{label}</T>
    </View>
  );
}
