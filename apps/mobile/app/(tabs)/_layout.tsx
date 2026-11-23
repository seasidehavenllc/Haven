import { Tabs } from "expo-router";
import { Image, Text, View } from "react-native";
import { useColors } from "@/components/ui";

const BrandTitle = () => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Image source={require("../../assets/mark.png")} style={{ width: 26, height: 26 }} accessibilityLabel="Haven" />
    <Text style={{ color: "#f4f7fa", fontSize: 20, fontWeight: "800" }}>Haven</Text>
  </View>
);

const icon = (glyph: string) => ({ color }: { color: any }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.brand, tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line }, headerStyle: { backgroundColor: c.paper }, headerTintColor: c.ink, sceneStyle: { backgroundColor: c.paper } }}>
      <Tabs.Screen name="index" options={{ title: "Shop", headerTitle: () => <BrandTitle />, tabBarIcon: icon("◎") }} />
      <Tabs.Screen name="live" options={{ title: "Live", tabBarIcon: icon("●") }} />
      <Tabs.Screen name="sell" options={{ title: "Sell", tabBarIcon: icon("＋") }} />
      <Tabs.Screen name="account" options={{ title: "Me", tabBarIcon: icon("☺") }} />
    </Tabs>
  );
}
