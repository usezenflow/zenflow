import { WithAuth } from "@/components/hoc/with-auth";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { useNoindex } from "@/hooks/use-noindex";

export default function OnboardingPage() {
  useNoindex();

  return (
    <WithAuth>
      <OnboardingFlow />
    </WithAuth>
  );
}
