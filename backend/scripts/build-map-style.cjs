// Writes tiles/style.json and tiles/style-dark.json: the Protomaps light and dark
// basemaps over tiles/lamdong.pmtiles.
// Reads the browser bundle of @protomaps/basemaps from tiles/lib (run fetch-map-assets.sh first).
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const tiles = path.join(__dirname, "..", "tiles");
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(tiles, "lib", "basemaps.js"), "utf8"), sandbox);
const { layers, namedFlavor } = sandbox.basemaps;

// Warm Sunrise: cream land, apricot roads, sand buildings, lime parks. Keys not
// listed here keep the Protomaps value.
const BRAND = {
  light: {
    background: "#fbf3e8",
    earth: "#fbf1e4",
    park_a: "#e3f3c1",
    park_b: "#cfe9a0",
    wood_a: "#d6ebb0",
    wood_b: "#c3e08f",
    scrub_a: "#e8f0c4",
    scrub_b: "#d9e8a8",
    water: "#bfe1ea",
    buildings: "#f3d9bf",
    school: "#f6e4c6",
    hospital: "#f8d8d0",
    pedestrian: "#f7ecd9",
    sand: "#f6e6c4",
    beach: "#f6e6c4",
    industrial: "#efe2cf",
    other: "#fbefdc",
    minor_service: "#fff7ec",
    minor_a: "#fff3e2",
    minor_b: "#ffffff",
    link: "#ffe2bd",
    major: "#ffe2bd",
    highway: "#ffc98a",
    minor_service_casing: "#efdcc2",
    minor_casing: "#efdcc2",
    link_casing: "#efc9a0",
    major_casing_early: "#efc9a0",
    major_casing_late: "#efc9a0",
    highway_casing_early: "#f0a860",
    highway_casing_late: "#f0a860",
    railway: "#c9b8a2",
    boundaries: "#e0b98f",
    landcover: {
      grassland: "rgba(223, 242, 183, 1)",
      barren: "rgba(250, 232, 200, 1)",
      urban_area: "rgba(247, 235, 218, 1)",
      farmland: "rgba(228, 241, 190, 1)",
      glacier: "rgba(255, 255, 255, 1)",
      scrub: "rgba(232, 240, 196, 1)",
      forest: "rgba(206, 232, 160, 1)",
    },
  },
  dark: {
    background: "#161210",
    earth: "#1d1915",
    park_a: "#26301c",
    park_b: "#2c3a20",
    wood_a: "#2a3620",
    wood_b: "#30401f",
    scrub_a: "#2a3020",
    scrub_b: "#303a22",
    water: "#1f3238",
    buildings: "#2e2620",
    school: "#2a231c",
    hospital: "#34231f",
    pedestrian: "#26211b",
    sand: "#2a241b",
    beach: "#2a241b",
    industrial: "#231e19",
    other: "#221d18",
    minor_service: "#2a241e",
    minor_a: "#3a3129",
    minor_b: "#463b30",
    link: "#5a4430",
    major: "#5a4430",
    highway: "#8a5527",
    minor_service_casing: "#171310",
    minor_casing: "#171310",
    link_casing: "#171310",
    major_casing_early: "#171310",
    major_casing_late: "#171310",
    highway_casing_early: "#171310",
    highway_casing_late: "#171310",
    railway: "#5a4a3a",
    boundaries: "#5a4a3a",
    landcover: {
      grassland: "rgba(38, 48, 28, 1)",
      barren: "rgba(42, 36, 27, 1)",
      urban_area: "rgba(34, 29, 24, 1)",
      farmland: "rgba(40, 50, 29, 1)",
      glacier: "rgba(60, 56, 50, 1)",
      scrub: "rgba(42, 48, 32, 1)",
      forest: "rgba(44, 58, 32, 1)",
    },
  },
};

function build(flavor) {
  return {
    version: 8,
    name: `Zenflow campus ${flavor}`,
    // Relative, resolved against the style URL by the map page.
    sources: {
      protomaps: { type: "vector", url: "pmtiles://lamdong.pmtiles", attribution: "© OpenStreetMap contributors" },
    },
    // No glyphs are served yet, so symbol (label) layers are left out.
    layers: layers("protomaps", { ...namedFlavor(flavor), ...BRAND[flavor] }, { lang: "en" }).filter((layer) => layer.type !== "symbol"),
  };
}

for (const [file, flavor] of [["style.json", "light"], ["style-dark.json", "dark"]]) {
  const style = build(flavor);
  fs.writeFileSync(path.join(tiles, file), JSON.stringify(style));
  console.log(`${file}: ${style.layers.length} layers`);
}
