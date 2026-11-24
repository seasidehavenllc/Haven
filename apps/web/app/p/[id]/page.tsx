import View from "@/app/_views/ProductView";
import { staticParams } from "@/lib/static-params";

// Static builds (GitHub Pages) pre-render the sample pages; any other id is served by app/not-found.tsx.
export const generateStaticParams = () => staticParams("products", "id");

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <View params={params} />;
}
