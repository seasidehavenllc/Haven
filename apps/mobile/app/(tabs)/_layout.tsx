import { Tabs } from "expo-router";
import { Image, Text, View } from "react-native";
import { Avatar, Icon, type IconName, useColors } from "@/components/ui";
import { Bell } from "@/components/Bell";
import { useMe } from "@/lib/hooks";

const BrandTitle = () => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Image source={require("../../assets/mark.png")} style={{ width: 26, height: 26 }} accessibilityLabel="Haven" />
    <Text style={{ color: "#f4f7fa", fontSize: 20, fontWeight: "800" }}>Haven</Text>
  </View>
);

/** Filled icon on the active tab, outline on the others. */
const icon =
  (name: IconName) =>
  ({ color, focused, size }: { color: any; focused: boolean; size: number }) => <Icon name={(focused ? name : `${name}-outline`) as IconName} size={size} color={color} />;

export default function TabsLayout() {
  const c = useColors();
  const { me } = useMe();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.brandLight,
        tabBarInactiveTintColor: c.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line },
        headerStyle: { backgroundColor: c.paper },
        headerShadowVisible: false,
        headerTintColor: c.ink,
        headerTitleStyle: { fontWeight: "700" },
        sceneStyle: { backgroundColor: c.paper },
        headerRight: () => <Bell />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Shop", headerTitle: () => <BrandTitle />, tabBarIcon: icon("storefront") }} />
      <Tabs.Screen name="videos" options={{ title: "Videos", headerShown: false, tabBarIcon: icon("play-circle") }} />
      <Tabs.Screen name="live" options={{ title: "Live", tabBarIcon: icon("radio") }} />
      <Tabs.Screen name="sell" options={{ title: "Sell", tabBarIcon: icon("add-circle") }} />
      <Tabs.Screen
        name="account"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused, size }) =>
            me ? (
              <View style={{ borderRadius: 999, borderWidth: 2, borderColor: focused ? c.brandLight : "transparent", padding: 1 }}>
                <Avatar uri={me.user.avatarUrl} name={me.user.displayName} size={size - 2} />
              </View>
            ) : (
              <Icon name={focused ? "person-circle" : "person-circle-outline"} size={size} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}
