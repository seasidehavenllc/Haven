import { formatMoney } from "@haven/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Link } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, useColorScheme, type TextInputProps, type ViewStyle } from "react-native";

// Seaside Haven palette (seasidehavenllc.com), dark by design to match the brand site.
const haven = { ink: "#f4f7fa", paper: "#03060a", card: "#0b131c", muted: "#9aa9b7", line: "#1a2633", brand: "#149ab8", brandLight: "#5fd3e8", ai: "#6670f0", live: "#ff4d6d", ok: "#3fd29a", warn: "#f5b84a" };
export const palette = { light: haven, dark: haven };
export const useColors = () => palette[useColorScheme() === "dark" ? "dark" : "light"];

export type IconName = keyof typeof Ionicons.glyphMap;
/** One icon set (Ionicons) everywhere, so nothing falls back to emoji. */
export const Icon = ({ name, size = 22, color }: { name: IconName; size?: number; color?: any }) => <Ionicons name={name} size={size} color={color ?? palette.dark.ink} />;

/** A person's photo, or their initials on the brand colour when they have none. */
export function Avatar({ uri, name, size = 40 }: { uri?: string | null; name?: string | null; size?: number }) {
  const c = useColors();
  const initials = (name ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.line }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.brand, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.4 }}>{initials}</Text>
    </View>
  );
}

/** A tappable settings-style row with an icon and a chevron. */
export function Row({ icon, label, onPress, tone }: { icon: IconName; label: string; onPress: () => void; tone?: "danger" }) {
  const c = useColors();
  const color = tone === "danger" ? c.live : c.ink;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 14, opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={20} color={tone === "danger" ? c.live : c.muted} />
      <T style={{ flex: 1 }} color={color}>{label}</T>
      <Icon name="chevron-forward" size={18} color={c.muted} />
    </Pressable>
  );
}

export function T({ children, style, size = 15, weight, color, lines, onPress }: { children: ReactNode; style?: any; size?: number; weight?: "400" | "500" | "600" | "700" | "800"; color?: string; lines?: number; onPress?: () => void }) {
  const c = useColors();
  return (
    <Text numberOfLines={lines} onPress={onPress} suppressHighlighting style={[{ color: color ?? c.ink, fontSize: size, fontWeight: weight }, style]}>
      {children}
    </Text>
  );
}

export function Btn({ title, onPress, kind = "primary", disabled, busy, style, icon }: { title: string; onPress?: () => void; kind?: "primary" | "ghost" | "ai" | "danger"; disabled?: boolean; busy?: boolean; style?: ViewStyle; icon?: IconName }) {
  const c = useColors();
  const bg = kind === "primary" ? c.brand : kind === "ai" ? c.ai : kind === "danger" ? c.live : "transparent";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: kind === "ghost" ? c.line : bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? (
        <ActivityIndicator color={kind === "ghost" ? c.ink : "#fff"} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {icon && <Icon name={icon} size={18} color={kind === "ghost" ? c.ink : "#fff"} />}
          <T weight="600" color={kind === "ghost" ? c.ink : "#fff"}>{title}</T>
        </View>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      {props.label && <T size={12} weight="600" color={c.muted}>{props.label.toUpperCase()}</T>}
      <TextInput placeholderTextColor={c.muted} {...props} style={[s.input, { borderColor: c.line, color: c.ink, backgroundColor: c.card }, props.style]} />
    </View>
  );
}

export const Money = ({ cents, size, weight = "700" }: { cents: number | null | undefined; size?: number; weight?: any }) => <T size={size} weight={weight}>{cents == null ? "—" : formatMoney(cents)}</T>;

/** Network failures read as "Failed to fetch" or "Network request failed"; say what that means instead. */
export const friendlyError = (error: any) => {
  const m: string = error?.message ?? String(error);
  return /failed to fetch|network request failed|load failed/i.test(m) ? "Can't reach Haven right now. Check your connection, then pull down to try again." : m;
};

export function ErrorNote({ error }: { error: any }) {
  const c = useColors();
  if (!error) return null;
  const env: string[] | undefined = error.details?.requiredEnv;
  return (
    <View style={[s.note, { backgroundColor: c.live + "18" }]}>
      <T size={13} color={c.live}>{friendlyError(error)}</T>
      {env && <T size={12} color={c.muted}>Needs on the server: {env.join(", ")}</T>}
    </View>
  );
}

export function Notice({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "ai" | "ok" }) {
  const c = useColors();
  return (
    <View style={[s.note, { backgroundColor: c[tone] + "1c" }]}>
      <T size={13} color={c[tone]}>{children}</T>
    </View>
  );
}

export function Loading() {
  const c = useColors();
  return (
    <View style={{ flex: 1, padding: 40, alignItems: "center", backgroundColor: c.paper }}>
      <ActivityIndicator color={c.brand} />
    </View>
  );
}

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => {
  const c = useColors();
  return (
    <View style={[s.empty, { borderColor: c.line, backgroundColor: c.card }]}>
      <T weight="700" size={16}>{title}</T>
      {children && <T size={13} color={c.muted} style={{ textAlign: "center" }}>{children}</T>}
    </View>
  );
};

export const minPrice = (p: any) => (p.variants?.length ? Math.min(...p.variants.map((v: any) => v.priceCents)) : null);
export const stock = (p: any) => (p.variants ?? []).reduce((n: number, v: any) => n + v.quantity, 0);

export function ProductTile({ p, width }: { p: any; width: number }) {
  const c = useColors();
  const left = stock(p);
  return (
    <Link href={`/p/${p.id}`} asChild>
      <Pressable style={{ width }}>
        <View style={[s.thumb, { width, height: width, backgroundColor: c.line }]}>{p.media?.[0] && <Image source={{ uri: p.media[0].url }} style={{ width, height: width }} />}</View>
        <T size={13} lines={1} style={{ marginTop: 6 }}>{p.title}</T>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Money cents={minPrice(p)} size={14} />
          {left === 0 ? <T size={12} color={c.muted}>Sold out</T> : left <= 3 ? <T size={12} color={c.live}>{left} left</T> : null}
        </View>
      </Pressable>
    </Link>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  const c = useColors();
  const label = mode === "AI_HOST" ? "AI host" : mode === "HUMAN_AI_COHOST" ? "Human + AI" : "Human host";
  return (
    <View style={[s.chip, { backgroundColor: mode === "HUMAN" ? c.line : c.ai }]}>
      <T size={11} weight="700" color={mode === "HUMAN" ? c.ink : "#fff"}>{label}</T>
    </View>
  );
}

export function Chip({ label, color, text = "#fff" }: { label: string; color: string; text?: string }) {
  return (
    <View style={[s.chip, { backgroundColor: color }]}>
      <T size={11} weight="700" color={text}>{label}</T>
    </View>
  );
}

export const s = StyleSheet.create({
  btn: { minHeight: 46, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
  note: { padding: 12, borderRadius: 12, gap: 4 },
  empty: { borderWidth: 1, borderRadius: 18, paddingVertical: 32, paddingHorizontal: 24, alignItems: "center", gap: 8 },
  thumb: { borderRadius: 14, overflow: "hidden" },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  screen: { padding: 16, gap: 14 },
});
