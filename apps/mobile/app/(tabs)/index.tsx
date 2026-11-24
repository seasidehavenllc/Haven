import { Link, router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, TextInput, useWindowDimensions, View } from "react-native";
import { useApi } from "@/lib/hooks";
import { Chip, Empty, ErrorNote, Icon, ModeBadge, ProductTile, T, s, useColors } from "@/components/ui";

export default function Shop() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const streams = useApi<any[]>("/streams");
  const products = useApi<{ items: any[] }>(`/products?pageSize=40${query ? `&q=${encodeURIComponent(query)}` : ""}`, [query]);
  const tile = (width - 16 * 2 - 12) / 2;
  const live = (streams.data ?? []).filter((x) => x.status === "LIVE");

  return (
    <FlatList
      data={products.data?.items ?? []}
      keyExtractor={(p) => p.id}
      numColumns={2}
      columnWrapperStyle={{ gap: 12 }}
      contentContainerStyle={[s.screen, { backgroundColor: c.paper }]}
      refreshControl={<RefreshControl tintColor={c.muted} refreshing={products.loading} onRefresh={() => (products.reload(), streams.reload())} />}
      ListHeaderComponent={
        <View style={{ gap: 14 }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.card }}>
              <Icon name="search" size={18} color={c.muted} />
              <TextInput
                placeholder="Search products"
                placeholderTextColor={c.muted}
                value={q}
                onChangeText={setQ}
                returnKeyType="search"
                onSubmitEditing={() => setQuery(q.trim())}
                clearButtonMode="while-editing"
                style={{ flex: 1, color: c.ink, fontSize: 16, paddingVertical: 10 }}
              />
            </View>
            <Pressable onPress={() => router.push("/cart")} accessibilityLabel="Cart" style={{ width: 46, height: 46, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, alignItems: "center", justifyContent: "center" }}>
              <Icon name="bag-handle-outline" size={22} color={c.ink} />
            </Pressable>
          </View>
          {!!live.length && (
            <View style={{ gap: 8 }}>
              <T size={20} weight="700">Live now</T>
              {live.slice(0, 3).map((st) => (
                <Link key={st.id} href={`/live/${st.id}`} asChild>
                  <Pressable style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Chip label="LIVE" color={c.live} />
                      <ModeBadge mode={st.mode} />
                    </View>
                    <T weight="600">{st.title}</T>
                    <T size={13} color={c.muted}>{st.seller.businessName}</T>
                  </Pressable>
                </Link>
              ))}
            </View>
          )}
          <T size={20} weight="700">{query ? `Results for “${query}”` : "New arrivals"}</T>
          <ErrorNote error={products.error} />
        </View>
      }
      ListEmptyComponent={products.loading ? undefined : <Empty title={query ? "Nothing matches that yet" : "No products yet"}>Real listings from sellers show up here.</Empty>}
      renderItem={({ item }) => <ProductTile p={item} width={tile} />}
    />
  );
}
