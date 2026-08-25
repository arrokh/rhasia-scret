import { notFound } from "next/navigation";
import { RememberedBrowserPreviewClient } from "@/modules/crypto/preview";

export const dynamic = "force-dynamic";

export default function RememberedBrowserPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <RememberedBrowserPreviewClient />;
}
