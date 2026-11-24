"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, clearTokens } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { ErrorNote, Loading } from "@/components/ui";
import { unblockUser } from "@/components/Safety";

export default function AccountSettings() {
  const { me, ready } = useMe();
  if (!ready) return <Loading />;
  if (!me)
    return (
      <p className="text-center">
        <Link href="/login?next=/settings/account" className="underline">
          Sign in
        </Link>{" "}
        to manage your account.
      </p>
    );
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="font-display text-3xl font-bold">Account</h1>
      <p className="text-sm text-muted">
        Signed in as {me.user.email}. <Link href="/settings/notifications" className="underline">Notification settings</Link>
      </p>
      <Blocked />
      <DeleteAccount hasPassword={me.user.hasPassword !== false} isSeller={!!me.seller} />
    </div>
  );
}

function Blocked() {
  const list = useApi<any[]>("/me/blocks");
  const [err, setErr] = useState<any>(null);
  return (
    <section className="panel space-y-3 p-4">
      <h2 className="font-display text-lg font-semibold">Blocked people</h2>
      {list.loading ? (
        <Loading />
      ) : !list.data?.length ? (
        <p className="text-sm text-muted">You haven&rsquo;t blocked anyone. Block someone from their profile, or from the ••• menu on their video, comment or chat message.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Link href={`/u/${b.handle}`} className="min-w-0 truncate">
                <b>{b.displayName}</b> <span className="text-muted">@{b.handle}</span>
              </Link>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => unblockUser(b.handle).then(list.reload).catch(setErr)}>
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={err} />
    </section>
  );
}

function DeleteAccount({ hasPassword, isSeller }: { hasPassword: boolean; isSeller: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  return (
    <section className="panel space-y-3 border-live/40 p-4">
      <h2 className="font-display text-lg font-semibold text-live">Delete account</h2>
      <p className="text-sm">This can&rsquo;t be undone. Deleting your account:</p>
      <ul className="ml-5 list-disc space-y-1 text-sm">
        <li>Erases your name, email, handle, photo, bio, saved addresses and sign-in methods</li>
        <li>Removes your videos and hides your comments and chat messages</li>
        <li>Ends your follows, blocks, notifications, cart and wishlist</li>
        {isSeller && <li>Closes your shop: listings are archived, upcoming shows are ended, and your AI plan is cancelled</li>}
      </ul>
      <p className="text-xs text-muted">Orders and payments are kept without your personal details, because the law requires sales records. Orders still on their way must be delivered first.</p>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/me", { method: "DELETE", body: { confirm: "DELETE", ...(hasPassword ? { password } : {}) } });
            clearTokens();
            router.push("/");
          } catch (e) {
            setErr(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {hasPassword && <input className="input" type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Your password" />}
        <input className="input" placeholder="Type DELETE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type DELETE to confirm" autoCapitalize="characters" />
        <ErrorNote error={err} />
        <button className="w-full rounded-xl bg-live px-4 py-2.5 font-semibold text-white disabled:opacity-50" disabled={busy || confirm.trim() !== "DELETE" || (hasPassword && !password)}>
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </form>
    </section>
  );
}
