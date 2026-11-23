import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useColors } from "@/components/ui";

const icon = (glyph: string) => ({ color }: { color: any }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.glint, tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line }, headerStyle: { backgroundColor: c.paper }, headerTintColor: c.ink, sceneStyle: { backgroundColor: c.paper } }}>
      <Tabs.Screen name="index" options={{ title: "Shop", tabBarIcon: icon("◎") }} />
      <Tabs.Screen name="live" options={{ title: "Live", tabBarIcon: icon("●") }} />
      <Tabs.Screen name="sell" options={{ title: "Sell", tabBarIcon: icon("＋") }} />
      <Tabs.Screen name="account" options={{ title: "Me", tabBarIcon: icon("☺") }} />
    </Tabs>
  );
}
