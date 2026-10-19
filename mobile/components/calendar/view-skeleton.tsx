import { Skeleton } from "@/components/ui/skeleton";
import { View } from "react-native";

const GRID_COLUMNS = [0, 1, 2, 3, 4, 5, 6];
const MONTH_ROWS = [0, 1, 2, 3, 4];

/**
 * Cheap stand-in shown for the frame or two while the Month view mounts,
 * so switching views answers the tap at once.
 */
export function CalendarViewSkeleton() {
  return (
    <View testID="view-skeleton.month" className="flex-1 px-4 pt-3">
      <Skeleton className="h-6 w-44" />
      <View className="mt-4 gap-3">
        {MONTH_ROWS.map((row) => (
          <View key={row} className="flex-row gap-1.5">
            {GRID_COLUMNS.map((i) => (
              <View key={i} className="flex-1 items-center gap-1.5">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-1 w-full" />
              </View>
            ))}
          </View>
        ))}
      </View>
      <View className="mt-6 gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </View>
    </View>
  );
}
