/**
 * Catalog imagery pipeline.
 *
 * The catalog ships no photography, so Dressly generates a deterministic flat-lay set:
 * one clean, editorial garment render per product, in the product's own colour. These
 * images are used twice — as the product cards in the UI and as the garment reference
 * image sent to YouCam — so they must be real raster files, not SVG placeholders,
 * which is why sharp rasterises each render to PNG.
 *
 * Run: npm run gen:catalog
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { CATALOG } from "@/lib/catalog/products";
import type { Product } from "@/lib/types";

const OUT_DIR = path.join(process.cwd(), "public", "catalog");

/** Single lowercase colour token -> hex. Kept in sync with the catalog's own tokens. */
const COLORS: Record<string, { base: string; shade: string; line: string }> = {
  cream: { base: "#ece3d4", shade: "#dccfb9", line: "#b9a888" },
  white: { base: "#f6f5f2", shade: "#e4e1da", line: "#c2beb4" },
  ivory: { base: "#f2ecdf", shade: "#e2d8c4", line: "#bdae92" },
  champagne: { base: "#e8dcc2", shade: "#d8c7a3", line: "#b3a077" },
  sand: { base: "#d8c6a8", shade: "#c6b08d", line: "#a08a64" },
  camel: { base: "#c3a071", shade: "#b08c5c", line: "#8a6d43" },
  brown: { base: "#7c5636", shade: "#66452b", line: "#4a3220" },
  khaki: { base: "#b6a97c", shade: "#a1946a", line: "#7d7150" },
  olive: { base: "#6e6f45", shade: "#585a37", line: "#40422a" },
  navy: { base: "#2b3550", shade: "#212a41", line: "#171e30" },
  indigo: { base: "#3c4a6b", shade: "#303c58", line: "#232c42" },
  sky: { base: "#a9c3d6", shade: "#8fb0c9", line: "#6c8ea8" },
  emerald: { base: "#2f6b57", shade: "#255745", line: "#1a3f33" },
  stone: { base: "#b9b3a6", shade: "#a39d90", line: "#807a6e" },
  grey: { base: "#a6a6a6", shade: "#8f8f8f", line: "#6f6f6f" },
  graphite: { base: "#4b4d50", shade: "#3b3d40", line: "#2a2c2e" },
  charcoal: { base: "#3a3c3e", shade: "#2d2f31", line: "#202224" },
  black: { base: "#26262a", shade: "#1c1c20", line: "#121215" },
};

function palette(product: Product) {
  const key = product.colors[0] ?? "stone";
  return COLORS[key] ?? { base: "#b9b3a6", shade: "#a39d90", line: "#807a6e" };
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Shared editorial backdrop: warm paper, soft studio pool of light, contact shadow. */
function backdrop(): string {
  return `
  <defs>
    <radialGradient id="light" cx="50%" cy="34%" r="72%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#f7f4ee"/>
      <stop offset="1" stop-color="#ece7dd"/>
    </radialGradient>
    <linearGradient id="stitch" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1000" fill="url(#light)"/>
  <ellipse cx="400" cy="852" rx="190" ry="26" fill="#000" opacity="0.07"/>`;
}

function garment(product: Product): string {
  const c = palette(product);
  const stroke = `stroke="${c.line}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

  if (product.category === "upper_body") {
    return `
  <path d="M300 250 L300 205 Q400 168 500 205 L500 250 L560 280 L610 470 L548 492 L520 392 L520 760 Q400 800 280 760 L280 392 L252 492 L190 470 L240 280 Z"
    fill="${c.base}" ${stroke}/>
  <path d="M300 205 Q400 168 500 205 L500 250 Q400 210 300 250 Z" fill="${c.shade}" ${stroke}/>
  <path d="M400 220 L400 790" stroke="${c.line}" stroke-width="2.4" opacity="0.7"/>
  <path d="M310 300 L310 740 M490 300 L490 740" stroke="${c.line}" stroke-width="2" opacity="0.35"/>`;
  }

  if (product.category === "lower_body") {
    if (product.subcategory === "skirt") {
      return `
  <path d="M300 250 L500 250 L600 800 Q400 830 200 800 Z" fill="${c.base}" ${stroke}/>
  <path d="M300 250 L500 250 L512 300 L288 300 Z" fill="${c.shade}" ${stroke}/>
  <path d="M340 320 L300 790 M400 320 L400 812 M460 320 L500 790" stroke="${c.line}" stroke-width="2" opacity="0.3"/>`;
    }
    if (product.subcategory === "shorts") {
      return `
  <path d="M280 250 L520 250 L536 560 L420 560 L400 400 L380 560 L264 560 Z" fill="${c.base}" ${stroke}/>
  <path d="M280 250 L520 250 L522 300 L278 300 Z" fill="${c.shade}" ${stroke}/>
  <path d="M400 300 L400 400" stroke="${c.line}" stroke-width="2.4" opacity="0.6"/>`;
    }
    return `
  <path d="M280 250 L520 250 L548 820 L420 820 L400 430 L380 820 L252 820 Z" fill="${c.base}" ${stroke}/>
  <path d="M280 250 L520 250 L524 310 L276 310 Z" fill="${c.shade}" ${stroke}/>
  <path d="M400 310 L400 430" stroke="${c.line}" stroke-width="2.6" opacity="0.65"/>
  <path d="M300 340 L286 800 M500 340 L514 800" stroke="${c.line}" stroke-width="2" opacity="0.28"/>`;
  }

  if (product.category === "outer") {
    return `
  <path d="M292 248 L292 200 Q400 164 508 200 L508 248 L576 282 L626 486 L560 508 L528 404 L528 780 Q400 820 272 780 L272 404 L240 508 L174 486 L224 282 Z"
    fill="${c.base}" ${stroke}/>
  <path d="M400 214 L400 800" stroke="${c.line}" stroke-width="3.4" opacity="0.85"/>
  <path d="M360 220 L400 300 L440 220" fill="${c.shade}" ${stroke}/>
  <path d="M400 300 L400 800" stroke="${c.shade}" stroke-width="7" opacity="0.6"/>`;
  }

  if (product.category === "shoes") {
    return `
  <path d="M170 660 Q180 596 250 590 L360 566 Q420 552 470 590 L560 626 Q612 646 626 686 Q632 716 596 722 L196 722 Q158 720 160 690 Z"
    fill="${c.base}" ${stroke}/>
  <path d="M170 664 L624 664" stroke="${c.line}" stroke-width="2.4" opacity="0.4"/>
  <path d="M250 590 Q300 636 360 566" fill="${c.shade}" ${stroke}/>
  <path d="M164 700 L622 700" stroke="#111" stroke-width="10" opacity="0.75" stroke-linecap="round"/>`;
  }

  // accessory
  if (product.subcategory === "bag") {
    return `
  <path d="M240 360 L560 360 L596 780 L204 780 Z" fill="${c.base}" ${stroke}/>
  <path d="M320 360 Q320 250 400 250 Q480 250 480 360" fill="none" stroke="${c.line}" stroke-width="14"/>
  <path d="M240 420 L560 420" stroke="${c.line}" stroke-width="2.4" opacity="0.4"/>`;
  }
  if (product.subcategory === "scarf") {
    return `
  <path d="M300 300 L500 300 L540 700 L460 700 L440 420 L400 700 L300 700 Z" fill="${c.base}" ${stroke}/>
  <path d="M320 360 L480 360 M330 440 L470 440 M340 520 L460 520" stroke="${c.line}" stroke-width="3" opacity="0.45"/>`;
  }
  return `
  <rect x="180" y="470" width="440" height="68" rx="16" fill="${c.base}" ${stroke}/>
  <rect x="352" y="440" width="96" height="128" rx="14" fill="${c.shade}" ${stroke}/>
  <rect x="376" y="470" width="48" height="68" rx="8" fill="none" stroke="${c.line}" stroke-width="6"/>`;
}

function label(product: Product): string {
  return `
  <text x="400" y="910" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="30" fill="#1b1a18">${esc(
    product.name,
  )}</text>
  <text x="400" y="946" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" letter-spacing="3" fill="#8a8378">${esc(
    product.brand.toUpperCase(),
  )}</text>`;
}

function renderSvg(product: Product): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
${backdrop()}
${garment(product)}
${label(product)}
</svg>`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  let count = 0;
  for (const product of CATALOG) {
    const fileName = path.basename(product.image);
    const svg = renderSvg(product);
    const png = await sharp(Buffer.from(svg, "utf8"), { density: 200 })
      .resize(800, 1000, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(path.join(OUT_DIR, fileName), png);
    count += 1;
  }
  // Also expose a small helper for anyone debugging the pipeline by hand.
  await writeFile(
    path.join(OUT_DIR, "_manifest.json"),
    JSON.stringify({ generated: new Date().toISOString(), count }, null, 2),
  );
  console.log(`Generated ${count} catalog images into public/catalog/`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
