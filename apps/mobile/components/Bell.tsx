import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useMe, useRealtime } from "@/lib/hooks";
import { useColors } from "./ui";

/** Header bell with the unread count; refreshes on screen changes and on live `notification:new` events. */
export function Bell() {
  const c = useColors();
  const { me } = useMe();
  const path = usePathname();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (me) api<{ count: number }>("/notifications/unread-count").then((r) => setCount(r.count)).catch(() => {});
    else setCount(0);
  }, [me?.user.id, path]);
  useRealtime(null, { "notification:new": () => setCount((n) => n + 1) });
  if (!me) return null;
  return (
    <Pressable onPress={() => router.push("/notifications")} accessibilityLabel={count ? `Notifications, ${count} unread` : "Notifications"} hitSlop={10} style={{ marginRight: 14 }}>
      <Text style={{ color: c.ink, fontSize: 20 }}>🔔</Text>
      {count > 0 && (
        <View style={{ position: "absolute", top: -4, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.live, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{count > 99 ? "99+" : count}</Text>
        </View>
      )}
    </Pressable>
  );
}
