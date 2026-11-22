"use client";
import { useApi } from "@/lib/hooks";
import { Empty, Loading } from "@/components/ui";
import { StreamCard } from "@/components/StreamCard";

export default function LiveList() {
  const { data, loading } = useApi<any[]>("/streams");
  if (loading) return <Loading />;
  return (
    <div>
      <h1 className="mb-4 font-display text-3xl font-bold">Live & upcoming</h1>
      {data?.length ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
          {data.map((s) => (
            <StreamCard key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <Empty title="No shows scheduled" />
      )}
    </div>
  );
}
