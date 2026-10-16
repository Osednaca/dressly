import type { BagDesignState } from "@/lib/types";

interface LeatherPalette {
  base: string;
  Highlight: string;
  panelShade: string;
  gusset: string;
  edgePaint: string;
  stitch: string;
}

interface HardwarePalette {
  light: string;
  mid: string;
  dark: string;
  rim: string;
}

const LEATHER_PALETTES: Record<string, LeatherPalette> = {
  burgundy: {
    base: "#5d1b26",
    Highlight: "#7b2836",
    panelShade: "#47131c",
    gusset: "#390e16",
    edgePaint: "#26080e",
    stitch: "#823542",
  },
  espresso: {
    base: "#3c2419",
    Highlight: "#523324",
    panelShade: "#2d1a12",
    gusset: "#22130d",
    edgePaint: "#170c08",
    stitch: "#634130",
  },
  brown: {
    base: "#5b3724",
    Highlight: "#734831",
    panelShade: "#46291a",
    gusset: "#361f13",
    edgePaint: "#24130b",
    stitch: "#82553d",
  },
  tan: {
    base: "#9e6b43",
    Highlight: "#b58056",
    panelShade: "#825532",
    gusset: "#6b4426",
    edgePaint: "#472b16",
    stitch: "#c2926b",
  },
  camel: {
    base: "#b48756",
    Highlight: "#c99c6b",
    panelShade: "#966d41",
    gusset: "#7c5832",
    edgePaint: "#54391e",
    stitch: "#d6ad80",
  },
  black: {
    base: "#1f1f23",
    Highlight: "#323238",
    panelShade: "#161619",
    gusset: "#101013",
    edgePaint: "#09090b",
    stitch: "#3b3b42",
  },
  cream: {
    base: "#e8dfd1",
    Highlight: "#f4eee4",
    panelShade: "#d4c8b6",
    gusset: "#bfb19d",
    edgePaint: "#8c7e6b",
    stitch: "#f7f3ec",
  },
  olive: {
    base: "#4c5238",
    Highlight: "#616849",
    panelShade: "#3a3f2a",
    gusset: "#2c301f",
    edgePaint: "#1c1f13",
    stitch: "#707757",
  },
  emerald: {
    base: "#1f4e3d",
    Highlight: "#2b6651",
    panelShade: "#163b2e",
    gusset: "#102c22",
    edgePaint: "#0a1c15",
    stitch: "#387a62",
  },
  navy: {
    base: "#1f2a44",
    Highlight: "#2d3c5e",
    panelShade: "#161f33",
    gusset: "#101726",
    edgePaint: "#0a0e18",
    stitch: "#3d4f78",
  },
  stone: {
    base: "#9e9689",
    Highlight: "#b3ab9e",
    panelShade: "#857d71",
    gusset: "#6e675c",
    edgePaint: "#4d473f",
    stitch: "#c2bab0",
  },
};

const HARDWARE_PALETTES: Record<string, HardwarePalette> = {
  silver: {
    light: "#f7f9fc",
    mid: "#c7cdd6",
    dark: "#7d848f",
    rim: "#585e68",
  },
  gold: {
    light: "#fff3c4",
    mid: "#d7ad59",
    dark: "#946c22",
    rim: "#6b4c14",
  },
  brass: {
    light: "#f5e3a9",
    mid: "#c29846",
    dark: "#7d5d1b",
    rim: "#573f10",
  },
  gunmetal: {
    light: "#8c929c",
    mid: "#525761",
    dark: "#2d3036",
    rim: "#1b1d21",
  },
};

function resolveLeatherPalette(primaryColor: string): LeatherPalette {
  const normalized = primaryColor.toLowerCase().trim();
  if (normalized.includes("espresso") || normalized.includes("dark brown") || normalized.includes("chocolate")) {
    return LEATHER_PALETTES.espresso!;
  }
  if (normalized.includes("burgundy") || normalized.includes("oxblood") || normalized.includes("wine") || normalized.includes("maroon")) {
    return LEATHER_PALETTES.burgundy!;
  }
  if (normalized.includes("tan") || normalized.includes("cognac") || normalized.includes("saddle")) {
    return LEATHER_PALETTES.tan!;
  }
  if (normalized.includes("camel") || normalized.includes("sand") || normalized.includes("amber")) {
    return LEATHER_PALETTES.camel!;
  }
  if (normalized.includes("brown") || normalized.includes("chestnut")) {
    return LEATHER_PALETTES.brown!;
  }
  if (normalized.includes("black") || normalized.includes("onyx") || normalized.includes("charcoal")) {
    return LEATHER_PALETTES.black!;
  }
  if (normalized.includes("cream") || normalized.includes("ivory") || normalized.includes("white") || normalized.includes("bone")) {
    return LEATHER_PALETTES.cream!;
  }
  if (normalized.includes("olive") || normalized.includes("khaki") || normalized.includes("sage")) {
    return LEATHER_PALETTES.olive!;
  }
  if (normalized.includes("emerald") || normalized.includes("forest") || normalized.includes("green")) {
    return LEATHER_PALETTES.emerald!;
  }
  if (normalized.includes("navy") || normalized.includes("midnight") || normalized.includes("blue")) {
    return LEATHER_PALETTES.navy!;
  }
  if (normalized.includes("stone") || normalized.includes("taupe") || normalized.includes("grey") || normalized.includes("gray")) {
    return LEATHER_PALETTES.stone!;
  }
  return LEATHER_PALETTES.burgundy!;
}

function resolveHardwarePalette(hardwareColor: string): HardwarePalette {
  const normalized = hardwareColor.toLowerCase().trim();
  if (normalized.includes("gold") || normalized.includes("champagne")) {
    return HARDWARE_PALETTES.gold!;
  }
  if (normalized.includes("brass") || normalized.includes("bronze") || normalized.includes("antique")) {
    return HARDWARE_PALETTES.brass!;
  }
  if (normalized.includes("gunmetal") || normalized.includes("black") || normalized.includes("dark")) {
    return HARDWARE_PALETTES.gunmetal!;
  }
  return HARDWARE_PALETTES.silver!;
}

function resolveSizeScale(size: string): number {
  const normalized = size.toLowerCase().trim();
  if (normalized.includes("mini") || normalized.includes("micro")) return 0.78;
  if (normalized.includes("small") || normalized.includes("compact")) return 0.86;
  if (normalized.includes("large") || normalized.includes("oversized") || normalized.includes("tote")) return 1.12;
  return 1.0;
}

function isCrossbodyOrLongStrap(state: BagDesignState): boolean {
  const combined = `${state.strapType} ${state.strapLength}`.toLowerCase();
  return (
    combined.includes("crossbody") ||
    combined.includes("cross-body") ||
    combined.includes("long") ||
    combined.includes("extended")
  );
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders a clean 896x1200 (3:4 portrait) isolated studio SVG of the handbag
 * reflecting `state.primaryColor`, `state.hardwareColor`, `state.size`, and
 * `state.strapType` / `state.strapLength`.
 *
 * Uses a neutral `#f3efe9` studio background with zero text watermarks in the
 * product frame so it serves both LookStage display and YouCam VTO cleanly.
 */
export function renderStudioBagSvg(
  state: BagDesignState,
  options?: { versionLabel?: string },
): string {
  const leather = resolveLeatherPalette(state.primaryColor);
  const hw = resolveHardwarePalette(state.hardwareColor);
  const scale = resolveSizeScale(state.size);
  const longStrap = isCrossbodyOrLongStrap(state);
  const pebbled = state.texture.toLowerCase().includes("pebble") || state.texture.toLowerCase().includes("grain");

  // Center of the bag body
  const cx = 448;
  const cy = 690;

  const bodyW = Math.round(430 * scale);
  const bodyH = Math.round(285 * scale);
  const gussetW = Math.round(38 * scale);

  const left = Math.round(cx - bodyW / 2);
  const right = Math.round(cx + bodyW / 2);
  const top = Math.round(cy - bodyH / 2);
  const bottom = Math.round(cy + bodyH / 2);
  const flapBottom = Math.round(top + bodyH * 0.54);

  // D-ring anchors near top outer edges of the bag
  const leftAnchorX = left + Math.round(46 * scale);
  const rightAnchorX = right - Math.round(46 * scale);
  const anchorY = top + 6;

  // Strap arch apex
  const strapPeakY = longStrap ? Math.max(115, top - Math.round(405 * scale)) : Math.max(220, top - Math.round(240 * scale));
  const strapWidth = Math.max(16, Math.round(22 * scale));

  // Clasp dimensions
  const claspW = Math.round(58 * scale);
  const claspH = Math.round(66 * scale);
  const claspX = Math.round(cx - claspW / 2);
  const claspY = Math.round(flapBottom - claspH * 0.58);

  // Buckle on left strap when crossbody/long
  const buckleX = Math.round(leftAnchorX - 16 * scale);
  const buckleY = Math.round(strapPeakY + (anchorY - strapPeakY) * 0.56);

  const metaDesc = options?.versionLabel
    ? `${options.versionLabel} — ${state.name} (${state.primaryColor}, ${state.hardwareColor} hardware, ${state.size}, ${state.strapType})`
    : `${state.name} (${state.primaryColor}, ${state.hardwareColor} hardware, ${state.size}, ${state.strapType})`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="896" height="1200" viewBox="0 0 896 1200">
  <desc>${esc(metaDesc)}</desc>
  <defs>
    <radialGradient id="studioBg" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="#faf7f2"/>
      <stop offset="60%" stop-color="#f3efe9"/>
      <stop offset="100%" stop-color="#e7e1d8"/>
    </radialGradient>
    <radialGradient id="contactShadow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1a1512" stop-opacity="0.28"/>
      <stop offset="55%" stop-color="#1a1512" stop-opacity="0.11"/>
      <stop offset="100%" stop-color="#1a1512" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="leatherBody" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${leather.Highlight}"/>
      <stop offset="48%" stop-color="${leather.base}"/>
      <stop offset="100%" stop-color="${leather.panelShade}"/>
    </linearGradient>
    <linearGradient id="leatherFlap" x1="15%" y1="0%" x2="85%" y2="100%">
      <stop offset="0%" stop-color="${leather.Highlight}"/>
      <stop offset="58%" stop-color="${leather.base}"/>
      <stop offset="100%" stop-color="${leather.panelShade}"/>
    </linearGradient>
    <linearGradient id="leatherGusset" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${leather.gusset}"/>
      <stop offset="100%" stop-color="${leather.panelShade}"/>
    </linearGradient>
    <linearGradient id="hardwareGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${hw.light}"/>
      <stop offset="45%" stop-color="${hw.mid}"/>
      <stop offset="85%" stop-color="${hw.dark}"/>
      <stop offset="100%" stop-color="${hw.light}"/>
    </linearGradient>
    <pattern id="leatherGrain" width="12" height="12" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="${pebbled ? "1.3" : "0.6"}" fill="#ffffff" fill-opacity="${pebbled ? "0.06" : "0.025"}"/>
      <circle cx="9" cy="8" r="${pebbled ? "1.4" : "0.7"}" fill="#000000" fill-opacity="${pebbled ? "0.08" : "0.03"}"/>
    </pattern>
  </defs>

  <!-- Neutral studio background -->
  <rect width="896" height="1200" fill="url(#studioBg)"/>

  <!-- Grounded studio contact shadow -->
  <ellipse cx="${cx}" cy="${bottom + 36}" rx="${Math.round(bodyW * 0.56)}" ry="34" fill="url(#contactShadow)"/>

  <!-- Strap shadow & leather strap arch -->
  <path d="M ${leftAnchorX} ${anchorY} C ${leftAnchorX - Math.round(34 * scale)} ${strapPeakY}, ${rightAnchorX + Math.round(34 * scale)} ${strapPeakY}, ${rightAnchorX} ${anchorY}"
    fill="none" stroke="${leather.edgePaint}" stroke-width="${strapWidth + 6}" stroke-linecap="round"/>
  <path d="M ${leftAnchorX} ${anchorY} C ${leftAnchorX - Math.round(34 * scale)} ${strapPeakY}, ${rightAnchorX + Math.round(34 * scale)} ${strapPeakY}, ${rightAnchorX} ${anchorY}"
    fill="none" stroke="url(#leatherBody)" stroke-width="${strapWidth}" stroke-linecap="round"/>
  <path d="M ${leftAnchorX} ${anchorY} C ${leftAnchorX - Math.round(34 * scale)} ${strapPeakY}, ${rightAnchorX + Math.round(34 * scale)} ${strapPeakY}, ${rightAnchorX} ${anchorY}"
    fill="none" stroke="${leather.stitch}" stroke-width="1.6" stroke-dasharray="6 5" opacity="0.75"/>

  ${
    longStrap
      ? `<!-- Crossbody adjustable buckle detail -->
  <rect x="${buckleX - 16}" y="${buckleY - 14}" width="32" height="28" rx="6" fill="url(#hardwareGrad)" stroke="${hw.rim}" stroke-width="2"/>
  <rect x="${buckleX - 9}" y="${buckleY - 8}" width="18" height="16" rx="3" fill="${leather.base}" stroke="${hw.rim}" stroke-width="1.5"/>
  <line x1="${buckleX}" y1="${buckleY - 14}" x2="${buckleX}" y2="${buckleY + 14}" stroke="${hw.rim}" stroke-width="2.5"/>`
      : ""
  }

  <!-- D-Ring Hardware Mounts -->
  <rect x="${leftAnchorX - 18}" y="${anchorY - 16}" width="36" height="24" rx="8" fill="url(#hardwareGrad)" stroke="${hw.rim}" stroke-width="2"/>
  <rect x="${leftAnchorX - 11}" y="${anchorY - 10}" width="22" height="12" rx="4" fill="#f3efe9"/>
  <rect x="${rightAnchorX - 18}" y="${anchorY - 16}" width="36" height="24" rx="8" fill="url(#hardwareGrad)" stroke="${hw.rim}" stroke-width="2"/>
  <rect x="${rightAnchorX - 11}" y="${anchorY - 10}" width="22" height="12" rx="4" fill="#f3efe9"/>

  <!-- Left 3D box-gusset side panel -->
  <path d="M ${left} ${top + 14} L ${left - gussetW} ${top + 32} L ${left - gussetW + 6} ${bottom - 18} L ${left} ${bottom} Z"
    fill="url(#leatherGusset)" stroke="${leather.edgePaint}" stroke-width="3" stroke-linejoin="round"/>

  <!-- Main structured rectangular bag body -->
  <rect x="${left}" y="${top}" width="${bodyW}" height="${bodyH}" rx="22"
    fill="url(#leatherBody)" stroke="${leather.edgePaint}" stroke-width="4"/>
  <rect x="${left}" y="${top}" width="${bodyW}" height="${bodyH}" rx="22"
    fill="url(#leatherGrain)"/>

  <!-- Perimeter saddle stitching on body -->
  <rect x="${left + 12}" y="${top + 12}" width="${bodyW - 24}" height="${bodyH - 24}" rx="15"
    fill="none" stroke="${leather.stitch}" stroke-width="2" stroke-dasharray="7 5" opacity="0.8"/>

  <!-- Drop shadow beneath front flap -->
  <path d="M ${left + 4} ${top + 18} L ${right - 4} ${top + 18} L ${right - 14} ${flapBottom + 12} Q ${cx} ${flapBottom + 32} ${left + 14} ${flapBottom + 12} Z"
    fill="#000000" opacity="0.22"/>

  <!-- Structured Front Flap -->
  <path d="M ${left + 2} ${top + 4} Q ${cx} ${top - 6} ${right - 2} ${top + 4} L ${right - 10} ${flapBottom - 12} Q ${right - 12} ${flapBottom + 8} ${right - 34} ${flapBottom + 10} L ${left + 34} ${flapBottom + 10} Q ${left + 12} ${flapBottom + 8} ${left + 10} ${flapBottom - 12} Z"
    fill="url(#leatherFlap)" stroke="${leather.edgePaint}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M ${left + 2} ${top + 4} Q ${cx} ${top - 6} ${right - 2} ${top + 4} L ${right - 10} ${flapBottom - 12} Q ${right - 12} ${flapBottom + 8} ${right - 34} ${flapBottom + 10} L ${left + 34} ${flapBottom + 10} Q ${left + 12} ${flapBottom + 8} ${left + 10} ${flapBottom - 12} Z"
    fill="url(#leatherGrain)"/>

  <!-- Flap tonal saddle stitching -->
  <path d="M ${left + 14} ${top + 15} Q ${cx} ${top + 7} ${right - 14} ${top + 15} L ${right - 21} ${flapBottom - 14} Q ${right - 23} ${flapBottom - 1} ${right - 38} ${flapBottom} L ${left + 38} ${flapBottom} Q ${left + 23} ${flapBottom - 1} ${left + 21} ${flapBottom - 14} Z"
    fill="none" stroke="${leather.stitch}" stroke-width="2" stroke-dasharray="7 5" opacity="0.85"/>

  <!-- Leather strap tab above clasp -->
  <rect x="${cx - Math.round(20 * scale)}" y="${top + Math.round(18 * scale)}" width="${Math.round(40 * scale)}" height="${Math.round(flapBottom - top - 12 * scale)}" rx="10"
    fill="url(#leatherBody)" stroke="${leather.edgePaint}" stroke-width="2.5"/>

  <!-- Geometric Magnetic Clasp Hardware -->
  <rect x="${claspX}" y="${claspY}" width="${claspW}" height="${claspH}" rx="10"
    fill="url(#hardwareGrad)" stroke="${hw.rim}" stroke-width="2.5"/>
  <rect x="${claspX + 9}" y="${claspY + 9}" width="${claspW - 18}" height="${claspH - 18}" rx="6"
    fill="none" stroke="${hw.rim}" stroke-width="1.6" opacity="0.75"/>
  <circle cx="${cx}" cy="${claspY + Math.round(claspH * 0.5)}" r="${Math.max(5, Math.round(7 * scale))}"
    fill="${hw.dark}" stroke="${hw.light}" stroke-width="1.5"/>
</svg>`;
}
