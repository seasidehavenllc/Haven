"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/hooks";
import { Empty, ErrorNote, Loading } from "@/components/ui";
import { VideoTile, type Video } from "@/components/VideoCard";

export default function Profile() {
  const { handle } = useParams<{ handle: string }>();
  const { data, loading, error } = useApi<Video[]>(`/users/${handle}/videos`);
  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  const creator = data?.[0]?.creator;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">{creator?.displayName ?? `@${handle}`}</h1>
        <p className="text-muted">@{handle}</p>
        {creator?.seller?.storefront && (
          <Link href={`/store/${creator.seller.storefront.slug}`} className="btn-ghost mt-3 inline-flex">
            Visit {creator.seller.storefront.name}
          </Link>
        )}
      </div>
      {!data?.length ? (
        <Empty title="No videos yet" />
      ) : (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {data.map((v) => <VideoTile key={v.id} v={v} />)}
        </div>
      )}
    </div>
  );
}
