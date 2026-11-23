import { formatMoney } from "@glint/shared";
import { Link } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, useColorScheme, type TextInputProps, type ViewStyle } from "react-native";

export const palette = {
  light: { ink: "#14121a", paper: "#faf8f5", card: "#ffffff", muted: "#6b6776", line: "#e7e2dc", glint: "#ff5a36", ai: "#6d4aff", live: "#e0245e", ok: "#108a5b", warn: "#b26a00" },
  dark: { ink: "#f4f1ec", paper: "#0f0e13", card: "#1a1820", muted: "#9b97a6", line: "#2c2934", glint: "#ff6b4a", ai: "#8f74ff", live: "#ff4f84", ok: "#3cc48b", warn: "#f0a63a" },
};
export const useColors = () => palette[useColorScheme() === "dark" ? "dark" : "light"];

export function T({ children, style, size = 15, weight, color, lines }: { children: ReactNode; style?: any; size?: number; weight?: "400" | "500" | "600" | "700" | "800"; color?: string; lines?: number }) {
  const c = useColors();
  return (
    <Text numberOfLines={lines} style={[{ color: color ?? c.ink, fontSize: size, fontWeight: weight }, style]}>
      {children}
    </Text>
  );
}

export function Btn({ title, onPress, kind = "primary", disabled, busy, style }: { title: string; onPress?: () => void; kind?: "primary" | "ghost" | "ai" | "danger"; disabled?: boolean; busy?: boolean; style?: ViewStyle }) {
  const c = useColors();
  const bg = kind === "primary" ? c.glint : kind === "ai" ? c.ai : kind === "danger" ? c.live : "transparent";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: kind === "ghost" ? c.line : bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={kind === "ghost" ? c.ink : "#fff"} /> : <T weight="600" color={kind === "ghost" ? c.ink : "#fff"}>{title}</T>}
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

export function ErrorNote({ error }: { error: any }) {
  const c = useColors();
  if (!error) return null;
  const env: string[] | undefined = error.details?.requiredEnv;
  return (
    <View style={[s.note, { backgroundColor: c.live + "18" }]}>
      <T size={13} color={c.live}>{error.message ?? String(error)}</T>
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
      <ActivityIndicator color={c.glint} />
    </View>
  );
}

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => {
  const c = useColors();
  return (
    <View style={[s.empty, { borderColor: c.line }]}>
      <T weight="600">{title}</T>
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
  empty: { borderWidth: 1, borderStyle: "dashed", borderRadius: 16, padding: 24, alignItems: "center", gap: 6 },
  thumb: { borderRadius: 14, overflow: "hidden" },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  screen: { padding: 16, gap: 14 },
});
