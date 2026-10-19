import { describe, expect, it } from "@jest/globals";
import { CAMPUS_PLACES, foldCampusText, resolveCampusPlace, searchCampusPlaces } from "./campus";

describe("resolveCampusPlace", () => {
  it.each([
    ["A8", "A8"],
    ["a8-101", "A8"],
    ["A27 201", "A27"],
    ["Tòa A8", "A8"],
    ["АЗ", "A3"],
    ["А30", "A30"],
    ["A7", "A7"],
  ])("resolves %s to tower %s", (location, name) => {
    expect(resolveCampusPlace(location)?.name).toBe(name);
  });

  it.each([
    ["SAN01", "Sân thể chất"],
    ["SAN 1", "Sân thể chất"],
    ["san the chat", "Sân thể chất"],
    ["Sân thể chất", "Sân thể chất"],
    ["Thu vien", "Thư viện"],
    ["Cổng sau", "Công sau"],
    ["Công sau", "Công sau"],
  ])("resolves %s to %s", (location, name) => {
    expect(resolveCampusPlace(location)?.name).toBe(name);
  });

  it("does not read SAN prefixed facility names as sports codes", () => {
    expect(resolveCampusPlace("Sân khấu ngoài trời")?.name).toBe("Sân khấu ngoài trời");
  });

  it.each(["A9", "A10", "Phòng 301", "https://meet.google.com/abc", "", "A"])(
    "returns null for %s",
    (location) => {
      expect(resolveCampusPlace(location)).toBeNull();
    },
  );
});

describe("searchCampusPlaces", () => {
  it("leads an empty query with A8", () => {
    expect(searchCampusPlaces("")[0].place.name).toBe("A8");
  });

  it("leads a tower-letter query with A8", () => {
    expect(searchCampusPlaces("a")[0].place.name).toBe("A8");
  });

  it("returns the typed sports code as the value", () => {
    const [first] = searchCampusPlaces("san01");
    expect(first.place.name).toBe("Sân thể chất");
    expect(first.value).toBe("SAN01");
  });

  it("matches diacritic-free input", () => {
    const names = searchCampusPlaces("thu vien").map((s) => s.place.name);
    expect(names).toContain("Thư viện");
  });

  it("matches a word inside a name", () => {
    expect(searchCampusPlaces("khau").map((s) => s.place.name)).toContain("Sân khấu ngoài trời");
  });

  it("stores the place name as the value", () => {
    expect(searchCampusPlaces("cong sau")[0].value).toBe("Công sau");
  });

  it("caps the result count", () => {
    expect(searchCampusPlaces("a", 3)).toHaveLength(3);
  });
});

describe("campus data", () => {
  it("keeps coordinates inside the campus", () => {
    for (const place of CAMPUS_PLACES) {
      expect(place.lat).toBeGreaterThan(11.95);
      expect(place.lat).toBeLessThan(11.96);
      expect(place.lng).toBeGreaterThan(108.44);
      expect(place.lng).toBeLessThan(108.45);
    }
  });

  it("folds Vietnamese text to plain Latin", () => {
    expect(foldCampusText("Trung tâm Trí tuệ Đào")).toBe("trung tam tri tue dao");
  });
});
