import { CAMPUS_PLACES } from "@zenflow/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildCampusMapHtml, campusMapsUrl } from "../campus-map";

const towerA8 = CAMPUS_PLACES[0];

describe("buildCampusMapHtml", () => {
  const mapsUrl = "http://192.168.1.10:8090/maps";

  it("centres on the place as [lng, lat]", () => {
    expect(buildCampusMapHtml(towerA8, mapsUrl)).toContain(`"center":[${towerA8.lng},${towerA8.lat}]`);
  });

  it("loads the libraries and style from the map edge", () => {
    const html = buildCampusMapHtml(towerA8, mapsUrl);
    expect(html).toContain(`src="${mapsUrl}/lib/maplibre-gl.js"`);
    expect(html).toContain(`src="${mapsUrl}/lib/pmtiles.js"`);
    expect(html).toContain(`"mapsUrl":"${mapsUrl}"`);
    expect(html).not.toContain("unpkg.com");
  });

  it("escapes angle brackets so a value cannot close the script tag", () => {
    const html = buildCampusMapHtml(towerA8, "http://x.test/</script>");
    expect(html).not.toContain("</script>\"");
    expect(html).toContain("\\u003c/script>");
  });
});

describe("campusMapsUrl", () => {
  const original = { maps: process.env.EXPO_PUBLIC_MAPS_URL, api: process.env.EXPO_PUBLIC_API_URL };

  afterEach(() => {
    for (const [key, value] of [
      ["EXPO_PUBLIC_MAPS_URL", original.maps],
      ["EXPO_PUBLIC_API_URL", original.api],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("is null when neither URL is set", () => {
    delete process.env.EXPO_PUBLIC_MAPS_URL;
    delete process.env.EXPO_PUBLIC_API_URL;
    expect(campusMapsUrl()).toBeNull();
    process.env.EXPO_PUBLIC_MAPS_URL = "   ";
    expect(campusMapsUrl()).toBeNull();
  });

  it("defaults to /maps on the API origin", () => {
    delete process.env.EXPO_PUBLIC_MAPS_URL;
    process.env.EXPO_PUBLIC_API_URL = "http://localhost/api/v1";
    expect(campusMapsUrl()).toBe("http://localhost/maps");
  });

  it("trims whitespace and trailing slashes on the override", () => {
    process.env.EXPO_PUBLIC_MAPS_URL = " http://192.168.1.10:8090/maps/ ";
    expect(campusMapsUrl()).toBe("http://192.168.1.10:8090/maps");
  });
});
