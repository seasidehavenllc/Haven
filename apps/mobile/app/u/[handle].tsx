import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, Image, Pressable, View, useWindowDimensions } from "react-native";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { block, report } from "@/lib/safety";
import { Btn, Empty, ErrorNote, Icon, Loading, T, s, useColors } from "@/components/ui";

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export default function Profile() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { me, reload: reloadMe } = useMe();
  const profile = useApi<any>(`/users/${handle}`);
  const videos = useApi<any[]>(`/users/${handle}/videos`);
  const [err, setErr] = useState<any>(null);

  if (profile.loading) return <Loading />;
  if (profile.error || !profile.data) return <View style={s.screen}><ErrorNote error={profile.error} /></View>;
  const p = profile.data;
  const tile = (width - 32 - 8) / 3;

  async function toggleFollow() {
    if (!me) return router.push("/login");
    const next = !p.followedByMe;
    setErr(null);
    profile.setData((d: any) => ({ ...d, followedByMe: next, followerCount: d.followerCount + (next ? 1 : -1) }));
    try {
      await api(`/users/${p.id}/follow`, { method: next ? "POST" : "DELETE" });
    } catch (e) {
      setErr(e);
      profile.reload();
    }
  }

  const stat = (n: number, label: string) => (
    <View style={{ alignItems: "center", flex: 1 }}>
      <T size={18} weight="700">{compact(n)}</T>
      <T size={12} color={c.muted}>{label}</T>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: `@${p.handle}` }} />
      <FlatList
        data={videos.data ?? []}
        keyExtractor={(v) => v.id}
        numColumns={3}
        columnWrapperStyle={{ gap: 4 }}
        contentContainerStyle={[s.screen, { gap: 4 }]}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, overflow: "hidden", backgroundColor: c.line, alignItems: "center", justifyContent: "center" }}>
                {p.avatarUrl ? <Image source={{ uri: p.avatarUrl }} style={{ width: 64, height: 64 }} /> : <T size={26} weight="700" color={c.muted}>{p.displayName.slice(0, 1).toUpperCase()}</T>}
              </View>
              <View style={{ flex: 1 }}>
                <T size={20} weight="700">{p.displayName}</T>
                <T size={13} color={c.muted}>@{p.handle}</T>
              </View>
            </View>
            {p.bio ? <T size={14}>{p.bio}</T> : null}
            <View style={{ flexDirection: "row" }}>
              {stat(p.followerCount, p.followerCount === 1 ? "follower" : "followers")}
              {stat(p.followingCount, "following")}
              {stat(p.videoCount, p.videoCount === 1 ? "video" : "videos")}
            </View>
            <ErrorNote error={err} />
            {!p.isMe && !p.blocked && <Btn title={p.followedByMe ? "Following" : "Follow"} kind={p.followedByMe ? "ghost" : "primary"} onPress={toggleFollow} />}
            {p.blockedByMe && <T size={13} color={c.muted}>You blocked @{p.handle}. You won't see each other's videos, comments or chat.</T>}
            {me && !p.isMe && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Btn
                  kind="ghost"
                  style={{ flex: 1 }}
                  title={p.blockedByMe ? "Unblock" : "Block"}
                  onPress={async () => {
                    if (p.blockedByMe) {
                      await api(`/users/${p.handle}/block`, { method: "DELETE" }).catch(setErr);
                    } else if (!(await block(p.handle))) return;
                    await Promise.all([reloadMe(), profile.reload(), videos.reload()]);
                  }}
                />
                <Btn kind="ghost" style={{ flex: 1 }} title="Report" onPress={() => report("user", p.id, `@${p.handle}`)} />
              </View>
            )}
            {p.seller?.storefront && <T size={13} color={c.muted}>Runs the shop {p.seller.storefront.name}</T>}
          </View>
        }
        ListEmptyComponent={videos.loading ? undefined : <Empty title="No videos yet" />}
        renderItem={({ item: v }) => (
          <Pressable onPress={() => router.push(`/video/${v.id}`)} style={{ width: tile, height: tile * 1.6, borderRadius: 8, overflow: "hidden", backgroundColor: c.line }}>
            {v.posterUrl && <Image source={{ uri: v.posterUrl }} style={{ width: "100%", height: "100%" }} />}
            <View style={{ position: "absolute", left: 6, bottom: 4, flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Icon name="play" size={11} color="#fff" />
              <T size={11} weight="700" color="#fff">{compact(v.viewCount)}</T>
            </View>
          </Pressable>
        )}
      />
    </>
  );
}
