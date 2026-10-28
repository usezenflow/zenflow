const CURVE =
  "M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5";

/** The Zenflow mark as a standalone SVG, for places that cannot link to a hosted file. */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" fill="none" aria-hidden="true"><defs><linearGradient id="g" x1="48.5" y1="31.5" x2="222.5" y2="220.5" gradientUnits="userSpaceOnUse"><stop stop-color="#FF6900"/><stop offset="0.323567" stop-color="#F0B100"/><stop offset="1" stop-color="#D8F999"/></linearGradient></defs><circle cx="130" cy="130" r="130" fill="url(#g)"/><path d="${CURVE}" stroke="#FFF085" stroke-width="24" stroke-linecap="round"/></svg>`;

export const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;
