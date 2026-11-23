import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Share, Text, View } from "react-native";
import { api, API_URL } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { Money, minPrice } from "./ui";

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const W = { color: "#fff" } as const;

/** One full-screen video. Plays only while it's the active item; counts a view after 2 seconds on screen. */
export function FeedVideo({ v, active, height, muted, onToggleMute, onComments }: { v: any; active: boolean; height: number; muted: boolean; onToggleMute: () => void; onComments: () => void }) {
  const { me } = useMe();
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
    if (!me) return router.push("/account");
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
        {paused && <Text style={{ position: "absolute", alignSelf: "center", top: height / 2 - 30, fontSize: 56, color: "rgba(255,255,255,0.8)" }}>▶</Text>}
      </Pressable>
      <Pressable onPress={onToggleMute} style={{ position: "absolute", right: 12, top: 12, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Text style={{ ...W, fontSize: 12 }}>{muted ? "🔇 Sound off" : "🔊"}</Text>
      </Pressable>

      <View style={{ position: "absolute", right: 10, bottom: 150, alignItems: "center", gap: 18 }}>
        <Pressable onPress={like} accessibilityLabel="Like" style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 30, color: liked ? "#ff4d6d" : "#fff" }}>{liked ? "♥" : "♡"}</Text>
          <Text style={{ ...W, fontSize: 12 }}>{compact(likes)}</Text>
        </Pressable>
        <Pressable onPress={onComments} accessibilityLabel="Comments" style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 24 }}>💬</Text>
          <Text style={{ ...W, fontSize: 12 }}>{compact(v.commentCount)}</Text>
        </Pressable>
        <Pressable onPress={() => Share.share({ message: `${v.caption ? v.caption + " " : ""}${API_URL.replace(/:\d+$/, "")}/videos/${v.id}` }).catch(() => {})} accessibilityLabel="Share" style={{ alignItems: "center" }}>
          <Text style={{ ...W, fontSize: 24 }}>↗</Text>
          <Text style={{ ...W, fontSize: 12 }}>Share</Text>
        </Pressable>
        <Text style={{ ...W, fontSize: 11, opacity: 0.8 }}>{compact(v.viewCount)} {v.viewCount === 1 ? "view" : "views"}</Text>
      </View>

      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, paddingRight: 70, gap: 6, backgroundColor: "rgba(0,0,0,0.45)" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ ...W, fontWeight: "700" }}>@{v.creator.handle}</Text>
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
