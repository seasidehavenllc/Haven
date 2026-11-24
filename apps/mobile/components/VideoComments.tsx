import { useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { Btn, ErrorNote, Field, T, useColors } from "./ui";
import { block, choose, report } from "@/lib/safety";

export function VideoComments({ video, onClose }: { video: { id: string; creatorId: string } | null; onClose: () => void }) {
  return (
    <Modal visible={!!video} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      {video && <Sheet video={video} onClose={onClose} />}
    </Modal>
  );
}

function Sheet({ video, onClose }: { video: { id: string; creatorId: string }; onClose: () => void }) {
  const c = useColors();
  const { me, reload } = useMe();
  const { data, setData } = useApi<any[]>(`/videos/${video.id}/comments`);
  const shown = (data ?? []).filter((x) => !me?.blockedUserIds?.includes(x.user.id));
  const [body, setBody] = useState("");
  const [err, setErr] = useState<any>(null);
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ height: "62%", backgroundColor: c.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <T weight="700">Comments</T>
        <Pressable onPress={onClose} hitSlop={10}>
          <T color={c.muted}>✕</T>
        </Pressable>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={<T color={c.muted}>{data ? "No comments yet." : "Loading…"}</T>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row", gap: 8, paddingVertical: 6 }}>
            <T size={14} style={{ flex: 1 }}>
              <T size={14} weight="700">@{item.user.handle} </T>
              {item.body}
            </T>
            {me && (me.user.id === item.user.id || me.user.id === video.creatorId) && (
              <Pressable onPress={() => api(`/videos/${video.id}/comments/${item.id}`, { method: "DELETE" }).then(() => setData((d) => (d ?? []).filter((x) => x.id !== item.id)))}>
                <T size={12} color={c.muted}>Remove</T>
              </Pressable>
            )}
            {me && me.user.id !== item.user.id && (
              <Pressable
                hitSlop={8}
                accessibilityLabel={`More options for @${item.user.handle}'s comment`}
                onPress={async () => {
                  const i = await choose(`@${item.user.handle}'s comment`, ["Report comment", `Block @${item.user.handle}`], 1);
                  if (i === 0) await report("comment", item.id, "this comment");
                  if (i === 1 && (await block(item.user.handle))) await reload();
                }}
              >
                <T size={12} color={c.muted}>•••</T>
              </Pressable>
            )}
          </View>
        )}
      />
      <ErrorNote error={err} />
      {me ? (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Field placeholder="Add a comment" value={body} onChangeText={setBody} maxLength={300} />
          </View>
          <Btn
            title="Post"
            disabled={!body.trim()}
            onPress={async () => {
              setErr(null);
              try {
                const cm = await api(`/videos/${video.id}/comments`, { body: { body } });
                setData((d) => [cm, ...(d ?? [])]);
                setBody("");
              } catch (e) {
                setErr(e);
              }
            }}
          />
        </View>
      ) : (
        <T color={c.muted}>Sign in on the Me tab to comment.</T>
      )}
    </KeyboardAvoidingView>
  );
}
