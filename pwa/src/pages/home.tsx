import { CalendarLayout } from "@/components/calendar/layout";
import { WithAuth } from "@/components/hoc/with-auth";
import { useNoindex } from "@/hooks/use-noindex";

export default function HomePage() {
  useNoindex();

  return (
    <WithAuth>
      <CalendarLayout />
    </WithAuth>
  );
}
