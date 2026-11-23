"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, saveTokens } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { ErrorNote, Loading } from "@/components/ui";

export default function Sell() {
  const { me, ready } = useMe();
  const router = useRouter();
  const [f, setF] = useState({ businessName: "", name: "", slug: "", description: "" });
  const [err, setErr] = useState<any>(null);
  const created = useRef(false);
  useEffect(() => {
    if (created.current) return;
    if (ready && !me) router.push("/register");
    if (me?.seller) router.push("/seller");
  }, [ready, me, router]);
  if (!ready || !me || me.seller) return <Loading />;
  return (
    <form
      className="mx-auto max-w-md space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await api("/sellers", { body: { businessName: f.businessName, storefront: { name: f.name || f.businessName, slug: f.slug, description: f.description || undefined } } });
          created.current = true;
          saveTokens({ accessToken: r.accessToken });
          router.push("/seller/scan");
        } catch (e) {
          setErr(e);
        }
      }}
    >
      <h1 className="font-display text-3xl font-bold">Open your store</h1>
      <p className="text-sm text-muted">Free to start. You get the Starter AI plan with 100 credits a month (about 20 photo scans).</p>
      <div>
        <label className="label" htmlFor="bn">Business name</label>
        <input id="bn" className="input" required value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} />
      </div>
      <div>
        <label className="label" htmlFor="slug">Store address</label>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted">haven/store/</span>
          <input id="slug" className="input" required value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="desc">About your store</label>
        <textarea id="desc" className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <ErrorNote error={err} />
      <button className="btn-primary w-full py-3">Create store</button>
    </form>
  );
}
