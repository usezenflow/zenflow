// Joins command-palette/*.html (sorted by name) into command-palette.html. Edit the parts, then run this.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("./command-palette/", import.meta.url);
const html = readdirSync(dir).filter((f) => f.endsWith(".html")).sort().map((f) => readFileSync(new URL(f, dir), "utf8")).join("");
writeFileSync(new URL("./command-palette.html", import.meta.url), html);
