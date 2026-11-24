"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { SafetyMenu } from "./Safety";
import { ErrorNote, Spinner } from "./ui";

export function VideoComments({ videoId, me, creatorId, onClose }: { videoId: string; me: string | null; creatorId: string; onClose?: () => void }) {
  const { data, loading, setData } = useApi<any[]>(`/videos/${videoId}/comments`);
  const blocked = useMe().me?.blockedUserIds ?? [];
  const [body, setBody] = useState("");
  const [err, setErr] = useState<any>(null);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line p-3">
        <b>Comments</b>
        {onClose && (
          <button onClick={onClose} className="text-muted" aria-label="Close comments">
            ✕
          </button>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {loading && <Spinner />}
        {data && !data.length && <p className="text-muted">No comments yet.</p>}
        {data?.filter((c) => !blocked.includes(c.user.id)).map((c) => (
          <div key={c.id} className="flex gap-2">
            <div className="flex-1">
              <b>@{c.user.handle}</b> {c.body}
            </div>
            {me && (me === c.user.id || me === creatorId) && (
              <button className="text-xs text-muted hover:text-live" onClick={() => api(`/videos/${videoId}/comments/${c.id}`, { method: "DELETE" }).then(() => setData(data.filter((x) => x.id !== c.id)))}>
                Remove
              </button>
            )}
            {me && me !== c.user.id && <SafetyMenu target="comment" targetId={c.id} what="this comment" handle={c.user.handle} />}
          </div>
        ))}
      </div>
      {me ? (
        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              const c = await api(`/videos/${videoId}/comments`, { body: { body } });
              setData([c, ...(data ?? [])]);
              setBody("");
            } catch (e) {
              setErr(e);
            }
          }}
        >
          <input className="input flex-1" placeholder="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} />
          <button className="btn-primary" disabled={!body.trim()}>
            Post
          </button>
        </form>
      ) : (
        <a href="/login?next=/videos" className="border-t border-line p-3 text-center text-sm underline">
          Sign in to comment
        </a>
      )}
      <ErrorNote error={err} />
    </div>
  );
}
