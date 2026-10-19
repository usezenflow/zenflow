import { describe, expect, it } from "vitest";
import { homeStop } from "../home-stop";

describe("homeStop", () => {
  it("returns the saved home as a stop", () => {
    expect(homeStop({ homeLocation: "Hem 12", homeLat: 11.94, homeLng: 108.43 })).toEqual({
      text: "Hem 12",
      point: { lat: 11.94, lng: 108.43 },
    });
  });

  it("returns null without a name or a point", () => {
    expect(homeStop(null)).toBeNull();
    expect(homeStop({ homeLocation: null, homeLat: null, homeLng: null })).toBeNull();
    expect(homeStop({ homeLocation: "Hem 12", homeLat: null, homeLng: null })).toBeNull();
  });
});
