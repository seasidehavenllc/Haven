import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Share, Text, View } from "react-native";
import { api, API_URL } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { Icon, Money, minPrice } from "./ui";
import { block, choose, report } from "@/lib/safety";

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const W = { color: "#fff" } as const;

/** One full-screen video. Plays only while it's the active item; counts a view after 2 seconds on screen. */
export function FeedVideo({ v, active, height, muted, onToggleMute, onComments }: { v: any; active: boolean; height: number; muted: boolean; onToggleMute: () => void; onComments: () => void }) {
  const { me, reload } = useMe();
  const player = useVideoPlayer(v.mediaUrl, (p) => {
    p.loop = true;
  });
  const [liked, setLiked] = useState(v.likedByMe);
  const [likes, setLikes] = useState(v.likeCount);
  const [following, setFollowing] = useState(v.followingCreator);
  const [paused, setPaused] = useState(false);
  const viewed = useRef(false);

  useEffect(() => {
    player.muted = muted;
  }, [muted]);
  useEffect(() => {
    if (!active) {
      player.pause();
      return;
    }
    player.play();
    setPaused(false);
    const t = setTimeout(() => {
      if (!viewed.current) {
        viewed.current = true;
        api(`/videos/${v.id}/view`, { body: {} }).catch(() => {});
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [active]);

  async function like() {
    if (!me) return router.push("/login");
    const next = !liked;
    setLiked(next);
    setLikes((n: number) => n + (next ? 1 : -1));
    try {
      setLikes((await api(`/videos/${v.id}/like`, { method: next ? "POST" : "DELETE" })).likeCount);
    } catch {
      setLiked(!next);
      setLikes(v.likeCount);
    }
  }

  return (
    <View style={{ height, backgroundColor: "#000" }}>
      <Pressable
        style={{ flex: 1 }}
        onPress={() => {
          if (player.playing) player.pause();
          else player.play();
          setPaused(player.playing);
        }}
      >
        <VideoView player={player} style={{ flex: 1 }} contentFit="cover" nativeControls={false} />
        {paused && (
          <View pointerEvents="none" style={{ position: "absolute", alignSelf: "center", top: height / 2 - 36 }}>
            <Icon name="play" size={72} color="rgba(255,255,255,0.85)" />
          </View>
        )}
      </Pressable>
      <Pressable onPress={onToggleMute} style={{ position: "absolute", right: 12, top: 12, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 999, padding: 8 }} accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"}>
        <Icon name={muted ? "volume-mute" : "volume-high"} size={18} color="#fff" />
      </Pressable>

      <View style={{ position: "absolute", right: 10, bottom: 150, alignItems: "center", gap: 18 }}>
        <Pressable onPress={like} accessibilityLabel="Like" style={{ alignItems: "center" }}>
          <Icon name={liked ? "heart" : "heart-outline"} size={32} color={liked ? "#ff4d6d" : "#fff"} />
          <Text style={{ ...W, fontSize: 12 }}>{compact(likes)}</Text>
        </Pressable>
        <Pressable onPress={onComments} accessibilityLabel="Comments" style={{ alignItems: "center" }}>
          <Icon name="chatbubble-ellipses-outline" size={29} color="#fff" />
          <Text style={{ ...W, fontSize: 12 }}>{compact(v.commentCount)}</Text>
        </Pressable>
        <Pressable onPress={() => Share.share({ message: `${v.caption ? v.caption + " " : ""}${API_URL.replace(/:\d+$/, "")}/videos/${v.id}` }).catch(() => {})} accessibilityLabel="Share" style={{ alignItems: "center" }}>
          <Icon name="arrow-redo-outline" size={29} color="#fff" />
          <Text style={{ ...W, fontSize: 12 }}>Share</Text>
        </Pressable>
        {me && me.user.id !== v.creatorId && (
          <Pressable
            accessibilityLabel="More options"
            hitSlop={8}
            onPress={async () => {
              const i = await choose("Video", ["Report video", `Block @${v.creator.handle}`], 1);
              if (i === 0) await report("video", v.id, "this video");
              if (i === 1 && (await block(v.creator.handle))) await reload();
            }}
            style={{ alignItems: "center" }}
          >
            <Icon name="ellipsis-horizontal" size={26} color="#fff" />
          </Pressable>
        )}
        <Text style={{ ...W, fontSize: 11, opacity: 0.8 }}>{compact(v.viewCount)} {v.viewCount === 1 ? "view" : "views"}</Text>
      </View>

      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, paddingRight: 70, gap: 6, backgroundColor: "rgba(0,0,0,0.45)" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => router.push(`/u/${v.creator.handle}`)} hitSlop={8} accessibilityLabel={`Open @${v.creator.handle}'s profile`}>
            <Text style={{ ...W, fontWeight: "700" }}>@{v.creator.handle}</Text>
          </Pressable>
          {me && me.user.id !== v.creatorId && (
            <Pressable
              onPress={async () => {
                const next = !following;
                setFollowing(next);
                await api(`/users/${v.creatorId}/follow`, { method: next ? "POST" : "DELETE" }).catch(() => setFollowing(!next));
              }}
              style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.6)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}
            >
              <Text style={{ ...W, fontSize: 12 }}>{following ? "Following" : "Follow"}</Text>
            </Pressable>
          )}
        </View>
        {!!v.caption && <Text style={W} numberOfLines={3}>{v.caption}</Text>}
        {!!v.products.length && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginRight: -56 }}>
            {v.products.map((p: any) => (
              <Pressable key={p.id} onPress={() => router.push(`/p/${p.id}`)} style={{ width: 210, flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 14, padding: 6 }}>
                <View style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", backgroundColor: "#ddd" }}>{p.media[0] && <Image source={{ uri: p.media[0].url }} style={{ width: 40, height: 40 }} />}</View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "700" }}>{p.title}</Text>
                  <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                    <Money cents={minPrice(p)} size={12} weight="500" />
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#149ab8" }}>· Shop</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
