import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export default function SmokePage() {
  return <AppPage><PageHeader title="Uji cepat browser" description="Halaman pemeriksaan kesiapan antarmuka." /><SurfaceCard className="p-5 sm:p-6"><p data-testid="smoke-ready">Siap</p></SurfaceCard></AppPage>;
}
