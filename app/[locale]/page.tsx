import { Navbar } from "../components/Navbar";
import { HeroSection } from "../components/HeroSection";
import { StatsSection } from "../components/StatsSection";
import { HowItWorksSection } from "../components/HowItWorksSection";
import { FeaturesSection } from "../components/FeaturesSection";
import { Footer } from "../components/Footer";
import { getCachedPoolInfo } from "@/app/lib/services/pool-state-service";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/app/lib/get-query-client";
import { bondsKeys } from "@/app/lib/query-keys";

export default async function Home() {
  const queryClient = getQueryClient();

  try {
    const poolInfo = await getCachedPoolInfo(1);
    if (poolInfo) {
      queryClient.setQueryData(bondsKeys.poolState(1), poolInfo);
    }
  } catch {
    // Non-fatal: if localnet / RPC is offline during build, client query handles gracefully
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="relative min-h-screen overflow-x-clip bg-surface text-on-surface">
        <Navbar />
        <main>
          <HeroSection />
          <StatsSection />
          <HowItWorksSection />
          <FeaturesSection />
        </main>
        <Footer />
      </div>
    </HydrationBoundary>
  );
}
