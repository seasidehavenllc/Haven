"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/hooks";
import { Loading } from "@/components/ui";

const tabs = [
  ["/seller", "Overview"],
  ["/seller/scan", "📷 Scan to sell"],
  ["/seller/products", "Products"],
  ["/seller/streams", "Live studio"],
  ["/seller/orders", "Orders"],
  ["/seller/ai", "AI plan & credits"],
];

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const { me, ready } = useMe();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (ready && !me) router.push("/login?next=/seller");
    else if (ready && me && !me.seller) router.push("/sell");
  }, [ready, me, router]);
  if (!ready || !me?.seller) return <Loading />;
  return (
    <div className="grid gap-6 md:grid-cols-[210px_1fr]">
      <aside className="space-y-1">
        <div className="mb-3 px-3">
          <div className="font-display text-lg font-bold">{me.seller.businessName}</div>
          {me.seller.storefront && (
            <Link href={`/store/${me.seller.storefront.slug}`} className="text-xs text-muted underline">
              View storefront
            </Link>
          )}
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {tabs.map(([href, label]) => {
            const active = href === "/seller" ? path === href : path.startsWith(href!);
            return (
              <Link key={href} href={href!} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium ${active ? "bg-brand/15 text-brand-light ring-1 ring-brand/40" : "hover:bg-card"}`}>
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
