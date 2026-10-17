/**
 * Generates the canonical V1 studio handbag asset for Dressly Live Consultation.
 *
 * Run: npm run gen:consultation-seed
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ensureDemoCustomerPhoto } from "@/lib/agent/consultation-orchestrator";
import { renderStudioBagSvg } from "@/lib/catalog/bag-svg";
import { DEFAULT_BAG_DESIGN_STATE } from "@/lib/types";

const OUT_DIR = path.join(process.cwd(), "public", "catalog");
const OUT_FILE = path.join(OUT_DIR, "consultation-bag-v1.png");

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const svg = renderStudioBagSvg(DEFAULT_BAG_DESIGN_STATE, {
    versionLabel: "V1 Original",
  });
  await sharp(Buffer.from(svg, "utf8"), { density: 200 })
    .resize(896, 1200, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(OUT_FILE);
  const demoPhotoUrl = await ensureDemoCustomerPhoto();
  console.log("Generated public/catalog/consultation-bag-v1.png (896x1200)");
  console.log(`Generated demo customer portrait (${demoPhotoUrl}, 900x1200)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
