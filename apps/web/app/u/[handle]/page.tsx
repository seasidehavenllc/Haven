"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { Empty, ErrorNote, Loading } from "@/components/ui";
import { VideoTile, type Video } from "@/components/VideoCard";

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export default function Profile() {
  const { handle } = useParams<{ handle: string }>();
  const router = useRouter();
  const { me } = useMe();
  const profile = useApi<any>(`/users/${handle}`);
  const videos = useApi<Video[]>(`/users/${handle}/videos`);
  const [err, setErr] = useState<any>(null);
  if (profile.loading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorNote error={profile.error} />;
  const p = profile.data;

  async function toggleFollow() {
    if (!me) return router.push(`/login?next=/u/${handle}`);
    const next = !p.followedByMe;
    setErr(null);
    profile.setData((d: any) => d && { ...d, followedByMe: next, followerCount: d.followerCount + (next ? 1 : -1) });
    try {
      await api(`/users/${p.id}/follow`, { method: next ? "POST" : "DELETE" });
    } catch (e) {
      setErr(e);
      profile.reload();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-line text-3xl font-bold text-muted">
          {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" /> : p.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-bold">{p.displayName}</h1>
          <p className="text-muted">@{p.handle}</p>
          {p.bio && <p className="mt-1 max-w-xl text-sm">{p.bio}</p>}
          <div className="mt-2 flex gap-4 text-sm">
            <span>
              <b>{compact(p.followerCount)}</b> <span className="text-muted">{p.followerCount === 1 ? "follower" : "followers"}</span>
            </span>
            <span>
              <b>{compact(p.followingCount)}</b> <span className="text-muted">following</span>
            </span>
            <span>
              <b>{compact(p.videoCount)}</b> <span className="text-muted">{p.videoCount === 1 ? "video" : "videos"}</span>
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {!p.isMe && (
            <button className={p.followedByMe ? "btn-ghost" : "btn-primary"} onClick={toggleFollow}>
              {p.followedByMe ? "Following" : "Follow"}
            </button>
          )}
          {p.seller?.storefront && (
            <Link href={`/store/${p.seller.storefront.slug}`} className="btn-ghost">
              Visit {p.seller.storefront.name}
            </Link>
          )}
        </div>
      </div>
      <ErrorNote error={err} />
      {videos.loading ? (
        <Loading />
      ) : !videos.data?.length ? (
        <Empty title="No videos yet" />
      ) : (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {videos.data.map((v) => <VideoTile key={v.id} v={v} />)}
        </div>
      )}
    </div>
  );
}
