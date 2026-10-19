import { PlacesService } from "./places.service";

const config = { get: () => undefined } as never;

describe("PlacesService", () => {
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(
      async (key: string, value: unknown) => void store.set(key, value),
    ),
  } as never;
  const fetchMock = jest.fn();

  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it("skips short queries without calling out", async () => {
    const service = new PlacesService(cache, config);
    expect(await service.search("a")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps rows and caches the result", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          lat: "11.9",
          lon: "108.4",
          name: "Cafe",
          display_name: "Cafe, Da Lat",
        },
      ],
    });
    const service = new PlacesService(cache, config);
    const first = await service.search("Cafe Da Lat");
    expect(first).toEqual([
      { name: "Cafe", address: "Cafe, Da Lat", lat: 11.9, lng: 108.4 },
    ]);
    await service.search("cafe da lat");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when the upstream fails, and does not cache it", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const service = new PlacesService(cache, config);
    expect(await service.search("library")).toEqual([]);
    expect(store.size).toBe(0);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          lat: "11.9",
          lon: "108.4",
          name: "Library",
          display_name: "Library, Da Lat",
        },
      ],
    });
    expect((await service.search("library")).map((r) => r.name)).toEqual([
      "Library",
    ]);
  });

  it("skips a lookup whose caller has gone", async () => {
    const service = new PlacesService(cache, config);
    const gone = new AbortController();
    gone.abort();
    expect(await service.search("library", gone.signal)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("retries without diacritics when the typed form finds nothing", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            lat: "11.94",
            lon: "108.45",
            name: "Phan Dinh Phung",
            display_name: "Phan Dinh Phung",
          },
        ],
      });
    const service = new PlacesService(cache, config);
    const results = await service.search("Phan Đình Phùng");
    expect(results.map((r) => r.name)).toEqual(["Phan Dinh Phung"]);
    expect(String(fetchMock.mock.calls[3][0])).toContain("q=phan+dinh+phung");
  }, 15000);

  it("sorts search results by distance to DLU", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { lat: "11.5", lon: "108.0", name: "Far", display_name: "Far" },
        { lat: "11.956", lon: "108.444", name: "Near", display_name: "Near" },
      ],
    });
    const service = new PlacesService(cache, config);
    const results = await service.search("anywhere");
    expect(results.map((r) => r.name)).toEqual(["Near", "Far"]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("bounded=1");
    expect(url).toContain("viewbox=");
  });

  it("searches Da Lat first and keeps the nearest six", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      lat: String(11.956 + i * 0.01),
      lon: "108.444",
      name: `Place ${i}`,
      display_name: `Place ${i}`,
    }));
    fetchMock.mockResolvedValue({ ok: true, json: async () => [...rows].reverse() });
    const service = new PlacesService(cache, config);
    const results = await service.search("place");
    expect(results.map((r) => r.name)).toEqual(["Place 0", "Place 1", "Place 2", "Place 3", "Place 4", "Place 5"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain("viewbox=108.3,12.05,108.6,11.85");
  });

  it("widens to Vietnam when the box has nothing, keeping Lam Dong hits", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { lat: "21.0", lon: "105.8", name: "Hanoi", display_name: "Hanoi" },
          {
            lat: "11.94",
            lon: "108.45",
            name: "My street",
            display_name: "My street",
          },
        ],
      });
    const service = new PlacesService(cache, config);
    const results = await service.search("12 my street");
    expect(results.map((r) => r.name)).toEqual(["My street"]);
    expect(String(fetchMock.mock.calls[2][0])).toContain("bounded=0");
  }, 15000);

  describe("route", () => {
    const from = { lat: 11.9578, lng: 108.4433 };
    const to = { lat: 11.9539, lng: 108.445 };

    it("maps the geometry and caches it", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              distance: 640.3,
              duration: 188.3,
              geometry: { coordinates: [[108.4433, 11.9578]] },
            },
          ],
        }),
      });
      const service = new PlacesService(cache, config);
      const route = await service.route("bike", from, to);
      expect(route).toEqual({
        distanceMeters: 640.3,
        durationSeconds: 188.3,
        coordinates: [[108.4433, 11.9578]],
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        "/routed-bike/route/v1/driving/108.4433,11.9578;108.445,11.9539",
      );
      await service.route("bike", from, to);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects points outside Lam Dong without calling out", async () => {
      const service = new PlacesService(cache, config);
      expect(await service.route("car", { lat: 21, lng: 105 }, to)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns null when there is no route", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ code: "NoRoute" }),
      });
      const service = new PlacesService(cache, config);
      expect(await service.route("foot", from, to)).toBeNull();
    });
  });
});
