"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatMoney } from "@haven/shared";
import { SafetyMenu } from "./Safety";

export type Video = {
  id: string;
  caption: string;
  mediaUrl: string;
  posterUrl: string | null;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  likedByMe: boolean;
  followingCreator: boolean;
  creatorId: string;
  creator: { id: string; handle: string; displayName: string; avatarUrl: string | null; seller: { storefront: { slug: string; name: string } | null } | null };
  products: { id: string; title: string; media: { url: string }[]; variants: { priceCents: number; quantity: number }[] }[];
};

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

/** One full-height video. Plays while mostly on screen, counts a view after 2 seconds of play. */
export function VideoCard({ v, me, muted, onToggleMute, onComments }: { v: Video; me: string | null; muted: boolean; onToggleMute: () => void; onComments?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [liked, setLiked] = useState(v.likedByMe);
  const [likes, setLikes] = useState(v.likeCount);
  const [following, setFollowing] = useState(v.followingCreator);
  const [paused, setPaused] = useState(false);
  const viewed = useRef(false);

  useEffect(() => {
    const el = box.current!;
    const io = new IntersectionObserver(
      ([e]) => {
        const vid = ref.current;
        if (!vid) return;
        if (e!.intersectionRatio > 0.6) vid.play().catch(() => {});
        else vid.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  async function like() {
    if (!me) return (location.href = "/login?next=/videos");
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      const r = await api(`/videos/${v.id}/like`, { method: next ? "POST" : "DELETE" });
      setLikes(r.likeCount);
    } catch {
      setLiked(!next);
      setLikes(v.likeCount);
    }
  }

  const price = (p: Video["products"][number]) => (p.variants.length ? Math.min(...p.variants.map((x) => x.priceCents)) : 0);

  return (
    <div ref={box} className="relative mx-auto h-[calc(100dvh-9rem)] max-h-[860px] w-full max-w-[480px] snap-start snap-always overflow-hidden rounded-3xl bg-stage">
      <video
        ref={ref}
        src={v.mediaUrl}
        poster={v.posterUrl ?? undefined}
        className="h-full w-full object-cover"
        playsInline
        loop
        muted={muted}
        preload="metadata"
        onClick={() => {
          const el = ref.current!;
          if (el.paused) el.play();
          else el.pause();
        }}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => {
          if (!viewed.current && e.currentTarget.currentTime >= 2) {
            viewed.current = true;
            api(`/videos/${v.id}/view`, { body: {} }).catch(() => {});
          }
        }}
      />
      {paused && <div className="pointer-events-none absolute inset-0 grid place-items-center text-6xl text-white/80">▶</div>}
      <button onClick={onToggleMute} className="absolute right-3 top-3 rounded-full bg-black/50 px-3 py-1 text-xs text-white" aria-label={muted ? "Unmute" : "Mute"}>
        {muted ? "🔇 Tap for sound" : "🔊"}
      </button>

      <div className="absolute bottom-24 right-3 flex flex-col items-center gap-4 text-white">
        <button onClick={like} className="flex flex-col items-center text-xs" aria-pressed={liked} aria-label="Like">
          <span className={`text-3xl ${liked ? "text-live" : ""}`}>{liked ? "♥" : "♡"}</span>
          {compact(likes)}
        </button>
        <button onClick={onComments} className="flex flex-col items-center text-xs" aria-label="Comments">
          <span className="text-2xl">💬</span>
          {compact(v.commentCount)}
        </button>
        <button
          onClick={() => {
            const url = `${location.origin}/videos/${v.id}`;
            if (navigator.share) navigator.share({ url, text: v.caption }).catch(() => {});
            else navigator.clipboard?.writeText(url);
          }}
          className="flex flex-col items-center text-xs"
          aria-label="Share"
        >
          <span className="text-2xl">↗</span>
          Share
        </button>
        {me && me !== v.creatorId && <SafetyMenu target="video" targetId={v.id} what="this video" handle={v.creator.handle} light />}
        <span className="text-xs opacity-80">{compact(v.viewCount)} {v.viewCount === 1 ? "view" : "views"}</span>
      </div>

      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-4 pr-20 text-white">
        <div className="flex items-center gap-2">
          <Link href={v.creator.seller?.storefront ? `/store/${v.creator.seller.storefront.slug}` : "#"} className="font-semibold">
            @{v.creator.handle}
          </Link>
          {me && me !== v.creatorId && (
            <button
              className="rounded-full border border-white/60 px-2 py-0.5 text-xs"
              onClick={async () => {
                const next = !following;
                setFollowing(next);
                await api(`/users/${v.creatorId}/follow`, { method: next ? "POST" : "DELETE" }).catch(() => setFollowing(!next));
              }}
            >
              {following ? "Following" : "Follow"}
            </button>
          )}
        </div>
        {v.caption && <p className="line-clamp-3 text-sm">{v.caption}</p>}
        {!!v.products.length && (
          <div className="-mr-16 flex gap-2 overflow-x-auto pb-1">
            {v.products.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`} className="flex w-56 shrink-0 items-center gap-2 rounded-2xl bg-white/95 p-2 text-black">
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-black/10">{p.media[0] && <img src={p.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
                <div className="min-w-0 text-xs">
                  <div className="truncate font-semibold">{p.title}</div>
                  <div>{formatMoney(price(p))} · <span className="font-semibold text-brand">Shop</span></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function VideoTile({ v }: { v: Video }) {
  return (
    <Link href={`/videos/${v.id}`} className="relative block aspect-[9/16] overflow-hidden rounded-2xl bg-stage">
      {v.posterUrl ? <img src={v.posterUrl} alt="" className="h-full w-full object-cover" /> : <video src={v.mediaUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
      <span className="absolute bottom-1 left-2 text-xs font-semibold text-white drop-shadow">▶ {v.viewCount}</span>
      {!!v.products.length && <span className="chip absolute right-1 top-1 bg-white/90 text-black">🛍 {v.products.length}</span>}
    </Link>
  );
}
