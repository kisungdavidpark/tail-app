import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, "../src-tauri/icons/logr-source.svg");
const svg = readFileSync(svgPath, "utf-8");

const sizes = [
  { name: "32x32.png",       size: 32  },
  { name: "128x128.png",     size: 128 },
  { name: "128x128@2x.png",  size: 256 },
  { name: "icon.png",        size: 1024 },
  // Windows Square logos
  { name: "Square30x30Logo.png",   size: 30  },
  { name: "Square44x44Logo.png",   size: 44  },
  { name: "Square71x71Logo.png",   size: 71  },
  { name: "Square89x89Logo.png",   size: 89  },
  { name: "Square107x107Logo.png", size: 107 },
  { name: "Square142x142Logo.png", size: 142 },
  { name: "Square150x150Logo.png", size: 150 },
  { name: "Square284x284Logo.png", size: 284 },
  { name: "Square310x310Logo.png", size: 310 },
  { name: "StoreLogo.png",         size: 50  },
];

const iconsDir = join(__dirname, "../src-tauri/icons");

for (const { name, size } of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  });
  const png = resvg.render().asPng();
  const outPath = join(iconsDir, name);
  writeFileSync(outPath, png);
  console.log(`✓ ${name} (${size}px)`);
}

// icon.png를 tauri icon 커맨드로 ICNS/ICO도 생성하도록 안내
console.log("\n✓ PNG icons generated.");
console.log("  ICNS/ICO 생성: npm run tauri icon src-tauri/icons/icon.png");
