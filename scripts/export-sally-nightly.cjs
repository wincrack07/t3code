const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const root = path.resolve("assets/nightly");
const sally = path.join(root, "app-icon.icon/Assets/sally.svg");
async function icon(base, mac = false) {
  const size = mac ? 360 : 445;
  const overlay = await sharp(sally).resize(size, size).png().toBuffer();
  const source = path.join(root, "source", base);
  const alpha = await sharp(source).extractChannel("alpha").png().toBuffer();
  const mask = await sharp(alpha).joinChannel(alpha).png().toBuffer();
  const layer = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: "#00000000" },
  })
    .composite([
      { input: overlay, left: mac ? 555 : 550, top: mac ? 550 : 580 },
      { input: mask, blend: "dest-in" },
    ])
    .png()
    .toBuffer();
  return sharp(source)
    .composite([{ input: layer }])
    .png()
    .toBuffer();
}
async function ico(buffers, filename) {
  let offset = 6 + buffers.length * 16;
  const header = Buffer.alloc(offset);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(buffers.length, 4);
  buffers.forEach(([size, buffer], i) => {
    const p = 6 + i * 16;
    header[p] = size === 256 ? 0 : size;
    header[p + 1] = header[p];
    header.writeUInt16LE(1, p + 4);
    header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(buffer.length, p + 8);
    header.writeUInt32LE(offset, p + 12);
    offset += buffer.length;
  });
  fs.writeFileSync(path.join(root, filename), Buffer.concat([header, ...buffers.map((x) => x[1])]));
}
async function main() {
  const universal = await icon("base-universal.png");
  fs.writeFileSync(path.join(root, "nightly-universal-1024.png"), universal);
  fs.writeFileSync(path.join(root, "nightly-macos-1024.png"), await icon("base-macos.png", true));
  fs.writeFileSync(path.join(root, "nightly-ios-1024.png"), await icon("base-ios.png"));
  const png = async (size) => sharp(universal).resize(size, size).png().toBuffer();
  for (const [size, name] of [
    [16, "favicon-16x16"],
    [32, "favicon-32x32"],
    [180, "apple-touch-180"],
    [192, "icon-192x192"],
    [512, "icon-512x512"],
  ])
    fs.writeFileSync(path.join(root, `nightly-web-${name}.png`), await png(size));
  await ico(
    await Promise.all([16, 32].map(async (n) => [n, await png(n)])),
    "nightly-web-favicon.ico",
  );
  await ico(
    await Promise.all([16, 32, 48, 64, 128, 256].map(async (n) => [n, await png(n)])),
    "nightly-windows.ico",
  );
  fs.mkdirSync("/tmp/sally-previews", { recursive: true });
  for (const n of [1024, 128, 32, 16])
    fs.writeFileSync(`/tmp/sally-previews/icon-${n}.png`, await png(n));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
