import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { FeedVideo } from "@/components/FeedVideo";
import { VideoComments } from "@/components/VideoComments";
import { Empty, ErrorNote, Loading, T, useColors } from "@/components/ui";

export default function Videos() {
  const c = useColors();
  const { me } = useMe();
  const [tab, setTab] = useState<"foryou" | "following">("foryou");
  const [videos, setVideos] = useState<any[] | null>(null);
  const [next, setNext] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [comments, setComments] = useState<any>(null);

  const load = useCallback(
    async (cursor?: any) => {
      try {
        const qs = new URLSearchParams({ tab, ...(cursor ?? {}) }).toString();
        const r = await api(`/videos/feed?${qs}`);
        setVideos((cur) => (cursor ? [...(cur ?? []), ...r.videos] : r.videos));
        setNext(r.next);
        setErr(null);
      } catch (e) {
        setErr(e);
      }
    },
    [tab],
  );
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (!videos) load();
      return () => setFocused(false);
    }, [load, videos]),
  );
  const onViewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null; isViewable: boolean }[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActive(first.index);
  }).current;

  const switchTab = (t: typeof tab) => {
    if (t === tab) return;
    setTab(t);
    setVideos(null);
    setActive(0);
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <View style={{ position: "absolute", top: 10, left: 0, right: 0, zIndex: 10, flexDirection: "row", justifyContent: "center", gap: 18 }}>
        {(["foryou", "following"] as const).map((t) => (
          <Pressable key={t} onPress={() => switchTab(t)}>
            <T weight="700" color={tab === t ? "#fff" : "rgba(255,255,255,0.6)"}>{t === "foryou" ? "For you" : "Following"}</T>
          </Pressable>
        ))}
        {me && (
          <Pressable onPress={() => router.push("/video/new")} style={{ position: "absolute", right: 14 }}>
            <T weight="700" color="#fff">＋ Post</T>
          </Pressable>
        )}
      </View>
      {err && <View style={{ padding: 16, paddingTop: 50 }}><ErrorNote error={err} /></View>}
      {!videos || !height ? (
        <Loading />
      ) : !videos.length ? (
        <View style={{ padding: 16, paddingTop: 60, flex: 1, backgroundColor: c.paper }}>
          <Empty title={tab === "following" ? (me ? "Nothing from people you follow yet" : "Sign in to see who you follow") : "No videos yet"}>Sellers post short videos of new drops here.</Empty>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(v) => v.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
          onEndReached={() => {
            if (next) {
              const cur = next;
              setNext(null);
              load(cur);
            }
          }}
          onEndReachedThreshold={2}
          renderItem={({ item, index }) => <FeedVideo v={item} active={focused && index === active} height={height} muted={muted} onToggleMute={() => setMuted(!muted)} onComments={() => setComments(item)} />}
        />
      )}
      <VideoComments video={comments} onClose={() => setComments(null)} />
    </View>
  );
}
