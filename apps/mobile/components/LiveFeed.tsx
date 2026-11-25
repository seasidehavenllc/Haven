import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { AuctionRow } from "./AuctionRow";
import { LiveCover, LiveShow, hostOf } from "./LiveShow";
import { Avatar, Empty, ErrorNote, Icon, Loading, T, useColors } from "./ui";

const isOn = (st: any) => st.status === "LIVE" || st.status === "PAUSED";

/**
 * Live shows as a vertical feed, like TikTok: swipe up for the next person selling live. Only the show on screen
 * joins its video and chat; the ones above and below show a cover until you land on them.
 *
 * `startId` opens on that show first (from a notification, a profile or a link). `standalone` adds a close button.
 */
export function LiveFeed({ startId, standalone }: { startId?: string; standalone?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { me } = useMe();
  const [rows, setRows] = useState<any[] | null>(null);
  const [auctions, setAuctions] = useState<any[]>([]);
  const [err, setErr] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [measured, setHeight] = useState(0);
  const window = useWindowDimensions();
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(true);
  const list = useRef<FlatList>(null);

  const load = useCallback(async () => {
    try {
      const [streams, au] = await Promise.all([api<any[]>("/streams"), api<any[]>("/auctions").catch(() => [])]);
      setRows(streams.filter((s) => !s.seller?.userId || !me?.blockedUserIds?.includes(s.seller.userId)));
      setAuctions(au);
      setErr(null);
    } catch (e) {
      setErr(e);
      setRows((cur) => cur ?? []);
    }
  }, [me?.blockedUserIds]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      load();
      return () => setFocused(false);
    }, [load]),
  );

  const onViewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null; isViewable: boolean }[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActive(first.index);
  }).current;

  // Each show fills the space this feed gets; until that's measured, assume the whole screen.
  const height = measured || window.height;
  if (!rows) return <View style={{ flex: 1, backgroundColor: "#000" }}><Loading /></View>;

  // The show you opened comes first (even if it hasn't started), then everyone live right now.
  const liveNow = rows.filter(isOn);
  const feed = startId ? [rows.find((r) => r.id === startId) ?? { id: startId, status: "UNKNOWN" }, ...liveNow.filter((r) => r.id !== startId)] : liveNow;

  if (!feed.length)
    return <NoOneLive rows={rows} auctions={auctions} err={err} refreshing={refreshing} onRefresh={async () => (setRefreshing(true), await load(), setRefreshing(false))} />;

  const jump = (id: string) => {
    const i = feed.findIndex((r) => r.id === id);
    if (i >= 0) list.current?.scrollToIndex({ index: i, animated: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FlatList
        ref={list}
        style={{ flex: 1 }}
        onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}
        data={feed}
        keyExtractor={(s) => s.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
        extraData={`${height}:${active}:${focused}`}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={async () => (setRefreshing(true), await load(), setRefreshing(false))} />}
        renderItem={({ item, index }) => (
          <View style={{ height }}>
            {focused && index === active ? <LiveShow id={item.id} standalone={standalone} others={rows} onJump={jump} /> : <LiveCover st={item} />}
          </View>
        )}
      />
      {active === 0 && feed.length > 1 && (
        <View pointerEvents="none" style={{ position: "absolute", top: "32%", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.42)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Icon name="chevron-up" size={13} color="#fff" />
          <T size={11} weight="700" color="#fff">Swipe up for {feed.length - 1} more live</T>
        </View>
      )}
    </View>
  );
}

/** When nobody is live: what's coming up, and auctions ending soon. */
function NoOneLive({ rows, auctions, err, refreshing, onRefresh }: { rows: any[]; auctions: any[]; err: any; refreshing: boolean; onRefresh: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const soon = auctions.filter((a) => a.status === "LIVE").slice(0, 3);
  const upcoming = rows.filter((r) => r.status === "SCHEDULED");
  return (
    <ScrollView style={{ backgroundColor: c.paper }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, gap: 14 }} refreshControl={<RefreshControl tintColor={c.muted} refreshing={refreshing} onRefresh={onRefresh} />}>
      <T size={24} weight="800">Live</T>
      <ErrorNote error={err} />
      <Empty title="No one is live right now">When sellers you follow go live, you'll get a notification. Pull down to check again.</Empty>
      {upcoming.length > 0 && <T size={17} weight="700">Coming up</T>}
      {upcoming.map((st) => {
        const h = hostOf(st);
        return (
          <Pressable key={st.id} onPress={() => router.push(`/live/${st.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, padding: 12 }}>
            <Avatar uri={h.avatarUrl} name={h.name} size={48} />
            <View style={{ flex: 1 }}>
              <T size={15} weight="700" lines={1}>{st.title}</T>
              <T size={13} color={c.muted} lines={1}>{h.name}</T>
              {st.scheduledFor && <T size={12} color={c.brandLight}>{new Date(st.scheduledFor).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</T>}
            </View>
            <Icon name="chevron-forward" size={18} color={c.muted} />
          </Pressable>
        );
      })}
      {soon.length > 0 && (
        <>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <T size={17} weight="700">Auctions ending soon</T>
            <Pressable onPress={() => router.push("/auctions")} hitSlop={10}>
              <T size={14} weight="600" color={c.brand}>See all</T>
            </Pressable>
          </View>
          {soon.map((a) => (
            <AuctionRow key={a.id} a={a} c={c} />
          ))}
        </>
      )}
    </ScrollView>
  );
}
