"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/hooks";
import { Empty, Loading, ProductCard } from "@/components/ui";

function Results() {
  const sp = useSearchParams();
  const q = sp.get("q") ?? "";
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("newest");
  const [inStock, setInStock] = useState(false);
  const [max, setMax] = useState("");
  const cats = useApi<any[]>("/categories");
  const params = new URLSearchParams({ q, sort, pageSize: "48", ...(category ? { category } : {}), ...(inStock ? { inStock: "true" } : {}), ...(max ? { maxPrice: String(Math.round(Number(max) * 100)) } : {}) });
  const { data, loading } = useApi<{ total: number; items: any[] }>(`/products?${params}`);
  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <aside className="space-y-4">
        <div>
          <label className="label">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Max price ($)</label>
          <input className="input" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
        <div>
          <label className="label">Sort</label>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> In stock only
        </label>
      </aside>
      <section>
        <h1 className="mb-4 font-display text-2xl font-bold">{q ? `Results for "${q}"` : "All products"} {data && <span className="text-base font-normal text-muted">({data.total})</span>}</h1>
        {loading ? <Loading /> : data?.items.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        ) : (
          <Empty title="Nothing matches yet">Try fewer filters, or ask the AI shopping assistant.</Empty>
        )}
      </section>
    </div>
  );
}
export default function SearchPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Results />
    </Suspense>
  );
}
