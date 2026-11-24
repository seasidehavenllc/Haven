import { Link } from "expo-router";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { AuctionRow } from "@/components/AuctionRow";
import { useApi } from "@/lib/hooks";
import { Chip, Empty, ErrorNote, ModeBadge, T, s, useColors } from "@/components/ui";

export default function Live() {
  const c = useColors();
  const { data, loading, error, reload: reloadStreams } = useApi<any[]>("/streams");
  const auctions = useApi<any[]>("/auctions");
  const reload = () => (reloadStreams(), auctions.reload());
  const soon = (auctions.data ?? []).filter((a) => a.status === "LIVE").slice(0, 3);
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(x) => x.id}
      contentContainerStyle={s.screen}
      refreshControl={<RefreshControl tintColor={c.muted} refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <ErrorNote error={error} />
          {soon.length > 0 && (
            <>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <T size={17} weight="700">Auctions ending soon</T>
                <Link href="/auctions" asChild>
                  <Pressable hitSlop={10}>
                    <T size={14} weight="600" color={c.brand}>See all</T>
                  </Pressable>
                </Link>
              </View>
              {soon.map((a) => (
                <AuctionRow key={a.id} a={a} c={c} />
              ))}
              <T size={17} weight="700">Shows</T>
            </>
          )}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty title="No shows right now">When sellers go live or schedule a show, it appears here.</Empty>}
      renderItem={({ item: st }) => (
        <Link href={`/live/${st.id}`} asChild>
          <Pressable style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {st.status === "LIVE" ? <Chip label="LIVE" color={c.live} /> : <Chip label={st.status === "PAUSED" ? "Paused" : "Scheduled"} color={c.line} text={c.ink} />}
              <ModeBadge mode={st.mode} />
            </View>
            <T size={17} weight="600">{st.title}</T>
            <T size={13} color={c.muted}>
              {st.seller.businessName}
              {st.status === "SCHEDULED" && st.scheduledFor ? ` · ${new Date(st.scheduledFor).toLocaleString()}` : ""}
              {st._count?.products != null ? ` · ${st._count.products} items` : ""}
            </T>
          </Pressable>
        </Link>
      )}
    />
  );
}
