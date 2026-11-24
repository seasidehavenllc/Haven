import View from "@/app/_views/AuctionView";
import { staticParams } from "@/lib/static-params";

// Static builds (GitHub Pages) pre-render the sample pages; any other id is served by app/not-found.tsx.
export const generateStaticParams = () => staticParams("auctions", "id");

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <View params={params} />;
}
