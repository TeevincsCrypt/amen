import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { ChainStatus } from "@/components/chain-status";
import { FreezeBanner } from "@/components/freeze-banner";
import { EligibilityGate } from "@/components/eligibility";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <ChainStatus />
        <FreezeBanner />
        <Topbar />
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6">{children}</main>
      </div>
      <EligibilityGate />
    </div>
  );
}
