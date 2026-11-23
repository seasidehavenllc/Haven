import { FlatList, RefreshControl } from "react-native";
import { useApi } from "@/lib/hooks";
import { AuctionRow } from "@/components/AuctionRow";
import { Empty, ErrorNote, s, useColors } from "@/components/ui";

export default function Auctions() {
  const c = useColors();
  const { data, loading, error, reload } = useApi<any[]>("/auctions");
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(x) => x.id}
      contentContainerStyle={s.screen}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={<ErrorNote error={error} />}
      ListEmptyComponent={loading ? undefined : <Empty title="No auctions right now">When sellers start an auction, it shows up here.</Empty>}
      renderItem={({ item: a }) => <AuctionRow a={a} c={c} />}
    />
  );
}
