"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { Empty, ErrorNote, Loading } from "@/components/ui";

type N = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

function ago(d: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return new Date(d).toLocaleDateString();
}

export default function Notifications() {
  const { me, ready } = useMe();
  const { data, loading, error, setData } = useApi<N[]>(me ? "/notifications" : null, [me?.user.id]);
  const [more, setMore] = useState(true);
  useRealtime(null, { "notification:new": (n: N) => setData((cur) => (cur ? [n, ...cur.filter((x) => x.id !== n.id)] : [n])) });

  // Opening the inbox marks what's visible as read; the list still shows which ones were new.
  useEffect(() => {
    const unread = data?.filter((n) => !n.readAt).map((n) => n.id);
    if (unread?.length) api("/notifications/read", { body: { ids: unread } }).catch(() => {});
  }, [data]);

  if (!ready) return <Loading />;
  if (!me)
    return (
      <Empty title="Sign in to see notifications">
        <Link href="/login" className="underline">Sign in</Link>
      </Empty>
    );
  if (loading && !data) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Notifications</h1>
        <Link href="/settings/notifications" className="btn-ghost text-sm">Settings</Link>
      </div>
      <ErrorNote error={error} />
      {!data?.length && <Empty title="Nothing yet">Orders, shipping updates, outbids and shows from sellers you follow will show up here.</Empty>}
      {!!data?.length && (
      <ul className="panel divide-y divide-line overflow-hidden">
        {data?.map((n) => {
          const inner = (
            <div className="flex gap-3 p-4">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand"}`} aria-label={n.readAt ? undefined : "New"} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{n.title}</span>
                  <span className="shrink-0 text-xs text-muted">{ago(n.createdAt)}</span>
                </div>
                {n.body && <div className="text-sm text-muted">{n.body}</div>}
              </div>
            </div>
          );
          return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-line/40">{inner}</Link> : inner}</li>;
        })}
      </ul>
      )}
      {data && data.length >= 50 && more && (
        <button
          className="btn-ghost w-full"
          onClick={async () => {
            const next = await api<N[]>(`/notifications?before=${encodeURIComponent(data.at(-1)!.createdAt)}`);
            if (next.length < 50) setMore(false);
            setData([...data, ...next]);
          }}
        >
          Load older
        </button>
      )}
    </div>
  );
}
