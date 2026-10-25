import { useSearchParams } from "react-router-dom";
import { WithAuth } from "@/components/hoc/with-auth";
import { SettingsPage } from "@/components/settings/settings-page";
import { useNoindex } from "@/hooks/use-noindex";

export default function HomePage() {
  useNoindex();
  const [params] = useSearchParams();

  return (
    <WithAuth>
      <SettingsPage focusLms={params.get("focus") === "dlu"} />
    </WithAuth>
  );
}
