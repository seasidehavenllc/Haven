"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { Empty, ErrorNote, Loading } from "@/components/ui";
import { VideoCard, type Video } from "@/components/VideoCard";
import { VideoComments } from "@/components/VideoComments";

export default function Videos() {
  const { me, ready } = useMe();
  const [tab, setTab] = useState<"foryou" | "following">("foryou");
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [next, setNext] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [muted, setMuted] = useState(true);
  const [comments, setComments] = useState<Video | null>(null);

  const load = useCallback(
    async (cursor?: any) => {
      try {
        const qs = new URLSearchParams({ tab, ...(cursor ?? {}) });
        const r = await api<{ videos: Video[]; next: any }>(`/videos/feed?${qs}`);
        setVideos((cur) => (cursor ? [...(cur ?? []), ...r.videos] : r.videos));
        setNext(r.next);
      } catch (e) {
        setErr(e);
      }
    },
    [tab],
  );
  useEffect(() => {
    if (!ready) return;
    setVideos(null);
    load();
  }, [load, ready, me?.user.id]);

  return (
    <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-3 flex items-center gap-2">
          {(["foryou", "following"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={tab === t ? "btn-primary px-4 py-1.5" : "btn-ghost px-4 py-1.5"}>
              {t === "foryou" ? "For you" : "Following"}
            </button>
          ))}
          {me && (
            <Link href="/videos/new" className="btn-ghost ml-auto px-4 py-1.5">
              + Post
            </Link>
          )}
        </div>
        <ErrorNote error={err} />
        {!videos ? (
          <Loading />
        ) : !videos.length ? (
          <Empty title={tab === "following" ? (me ? "Nothing from people you follow yet" : "Sign in to see who you follow") : "No videos yet"}>
            {me ? <Link href="/videos/new" className="underline">Post the first one</Link> : "Sellers and shoppers post short videos of what they're selling and buying."}
          </Empty>
        ) : (
          <div
            className="h-[calc(100dvh-9rem)] snap-y snap-mandatory space-y-4 overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (next && el.scrollTop + el.clientHeight * 2 > el.scrollHeight) {
                const c = next;
                setNext(null);
                load(c);
              }
            }}
          >
            {videos.filter((v) => !me?.blockedUserIds?.includes(v.creatorId)).map((v) => (
              <VideoCard key={v.id} v={v} me={me?.user.id ?? null} muted={muted} onToggleMute={() => setMuted(!muted)} onComments={() => setComments(v)} />
            ))}
          </div>
        )}
      </div>
      <aside className="hidden md:block">
        {comments ? (
          <div className="panel sticky top-24 h-[70vh] overflow-hidden">
            <VideoComments key={comments.id} videoId={comments.id} me={me?.user.id ?? null} creatorId={comments.creatorId} onClose={() => setComments(null)} />
          </div>
        ) : (
          <div className="panel sticky top-24 space-y-2 p-4 text-sm text-muted">
            <b className="text-ink">Shop from videos</b>
            <p>Tap a product card on any video to buy it. Sellers post new drops here between live shows.</p>
          </div>
        )}
      </aside>
      {comments && (
        <div className="fixed inset-x-0 bottom-0 z-40 h-[65vh] rounded-t-3xl border-t border-line bg-card md:hidden">
          <VideoComments key={comments.id} videoId={comments.id} me={me?.user.id ?? null} creatorId={comments.creatorId} onClose={() => setComments(null)} />
        </div>
      )}
    </div>
  );
}
