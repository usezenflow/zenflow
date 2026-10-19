import { renderSpirit, SPIRIT_IDS, SPIRITS } from "@zenflow/spirits";
import { describe, expect, it } from "vitest";

const HEX = /#[0-9a-fA-F]{6}\b/g;

function coloursIn(svg: string): Set<string> {
  return new Set(svg.match(HEX) ?? []);
}

describe("spirit art", () => {
  it.each(SPIRIT_IDS)("draws %s as an ascended spirit", (id) => {
    expect(renderSpirit(id, "ascended")).toMatchSnapshot();
  });

  it.each(SPIRIT_IDS)("draws the %s egg in the spirit's body colour", (id) => {
    expect(renderSpirit(id, "egg")).toMatchSnapshot();
  });

  it("draws hatchlings for fox and wolf only", () => {
    expect(renderSpirit("fox", "hatchling")).toMatchSnapshot();
    expect(renderSpirit("wolf", "hatchling")).toMatchSnapshot();
    expect(() => renderSpirit("owl", "hatchling")).toThrow(/No hatchling art/);
  });

  it.each(SPIRIT_IDS)("locks %s without any element colour", (id) => {
    const calm = coloursIn(renderSpirit(id, "ascended", "calm"));
    const locked = coloursIn(renderSpirit(id, "ascended", "locked"));
    const leaked = [...locked].filter((hex) => calm.has(hex));
    expect(leaked).toEqual([]);
  });

  it("keeps the locked variant on the same shape", () => {
    const strip = (svg: string) => svg.replace(/ (fill|stroke|opacity)="[^"]*"/g, "");
    expect(strip(renderSpirit("phoenix", "ascended", "locked"))).toEqual(
      strip(renderSpirit("phoenix", "ascended", "calm")),
    );
  });

  it("renders dark locked ink differently from light", () => {
    expect(renderSpirit("stag", "ascended", "locked", { dark: true })).not.toEqual(
      renderSpirit("stag", "ascended", "locked"),
    );
  });

  it("covers the whole season one roster", () => {
    expect(SPIRITS.map((spirit) => spirit.id)).toEqual(SPIRIT_IDS);
  });
});
