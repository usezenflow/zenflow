import { describe, expect, it } from "vitest";
import { DEFAULT_VEHICLE, VEHICLES, routeKilometres, routeMinutes, routeSeconds, vehicleFor } from "../campus-route";

const route = { distanceMeters: 3000, durationSeconds: 400, coordinates: [] as [number, number][] };

describe("vehicles", () => {
  it("defaults to the motorcycle and falls back to it", () => {
    expect(DEFAULT_VEHICLE).toBe("MOTORCYCLE");
    expect(vehicleFor(null).id).toBe("MOTORCYCLE");
    expect(VEHICLES.map((vehicle) => vehicle.id)).toEqual(["MOTORCYCLE", "CAR", "BIKE", "WALK"]);
  });

  it("times a motorcycle by distance at 30 km/h on the car route", () => {
    const motorcycle = vehicleFor("MOTORCYCLE");
    expect(motorcycle.profile).toBe("car");
    expect(routeSeconds(route, motorcycle)).toBe(360);
  });

  it("uses the router's time for a car", () => {
    expect(routeSeconds(route, vehicleFor("CAR"))).toBe(400);
  });

  it("times a bike and a walk by distance", () => {
    expect(routeSeconds(route, vehicleFor("BIKE"))).toBe(720);
    expect(routeSeconds(route, vehicleFor("WALK"))).toBe(2160);
  });
});

describe("formatting", () => {
  it("rounds minutes, at least one", () => {
    expect(routeMinutes(611)).toBe(10);
    expect(routeMinutes(5)).toBe(1);
  });

  it("shows kilometres to one decimal place", () => {
    expect(routeKilometres(842)).toBe("0.8");
  });
});
