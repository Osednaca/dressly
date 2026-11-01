/**
 * Verifies the checked-in photographic V1 handbag and generates the demo portrait.
 *
 * Run: npm run gen:consultation-seed
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { ensureDemoCustomerPhoto } from "@/lib/agent/consultation-orchestrator";

const OUT_DIR = path.join(process.cwd(), "public", "catalog");
const OUT_FILE = path.join(OUT_DIR, "consultation-bag-v1.png");

async function main(): Promise<void> {
  await access(OUT_FILE);
  const demoPhotoUrl = await ensureDemoCustomerPhoto();
  console.log("Verified checked-in photographic handbag public/catalog/consultation-bag-v1.png");
  console.log(`Generated demo customer portrait (${demoPhotoUrl}, 900x1200)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
