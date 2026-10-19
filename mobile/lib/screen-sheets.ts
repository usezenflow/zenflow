import { useEffect } from "react";
import { create } from "zustand";

const useScreenSheets = create<{ open: number }>(() => ({ open: 0 }));

/** True while a sheet hosted in a screen is shown: the floating tab bar and buttons paint over it, so they hide. */
export function useScreenSheetOpen(): boolean {
  return useScreenSheets((s) => s.open > 0);
}

/** Counts the calling sheet as open for as long as it is mounted. */
export function useHoldScreenSheet(): void {
  useEffect(() => {
    useScreenSheets.setState((s) => ({ open: s.open + 1 }));
    return () => useScreenSheets.setState((s) => ({ open: s.open - 1 }));
  }, []);
}
