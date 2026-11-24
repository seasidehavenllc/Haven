import View from "@/app/_views/StoreView";
import { staticParams } from "@/lib/static-params";

// Static builds (GitHub Pages) pre-render the sample pages; any other id is served by app/not-found.tsx.
export const generateStaticParams = () => staticParams("stores", "slug");

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <View params={params} />;
}
