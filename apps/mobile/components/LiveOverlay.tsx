import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Animated, Easing, FlatList, Image, Pressable, View } from "react-native";
import { api } from "@/lib/api";
import { Countdown } from "./Countdown";
import { Avatar, Icon, T, minPrice, stock } from "./ui";
import { formatMoney } from "@haven/shared";

/** Text that stays readable over any camera picture. */
export const shadow = { textShadowColor: "rgba(0,0,0,0.75)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 };
export const glass = "rgba(0,0,0,0.42)";

// ───────────────────────── Floating hearts ─────────────────────────

const HEART_COLORS = ["#ff4d6d", "#ff8fab", "#5fd3e8", "#f5b84a", "#b388ff", "#3fd29a"];
const MAX_ON_SCREEN = 36;

export type HeartsHandle = { pop: (n?: number) => void };

/**
 * A column of hearts that float up and fade out. Call `pop()` for each tap (or for other viewers' taps).
 * It sits on top of the video and never takes touches.
 */
export const Hearts = forwardRef<HeartsHandle, { right?: number; bottom?: number }>(function Hearts({ right = 14, bottom = 150 }, ref) {
  const [hearts, setHearts] = useState<{ id: number; color: string; drift: number; size: number; v: Animated.Value }[]>([]);
  const next = useRef(0);

  const one = useCallback(() => {
    const id = next.current++;
    const v = new Animated.Value(0);
    const heart = { id, v, color: HEART_COLORS[id % HEART_COLORS.length]!, drift: (Math.random() - 0.5) * 70, size: 22 + Math.random() * 14 };
    setHearts((cur) => [...cur.slice(-(MAX_ON_SCREEN - 1)), heart]);
    Animated.timing(v, { toValue: 1, duration: 1700 + Math.random() * 700, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() =>
      setHearts((cur) => cur.filter((h) => h.id !== id)),
    );
  }, []);

  useImperativeHandle(ref, () => ({
    pop: (n = 1) => {
      for (let i = 0; i < Math.min(n, 8); i++) setTimeout(one, i * 110);
    },
  }));

  return (
    <View pointerEvents="none" style={{ position: "absolute", right, bottom, width: 90, height: 320 }}>
      {hearts.map((h) => (
        <Animated.View
          key={h.id}
          style={{
            position: "absolute",
            bottom: 0,
            right: 22,
            opacity: h.v.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 0.9, 0] }),
            transform: [
              { translateY: h.v.interpolate({ inputRange: [0, 1], outputRange: [0, -300] }) },
              { translateX: h.v.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [0, h.drift * 0.6, -h.drift * 0.3, h.drift] }) },
              { scale: h.v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.4, 1.15, 0.9] }) },
            ],
          }}
        >
          <Icon name="heart" size={h.size} color={h.color} />
        </Animated.View>
      ))}
    </View>
  );
});

/**
 * Taps on the heart: each shows a heart at once, and the taps go to the server in one small batch about once a second.
 * Returns `tap` and the running total to show (server total plus taps not sent yet).
 */
export function useLikes(streamId: string, serverTotal: number, enabled: boolean) {
  const pending = useRef(0);
  const [unsent, setUnsent] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const n = Math.min(pending.current, 50);
      if (!n) return;
      pending.current -= n;
      setUnsent(pending.current);
      api(`/streams/${streamId}/likes`, { body: { count: n } }).catch(() => {
        /* hearts are best effort */
      });
    }, 900);
    return () => clearInterval(t);
  }, [streamId]);
  const tap = useCallback(() => {
    if (!enabled) return;
    pending.current += 1;
    setUnsent(pending.current);
  }, [enabled]);
  return { tap, total: serverTotal + unsent };
}

export const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

// ───────────────────────── Chat over the video ─────────────────────────

export type ChatLine = { kind: "msg"; m: any } | { kind: "join"; id: string; userId: string; name: string };

const nameColor = (m: any, hostUserId?: string) => (m.isAi ? "#c9ccff" : m.userId && m.userId === hostUserId ? "#5fd3e8" : "#ffd6e0");
const nameOf = (m: any, hostUserId?: string) => (m.isAi ? "AI assistant" : m.userId && m.userId === hostUserId ? "Host" : m.user?.displayName ?? "viewer");

/**
 * Chat lines that float over the bottom of the video, newest at the bottom. Each line shows the person's photo and
 * name over their message. With `onReply`, each line gets a reply arrow (tapping the message replies too), and a
 * reply shows the message it answers above it.
 */
export function ChatOverlay({ lines, onLongPress, onReply, maxHeight = 260, hostUserId }: { lines: ChatLine[]; onLongPress?: (m: any) => void; onReply?: (m: any) => void; maxHeight?: number; hostUserId?: string }) {
  const list = useRef<FlatList>(null);
  return (
    <FlatList
      ref={list}
      style={{ maxHeight, flexGrow: 0 }}
      contentContainerStyle={{ gap: 6, paddingVertical: 4 }}
      data={lines}
      keyExtractor={(l) => (l.kind === "msg" ? l.m.id : l.id)}
      onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
      showsVerticalScrollIndicator={false}
      renderItem={({ item: l }) =>
        l.kind === "join" ? (
          <T size={12} color="#ffffffb3" style={[shadow, { marginLeft: 36 }]}>
            {l.name} joined
          </T>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Pressable
              delayLongPress={350}
              onPress={onReply && !l.m.isAi ? () => onReply(l.m) : undefined}
              onLongPress={onLongPress ? () => onLongPress(l.m) : undefined}
              accessibilityHint={onReply ? "Tap to reply, hold to report or block" : undefined}
              style={{ flexDirection: "row", gap: 8, flexShrink: 1 }}
            >
              {l.m.isAi ? (
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#6670f0", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="sparkles" size={14} color="#fff" />
                </View>
              ) : (
                <Avatar uri={l.m.user?.avatarUrl} name={l.m.user?.displayName ?? "?"} size={28} />
              )}
              <View style={{ flexShrink: 1 }}>
                {l.m.replyTo && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, opacity: 0.85 }}>
                    <Icon name="return-down-forward" size={11} color="#ffffffb3" />
                    <T size={11} color="#ffffffb3" lines={1} style={[shadow, { flexShrink: 1 }]}>
                      {nameOf(l.m.replyTo, hostUserId)}: {l.m.replyTo.body}
                    </T>
                  </View>
                )}
                <T size={13} weight="700" color={nameColor(l.m, hostUserId)} style={shadow} lines={1}>{nameOf(l.m, hostUserId)}</T>
                <T size={14} weight="600" color="#fff" style={shadow}>{l.m.body}</T>
              </View>
            </Pressable>
            {onReply && !l.m.isAi && (
              <Pressable onPress={() => onReply(l.m)} hitSlop={10} accessibilityLabel={`Reply to ${nameOf(l.m, hostUserId)}`} style={{ marginLeft: "auto", paddingTop: 8, paddingLeft: 4 }}>
                <Icon name="arrow-undo-outline" size={16} color="#ffffffcc" />
              </Pressable>
            )}
          </View>
        )
      }
    />
  );
}

/** "Replying to …" above the comment box, with an X to cancel. */
export function ReplyBar({ m, hostUserId, onCancel }: { m: any; hostUserId?: string; onCancel: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(11,19,28,0.92)", borderRadius: 12, paddingVertical: 7, paddingHorizontal: 10, borderLeftWidth: 3, borderLeftColor: "#5fd3e8" }}>
      <Icon name="arrow-undo" size={16} color="#5fd3e8" />
      <View style={{ flex: 1 }}>
        <T size={13} weight="700" color="#fff" lines={1}>Replying to {nameOf(m, hostUserId)}</T>
        <T size={12} color="#ffffffb3" lines={1}>{m.body}</T>
      </View>
      <Pressable onPress={onCancel} hitSlop={10} accessibilityLabel="Cancel reply">
        <Icon name="close" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

/**
 * A coloured tab stuck to the left or right edge of the show, with its label written up the side.
 * Used for quick actions (other lives, help, hide chat) so they stay out of the way of the video.
 */
export function SideTab({ label, color, side, onPress, textColor = "#fff", length = 92 }: { label: string; color: string; side: "left" | "right"; onPress: () => void; textColor?: string; length?: number }) {
  const W = 30;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 2, bottom: 2, left: 6, right: 6 }}
      style={({ pressed }) => ({
        width: W,
        height: length,
        backgroundColor: color,
        opacity: pressed ? 0.8 : 1,
        borderTopRightRadius: side === "left" ? 12 : 0,
        borderBottomRightRadius: side === "left" ? 12 : 0,
        borderTopLeftRadius: side === "right" ? 12 : 0,
        borderBottomLeftRadius: side === "right" ? 12 : 0,
        overflow: "hidden",
      })}
    >
      <View style={{ position: "absolute", width: length, height: W, left: (W - length) / 2, top: (length - W) / 2, alignItems: "center", justifyContent: "center", transform: [{ rotate: side === "left" ? "-90deg" : "90deg" }] }}>
        <T size={12} weight="800" color={textColor} style={{ letterSpacing: 1.5 }} lines={1}>{label.toUpperCase()}</T>
      </View>
    </Pressable>
  );
}

/** Append a chat event (new message, or a hidden one to remove) to the list. */
export function applyChat(cur: ChatLine[], m: any): ChatLine[] {
  if (m.hidden) return cur.filter((l) => !(l.kind === "msg" && l.m.id === m.id));
  if (cur.some((l) => l.kind === "msg" && l.m.id === m.id)) return cur;
  return [...cur.slice(-149), { kind: "msg", m }];
}

/** The comment the host pinned, shown at the top of the show. */
export function PinnedComment({ m, onClear }: { m: any; onClear?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(20,154,184,0.55)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 }}>
      <Icon name="pin" size={15} color="#fff" />
      <T size={13} color="#fff" lines={2} style={{ flex: 1 }}>
        <T size={13} weight="700" color="#fff">{m.isAi ? "AI assistant" : m.user?.displayName ?? "viewer"}  </T>
        {m.body}
      </T>
      {onClear && (
        <Pressable hitSlop={10} onPress={onClear} accessibilityLabel="Unpin comment">
          <Icon name="close" size={16} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

// ───────────────────────── Shopping over the video ─────────────────────────

/** Card for the product the host is showing right now, docked at the bottom of the show. Tap it for details. */
export function PinnedProductCard({ p, onBuy, onOpen }: { p: any; onBuy?: () => void; onOpen?: () => void }) {
  const left = stock(p);
  return (
    <Pressable onPress={onOpen} accessibilityLabel={`Showing now: ${p.title}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#f4f7fa", borderRadius: 16, padding: 7, ...cardShadow }}>
      <View style={{ width: 52, height: 52, borderRadius: 12, overflow: "hidden", backgroundColor: "#dfe6ec" }}>{p.media?.[0] && <Image source={{ uri: p.media[0].url }} style={{ width: 52, height: 52 }} />}</View>
      <View style={{ flex: 1 }}>
        <T size={11} weight="800" color="#149ab8">SHOWING NOW</T>
        <T size={14} weight="700" color="#03060a" lines={1}>{p.title}</T>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <T size={14} weight="800" color="#03060a">{minPrice(p) == null ? "" : formatMoney(minPrice(p)!)}</T>
          {left === 0 ? <T size={12} weight="600" color="#6b7785">Sold out</T> : left <= 3 ? <T size={12} weight="700" color="#e0365a">Only {left} left</T> : null}
        </View>
      </View>
      {onBuy && (
        <Pressable onPress={onBuy} disabled={left === 0} hitSlop={6} style={{ backgroundColor: left === 0 ? "#b8c2cc" : "#ff4d6d", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 }}>
          <T size={14} weight="800" color="#fff">{left === 0 ? "Sold out" : "Buy"}</T>
        </Pressable>
      )}
    </Pressable>
  );
}

const cardShadow = { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 };

/** The auction running in this show: price, time left, and a one-tap bid at the next allowed amount. */
export function AuctionCard({ a, product, skewMs, leading, onBid, busy }: { a: any; product?: any; skewMs?: number; leading?: boolean; onBid?: (cents: number) => void; busy?: boolean }) {
  const next = a.currentPriceCents == null ? a.startingPriceCents : a.currentPriceCents + a.minIncrementCents;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(11,19,28,0.82)", borderRadius: 14, padding: 8, borderWidth: 1, borderColor: "#f5b84a" }}>
      <View style={{ width: 46, height: 46, borderRadius: 10, overflow: "hidden", backgroundColor: "#1a2633", alignItems: "center", justifyContent: "center" }}>
        {product?.media?.[0] ? <Image source={{ uri: product.media[0].url }} style={{ width: 46, height: 46 }} /> : <Icon name="hammer" size={20} color="#f5b84a" />}
      </View>
      <View style={{ flex: 1 }}>
        <T size={12} weight="700" color="#f5b84a">AUCTION</T>
        <T size={13} weight="600" color="#fff" lines={1}>{product?.title ?? "Auction item"}</T>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <T size={13} weight="700" color="#fff">{formatMoney(a.currentPriceCents ?? a.startingPriceCents)}</T>
          <Countdown to={a.endsAt} skewMs={skewMs} size={12} color="#ffffffcc" />
        </View>
      </View>
      {leading ? (
        <View style={{ backgroundColor: "#3fd29a", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}>
          <T size={12} weight="700" color="#03060a">You lead</T>
        </View>
      ) : (
        onBid && (
          <Pressable onPress={() => onBid(next)} disabled={busy} style={{ backgroundColor: "#f5b84a", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, opacity: busy ? 0.6 : 1 }}>
            <T size={12} weight="700" color="#03060a">Bid {formatMoney(next)}</T>
          </Pressable>
        )
      )}
    </View>
  );
}

/** Round button on the right-hand rail of the show. */
export function RailButton({ icon, label, count, onPress, color = "#fff" }: { icon: any; label: string; count?: string; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={{ alignItems: "center", gap: 2 }}>
      <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: glass, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={24} color={color} />
      </View>
      {count != null && <T size={11} weight="700" color="#fff" style={shadow}>{count}</T>}
    </Pressable>
  );
}
