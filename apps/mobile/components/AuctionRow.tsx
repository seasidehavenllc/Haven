import { Link } from "expo-router";
import { Image, Pressable, View } from "react-native";
import { Countdown } from "./Countdown";
import { Chip, Money, T, s, useColors } from "./ui";

export function AuctionRow({ a, c }: { a: any; c: ReturnType<typeof useColors> }) {
  return (
    <Link href={`/auctions/${a.id}`} asChild>
      <Pressable style={[s.card, { borderColor: c.line, backgroundColor: c.card, flexDirection: "row", alignItems: "center" }]}>
        <View style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", backgroundColor: c.line }}>
          {a.product.media[0] && <Image source={{ uri: a.product.media[0].url }} style={{ width: 64, height: 64 }} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T size={15} weight="600" lines={2}>{a.product.title}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Money cents={a.currentPriceCents ?? a.startingPriceCents} size={15} />
            <T size={12} color={c.muted}>{a._count?.bids ? `${a._count.bids} bid${a._count.bids === 1 ? "" : "s"}` : "starting bid"}</T>
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {a.status === "LIVE" ? <Chip label="LIVE" color={c.live} /> : <Chip label="Soon" color={c.line} text={c.ink} />}
          <Countdown to={a.status === "LIVE" ? a.endsAt : a.startsAt} size={13} />
        </View>
      </Pressable>
    </Link>
  );
}
