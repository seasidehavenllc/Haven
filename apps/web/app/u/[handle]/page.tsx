import View from "@/app/_views/ProfileView";
import { staticParams } from "@/lib/static-params";

// Static builds (GitHub Pages) pre-render the sample pages; any other id is served by app/not-found.tsx.
export const generateStaticParams = () => staticParams("users", "handle");

export default function Page({ params }: { params: Promise<{ handle: string }> }) {
  return <View params={params} />;
}
