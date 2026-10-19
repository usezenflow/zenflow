import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import SpiritsScreen from "@/app/(app)/spirits";
import { useSpiritsStore } from "@/hooks/use-spirits";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const collection = (owned: Record<string, number>) =>
  ["fox", "wolf", "serpent", "stag", "owl", "lynx", "panther", "phoenix"].map((spiritId) => ({
    spiritId,
    rarity: "common",
    count: owned[spiritId] ?? 0,
  }));

beforeEach(() => {
  useSpiritsStore.setState({ data: null, loading: false, error: false });
});

describe("SpiritsScreen", () => {
  it("shows unowned spirits as unnamed silhouettes and names only what is owned", async () => {
    server.use(
      http.get(`${API}/spirits`, () =>
        HttpResponse.json({
          success: true,
          data: {
            egg: { id: "egg-1", status: "incubating", sparks: 2, sparksNeeded: 5 },
            collection: collection({ owl: 1 }),
            power: 1,
            maxPower: 19,
            perks: [],
          },
        }),
      ),
    );

    renderScreen(<SpiritsScreen />);

    expect(await screen.findAllByText("Frost owl")).not.toHaveLength(0);
    expect(screen.getAllByLabelText("Locked spirit")).toHaveLength(7);
    expect(screen.queryByText("Flame fox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hatch" })).toBeNull();
  });

  it("hatches a ready egg and reveals the spirit", async () => {
    let hatched = false;
    server.use(
      http.get(`${API}/spirits`, () =>
        HttpResponse.json({
          success: true,
          data: {
            egg: hatched
              ? { id: "egg-2", status: "incubating", sparks: 0, sparksNeeded: 5 }
              : { id: "egg-1", status: "ready", sparks: 5, sparksNeeded: 5 },
            collection: collection(hatched ? { fox: 1 } : {}),
            power: hatched ? 2 : 0,
            maxPower: 19,
            perks: [],
          },
        }),
      ),
      http.post(`${API}/eggs/egg-1/hatch`, () => {
        hatched = true;
        return HttpResponse.json({
          success: true,
          data: {
            spirit: { spiritId: "fox", rarity: "rare" },
            egg: { id: "egg-2", status: "incubating", sparks: 0, sparksNeeded: 5 },
            power: 2,
          },
        });
      }),
    );

    renderScreen(<SpiritsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Hatch" }));

    await waitFor(() => expect(screen.getByText("New spirit")).toBeTruthy());
    expect(screen.getAllByText("Flame fox").length).toBeGreaterThan(0);
    expect(hatched).toBe(true);
  });
});
