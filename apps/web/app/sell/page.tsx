"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApplicationStatusInfo, InventorySizes, SellerCategories } from "@haven/shared";
import { api, saveTokens } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { ErrorNote, Loading } from "@/components/ui";

type Status = { canSell: boolean; seller: { status: string } | null; application: any | null; payoutsMode: "stripe" | "test" | "off"; terms: { version: string; points: string[] } };

const blank = {
  legalName: "",
  phone: "",
  dateOfBirth: "",
  address: { line1: "", line2: "", city: "", region: "", postalCode: "", country: "US" },
  businessType: "INDIVIDUAL",
  businessName: "",
  storeName: "",
  storeSlug: "",
  categories: [] as string[],
  description: "",
  inventorySize: "",
  experience: "",
  socialLinks: [] as string[],
  sampleImageUrls: [] as string[],
};

/** Apply to sell. Approved sellers go straight to their dashboard. */
export default function SellPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Sell />
    </Suspense>
  );
}

function Sell() {
  const { me, ready, reload: reloadMe } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const st = useApi<Status>(ready && me ? "/sellers/application" : null, [ready, !!me]);
  useEffect(() => {
    if (ready && !me) router.push("/register?next=/sell");
  }, [ready, me, router]);
  useEffect(() => {
    if (!st.data?.canSell) return;
    // Pick up the seller id in a fresh token, then open the dashboard.
    api("/auth/token", { method: "POST" })
      .then((r) => saveTokens({ accessToken: r.accessToken }))
      .finally(() => reloadMe().then(() => router.push("/seller")));
  }, [st.data?.canSell]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready || !me || st.loading || !st.data || st.data.canSell) return st.error ? <ErrorNote error={st.error} /> : <Loading />;
  const s = st.data;
  if (s.seller && s.seller.status !== "APPROVED")
    return (
      <div className="panel mx-auto max-w-lg space-y-2 p-6">
        <h1 className="font-display text-2xl font-bold">Selling is paused</h1>
        <p className="text-sm text-muted">Your seller account is {s.seller.status.toLowerCase().replace("_", " ")}. Contact Haven support if you think this is a mistake.</p>
      </div>
    );
  const a = s.application;
  if (a?.status === "SUBMITTED")
    return (
      <div className="panel mx-auto max-w-lg space-y-2 p-6">
        <span className="chip">{ApplicationStatusInfo.SUBMITTED.label}</span>
        <h1 className="font-display text-2xl font-bold">Thanks, {a.businessName} is in review</h1>
        <p className="text-sm text-muted">{ApplicationStatusInfo.SUBMITTED.summary}</p>
        <p className="text-sm text-muted">You can keep shopping in the meantime.</p>
      </div>
    );
  return <ApplicationForm status={s} returnedFromStripe={params.get("payouts") === "done"} onChange={st.reload} />;
}

function ApplicationForm({ status, returnedFromStripe, onChange }: { status: Status; returnedFromStripe: boolean; onChange: () => void }) {
  const a = status.application;
  const [f, setF] = useState(() => ({ ...blank, ...(a ? pick(a) : {}) }));
  const [agree, setAgree] = useState(!!a?.termsAcceptedAt);
  const [links, setLinks] = useState((a?.socialLinks ?? []).join("\n"));
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof f>) => (setF({ ...f, ...patch }), setSaved(false));
  const setAddr = (patch: Partial<typeof f.address>) => set({ address: { ...f.address, ...patch } });

  /** Send only what's filled in, so a half-done draft still saves. */
  const body = () => {
    const out: any = {};
    for (const [k, v] of Object.entries(f)) {
      if (k === "address") continue;
      if (Array.isArray(v) ? v.length || k === "sampleImageUrls" : v) out[k] = v;
    }
    if (f.address.line1 && f.address.city) out.address = { ...f.address, line2: f.address.line2 || null };
    out.socialLinks = links.split(/\s+/).map((l: string) => l.trim()).filter(Boolean).map((l: string) => (/^https?:\/\//.test(l) ? l : `https://${l}`));
    out.agreeToTerms = agree;
    return out;
  };
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  const save = () => api("/sellers/application", { method: "PUT", body: body() });
  const missing: { key: string; label: string }[] = a?.missing ?? [];

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    await run("photos", async () => {
      const urls: string[] = [];
      for (const file of Array.from(files).slice(0, 6 - f.sampleImageUrls.length)) {
        const fd = new FormData();
        fd.append("file", file);
        urls.push((await api<{ url: string }>("/uploads", { form: fd })).url);
      }
      set({ sampleImageUrls: [...f.sampleImageUrls, ...urls] });
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold">Apply to sell on Haven</h1>
        <p className="text-sm text-muted">Anyone can shop. To list items and sell on live shows, tell us about you and what you sell. Our team reviews every application, usually within 1 to 2 business days.</p>
      </div>
      {a?.status === "NEEDS_INFO" && (
        <div className="panel border-brand p-4 text-sm">
          <b>{ApplicationStatusInfo.NEEDS_INFO.label}:</b> {a.decisionNote}
          <div className="text-muted">Update your application below and send it again.</div>
        </div>
      )}
      {a?.status === "REJECTED" && (
        <div className="panel border-live p-4 text-sm">
          <b>{ApplicationStatusInfo.REJECTED.summary}</b> {a.decisionNote && <>Reason: {a.decisionNote}</>}
          <div className="text-muted">You can change your application and send it again.</div>
        </div>
      )}

      <Section n={1} title="About you" hint="Your legal name and contact details. Only the Haven team sees these.">
        <Input label="Legal name" value={f.legalName} onChange={(v) => set({ legalName: v })} autoComplete="name" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Phone" value={f.phone} onChange={(v) => set({ phone: v })} type="tel" autoComplete="tel" />
          <Input label="Date of birth (18+)" value={f.dateOfBirth} onChange={(v) => set({ dateOfBirth: v })} type="date" />
        </div>
        <Input label="Street address" value={f.address.line1} onChange={(v) => setAddr({ line1: v })} autoComplete="address-line1" />
        <Input label="Apartment, suite (optional)" value={f.address.line2 ?? ""} onChange={(v) => setAddr({ line2: v })} autoComplete="address-line2" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="City" value={f.address.city} onChange={(v) => setAddr({ city: v })} autoComplete="address-level2" />
          <Input label="State" value={f.address.region} onChange={(v) => setAddr({ region: v })} autoComplete="address-level1" />
          <Input label="ZIP" value={f.address.postalCode} onChange={(v) => setAddr({ postalCode: v })} autoComplete="postal-code" />
        </div>
      </Section>

      <Section n={2} title="Your business" hint="Selling as yourself is fine. Stripe asks for your SSN or EIN during payout setup; Haven never stores it.">
        <div className="flex gap-2">
          {(["INDIVIDUAL", "BUSINESS"] as const).map((t) => (
            <button key={t} type="button" onClick={() => set({ businessType: t })} className={`flex-1 rounded-xl px-3 py-2 text-sm ring-1 ${f.businessType === t ? "bg-brand/15 ring-brand" : "ring-line"}`}>
              {t === "INDIVIDUAL" ? "Just me" : "Registered business"}
            </button>
          ))}
        </div>
        <Input label={f.businessType === "BUSINESS" ? "Registered business name" : "Name you sell under"} value={f.businessName} onChange={(v) => set({ businessName: v, storeName: f.storeName || v, storeSlug: f.storeSlug || slugify(v) })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Store name" value={f.storeName} onChange={(v) => set({ storeName: v })} />
          <Input label="Store address (haven/store/…)" value={f.storeSlug} onChange={(v) => set({ storeSlug: v.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
        </div>
      </Section>

      <Section n={3} title="What you sell" hint="Pick up to 6.">
        <div className="flex flex-wrap gap-2">
          {SellerCategories.map((c) => {
            const on = f.categories.includes(c);
            return (
              <button key={c} type="button" onClick={() => set({ categories: on ? f.categories.filter((x) => x !== c) : f.categories.length < 6 ? [...f.categories, c] : f.categories })} className={`rounded-full px-3 py-1.5 text-sm ring-1 ${on ? "bg-brand text-brand-ink ring-brand" : "ring-line"}`}>
                {c}
              </button>
            );
          })}
        </div>
        <div>
          <label className="label" htmlFor="desc">Tell us about your items</label>
          <textarea id="desc" className="input" rows={4} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="What you sell, where it comes from, condition, price range." />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="inv">How many items do you have to sell?</label>
            <select id="inv" className="input" value={f.inventorySize} onChange={(e) => set({ inventorySize: e.target.value })}>
              <option value="">Choose</option>
              {InventorySizes.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <Input label="Selling experience (optional)" value={f.experience ?? ""} onChange={(v) => set({ experience: v })} placeholder="e.g. 3 years on eBay and Whatnot" />
        </div>
        <div>
          <label className="label" htmlFor="links">Social or shop links (optional, one per line)</label>
          <textarea id="links" className="input" rows={2} value={links} onChange={(e) => (setLinks(e.target.value), setSaved(false))} placeholder="instagram.com/yourshop" />
        </div>
        <div className="space-y-2">
          <span className="label">Photos of items you'd sell (optional, up to 6)</span>
          <div className="flex flex-wrap gap-2">
            {f.sampleImageUrls.map((u) => (
              <button key={u} type="button" title="Remove" onClick={() => set({ sampleImageUrls: f.sampleImageUrls.filter((x) => x !== u) })}>
                <img src={u} alt="Sample item" className="h-20 w-20 rounded-xl object-cover" />
              </button>
            ))}
            {f.sampleImageUrls.length < 6 && (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl text-xs text-muted ring-1 ring-line">
                {busy === "photos" ? "Uploading…" : "+ Add"}
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
              </label>
            )}
          </div>
        </div>
      </Section>

      <Section n={4} title="Payouts" hint="Stripe pays you for each sale. They verify your identity and bank account on their own secure form.">
        {status.payoutsMode === "off" ? (
          <p className="text-sm text-muted">Payouts aren't connected on Haven yet. You can still send your application; we'll ask you to set them up later.</p>
        ) : a?.payoutsDetailsDone ? (
          <p className="text-sm">✅ Payout details sent to Stripe{a.payoutsEnabled ? " and verified." : ". Stripe is still verifying them."}</p>
        ) : (
          <>
            {returnedFromStripe && <p className="text-sm text-muted">Stripe still needs a few details. Pick up where you left off.</p>}
            <button
              type="button"
              className="btn-ghost"
              disabled={!!busy}
              onClick={() =>
                run("payouts", async () => {
                  await save();
                  const r = await api<any>("/sellers/application/payouts", { method: "POST" });
                  if (r.url) window.location.href = r.url;
                  else onChange();
                })
              }
            >
              {busy === "payouts" ? "Opening Stripe…" : "Set up payouts with Stripe"}
            </button>
          </>
        )}
      </Section>

      <Section n={5} title="Seller terms">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {status.terms.points.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => (setAgree(e.target.checked), setSaved(false))} /> I agree to the Haven seller terms
        </label>
      </Section>

      {!!missing.length && (
        <div className="panel p-4 text-sm">
          <b>Still to do</b>
          <ul className="list-disc pl-5 text-muted">{missing.map((m) => <li key={m.key}>{m.label}</li>)}</ul>
        </div>
      )}
      <ErrorNote error={err} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" disabled={!!busy} onClick={() => run("save", async () => (await save(), setSaved(true), onChange()))}>
          {busy === "save" ? "Saving…" : saved ? "Saved" : "Save for later"}
        </button>
        <button className="btn-primary flex-1 py-3" disabled={!!busy} onClick={() => run("send", async () => (await save(), await api("/sellers/application/submit", { method: "POST" }), onChange()))}>
          {busy === "send" ? "Sending…" : a?.status === "NEEDS_INFO" || a?.status === "REJECTED" ? "Send again" : "Send application"}
        </button>
      </div>
    </div>
  );
}

const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function pick(a: any): typeof blank {
  return {
    legalName: a.legalName,
    phone: a.phone,
    dateOfBirth: a.dateOfBirth ?? "",
    address: { ...blank.address, ...(a.address ?? {}) },
    businessType: a.businessType,
    businessName: a.businessName,
    storeName: a.storeName,
    storeSlug: a.storeSlug,
    categories: a.categories,
    description: a.description,
    inventorySize: a.inventorySize ?? "",
    experience: a.experience ?? "",
    socialLinks: a.socialLinks,
    sampleImageUrls: a.sampleImageUrls,
  };
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="panel space-y-3 p-5">
      <div>
        <h2 className="font-display text-lg font-bold">
          <span className="text-muted">{n}.</span> {title}
        </h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Input({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </div>
  );
}
