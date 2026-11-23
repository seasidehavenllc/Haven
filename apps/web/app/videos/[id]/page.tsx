"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useApi, useMe } from "@/lib/hooks";
import { ErrorNote, Loading } from "@/components/ui";
import { VideoCard, type Video } from "@/components/VideoCard";
import { VideoComments } from "@/components/VideoComments";

export default function OneVideo() {
  const { id } = useParams<{ id: string }>();
  const { me } = useMe();
  const { data, loading, error } = useApi<Video>(`/videos/${id}`, [me?.user.id]);
  const [muted, setMuted] = useState(true);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;
  return (
    <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-[1fr_340px]">
      <div>
        <Link href="/videos" className="mb-3 inline-block text-sm text-muted">
          ← More videos
        </Link>
        <VideoCard v={data} me={me?.user.id ?? null} muted={muted} onToggleMute={() => setMuted(!muted)} />
      </div>
      <div className="panel h-[70vh] overflow-hidden md:sticky md:top-24">
        <VideoComments videoId={data.id} me={me?.user.id ?? null} creatorId={data.creatorId} />
      </div>
    </div>
  );
}
