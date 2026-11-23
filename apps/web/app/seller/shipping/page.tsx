"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorNote, Loading, Money, NotConfigured } from "@/components/ui";

const dollars = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
const toCents = (s: string) => (s.trim() === "" ? null : Math.round(Number(s) * 100));

export default function SellerShipping() {
  const { data, loading, error, reload } = useApi<any>("/seller/shipping");
  const ledger = useApi<any>("/seller/shipping/ledger");
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data && !f) {
      const p = data.profile;
      setF({ ...p, flat: dollars(p.flatRateCents), extra: dollars(p.perAdditionalItemCents), freeOver: dollars(p.freeOverCents) });
    }
  }, [data]);
  if (error) return <ErrorNote error={error} />;
  if (loading || !f) return <Loading />;
  const set = (k: string) => (e: any) => {
    setSaved(false);
    setF({ ...f, [k]: e.target.value });
  };
  const flat = toCents(f.flat) ?? 0;
  const extra = toCents(f.extra) ?? 0;
  const freeOver = toCents(f.freeOver);

  async function save() {
    setErr(null);
    try {
      await api("/seller/shipping", {
        method: "PUT",
        body: {
          flatRateCents: flat,
          perAdditionalItemCents: extra,
          freeOverCents: freeOver,
          handlingDays: Number(f.handlingDays) || 0,
          ...Object.fromEntries(["fromName", "fromCompany", "fromLine1", "fromLine2", "fromCity", "fromRegion", "fromPostalCode", "fromCountry", "fromPhone"].map((k) => [k, f[k] || null])),
          parcelLengthIn: Number(f.parcelLengthIn) || undefined,
          parcelWidthIn: Number(f.parcelWidthIn) || undefined,
          parcelHeightIn: Number(f.parcelHeightIn) || undefined,
        },
      });
      setSaved(true);
      reload();
    } catch (e) {
      setErr(e);
    }
  }

  const input = (k: string, label: string, props: any = {}) => (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      <input className="input" value={f[k] ?? ""} onChange={set(k)} {...props} />
    </label>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-bold">Shipping</h1>

      <section className="panel space-y-4 p-5">
        <h2 className="font-display text-lg font-semibold">What buyers pay</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {input("flat", "Per order ($)", { inputMode: "decimal", placeholder: "0.00" })}
          {input("extra", "Each extra item ($)", { inputMode: "decimal", placeholder: "0.00" })}
          {input("freeOver", "Free shipping over ($)", { inputMode: "decimal", placeholder: "Never" })}
        </div>
        <p className="text-sm text-muted">
          Example: 3 items for $40 cost the buyer{" "}
          <b className="text-ink">
            <Money cents={freeOver != null && 4000 >= freeOver ? 0 : flat + extra * 2} />
          </b>{" "}
          shipping. {flat === 0 && extra === 0 ? "Right now every order ships free." : ""}
        </p>
        {input("handlingDays", "Ships within (business days)", { inputMode: "numeric", className: "input w-24" })}
      </section>

      <section className="panel space-y-4 p-5">
        <h2 className="font-display text-lg font-semibold">Ship from</h2>
        <p className="text-sm text-muted">Used on labels and for carrier rates. Buyers don't see it.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {input("fromName", "Name")}
          {input("fromCompany", "Business (optional)")}
          {input("fromLine1", "Street")}
          {input("fromLine2", "Apt, suite (optional)")}
          {input("fromCity", "City")}
          {input("fromRegion", "State")}
          {input("fromPostalCode", "ZIP")}
          {input("fromPhone", "Phone (some carriers need it)")}
        </div>
        <h3 className="pt-2 font-semibold">Usual box (inches)</h3>
        <div className="grid grid-cols-3 gap-3">
          {input("parcelLengthIn", "Length", { inputMode: "decimal" })}
          {input("parcelWidthIn", "Width", { inputMode: "decimal" })}
          {input("parcelHeightIn", "Height", { inputMode: "decimal" })}
        </div>
      </section>

      <ErrorNote error={err} />
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save}>
          Save shipping settings
        </button>
        {saved && <span className="text-sm text-ok">Saved</span>}
      </div>

      <section className="panel space-y-3 p-5">
        <h2 className="font-display text-lg font-semibold">Labels</h2>
        {data.labels.configured ? (
          <p className="text-sm text-muted">Buy labels from each order through {data.labels.name}. Label costs are taken from your payouts.</p>
        ) : (
          <NotConfigured what="Label printing" env={["SHIPPO_API_KEY or EASYPOST_API_KEY"]} />
        )}
        <div className="flex justify-between border-t border-line pt-3 text-sm">
          <span>Label costs to settle</span>
          <b>
            <Money cents={-(ledger.data?.balanceCents ?? 0)} />
          </b>
        </div>
        {ledger.data?.entries?.map((e: any) => (
          <div key={e.id} className="flex justify-between text-xs text-muted">
            <span>
              {new Date(e.createdAt).toLocaleDateString()} · {e.memo ?? e.kind}
            </span>
            <Money cents={e.amountCents} />
          </div>
        ))}
      </section>
    </div>
  );
}
