import { create } from "zustand";

/**
 * Browser connectivity. `navigator.onLine` only reports the network, so a
 * failed API call also shows saved data (see `calendar/layout.tsx`).
 */
export const useConnectivity = create<{ online: boolean }>(() => ({
  online: navigator.onLine,
}));

window.addEventListener("online", () => useConnectivity.setState({ online: true }));
window.addEventListener("offline", () => useConnectivity.setState({ online: false }));
