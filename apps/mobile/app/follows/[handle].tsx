import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { Avatar, Empty, ErrorNote, Icon, T, useColors } from "@/components/ui";

type Kind = "followers" | "following";
type Person = { id: string; handle: string; displayName: string; avatarUrl: string | null; bio: string | null; isSeller: boolean; followedByMe: boolean; isMe: boolean };

/** Who follows someone and who they follow. Tap a person to open their profile, or follow them right here. */
export default function Follows() {
  const params = useLocalSearchParams<{ handle: string; tab?: Kind }>();
  const c = useColors();
  const { me } = useMe();
  const [kind, setKind] = useState<Kind>(params.tab === "following" ? "following" : "followers");
  const [rows, setRows] = useState<Person[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<any>(null);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      try {
        const r = await api<{ users: Person[]; total: number; next: number | null }>(`/users/${params.handle}/${kind}?offset=${offset}&limit=50`);
        setRows((x) => (replace ? r.users : [...x, ...r.users]));
        setTotal(r.total);
        setNext(r.next);
        setErr(null);
      } catch (e) {
        setErr(e);
      } finally {
        setLoading(false);
      }
    },
    [params.handle, kind],
  );
  useEffect(() => {
    setRows([]);
    setTotal(null);
    load(0, true);
  }, [load]);

  async function toggle(p: Person) {
    if (!me) return router.push("/login");
    const on = !p.followedByMe;
    setRows((x) => x.map((r) => (r.id === p.id ? { ...r, followedByMe: on } : r)));
    try {
      await api(`/users/${p.id}/follow`, { method: on ? "POST" : "DELETE" });
    } catch (e) {
      setRows((x) => x.map((r) => (r.id === p.id ? { ...r, followedByMe: !on } : r)));
      setErr(e);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen options={{ title: `@${params.handle}` }} />
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: c.line }}>
        {(["followers", "following"] as const).map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="tab" accessibilityState={{ selected: kind === k }} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2, borderColor: kind === k ? c.brand : "transparent" }}>
            <T size={15} weight="700" color={kind === k ? c.ink : c.muted}>
              {k === "followers" ? "Followers" : "Following"}
              {kind === k && total != null ? ` · ${total}` : ""}
            </T>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, gap: 4, flexGrow: 1 }}
        onEndReached={() => next != null && next > 0 && !loading && load(next, false)}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={err ? <ErrorNote error={err} /> : undefined}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={c.brand} style={{ marginTop: 30 }} />
          ) : (
            <Empty title={kind === "followers" ? "No followers yet" : "Not following anyone yet"}>
              {kind === "followers" ? "People who follow this account show up here." : "Accounts this person follows show up here."}
            </Empty>
          )
        }
        ListFooterComponent={loading && rows.length > 0 ? <ActivityIndicator color={c.brand} style={{ marginVertical: 16 }} /> : undefined}
        renderItem={({ item: p }) => (
          <Pressable
            onPress={() => router.push(`/u/${p.handle}`)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${p.displayName}'s profile`}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}
          >
            <Avatar uri={p.avatarUrl} name={p.displayName} size={48} />
            <View style={{ flex: 1, gap: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <T size={15} weight="700" lines={1} style={{ flexShrink: 1 }}>{p.displayName}</T>
                {p.isSeller && <Icon name="storefront" size={13} color={c.ai} />}
              </View>
              <T size={13} color={c.muted} lines={1}>@{p.handle}</T>
              {!!p.bio && <T size={12} color={c.muted} lines={1}>{p.bio}</T>}
            </View>
            {!p.isMe && (
              <Pressable
                onPress={() => toggle(p)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={p.followedByMe ? `Unfollow ${p.displayName}` : `Follow ${p.displayName}`}
                style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: p.followedByMe ? c.line : c.brand, backgroundColor: p.followedByMe ? "transparent" : c.brand, opacity: pressed ? 0.8 : 1 })}
              >
                <T size={13} weight="700" color={p.followedByMe ? c.ink : "#fff"}>{p.followedByMe ? "Following" : "Follow"}</T>
              </Pressable>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}
