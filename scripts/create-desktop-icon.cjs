const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const pngToIco = require("png-to-ico");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const sourceIcon = path.join(projectRoot, "public", "pwa-512.svg");
const outputDirectory = path.join(projectRoot, "build");
const outputIcon = path.join(outputDirectory, "icon.ico");
const temporaryPng = path.join(outputDirectory, "icon.png");

const createIcon = async () => {
  mkdirSync(outputDirectory, { recursive: true });
  try {
    await sharp(sourceIcon).resize(256, 256).png().toFile(temporaryPng);
    writeFileSync(outputIcon, await pngToIco(temporaryPng));
  } finally {
    rmSync(temporaryPng, { force: true });
  }
};

void createIcon();
