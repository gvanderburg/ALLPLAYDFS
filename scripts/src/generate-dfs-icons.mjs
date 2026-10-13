import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// Reproducible, dependency-free PNG app icons matching slate-icon.svg.
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function chunk(type, data) {
  const label = Buffer.from(type);
  const payload = Buffer.concat([label, data]);
  let crc = 0xffffffff;
  for (const byte of payload) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const header = Buffer.alloc(4);
  const footer = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, footer]);
}
function insideMint(x, y) {
  const dx = Math.max(Math.abs(x - 256) - 84, 0);
  const dy = Math.max(Math.abs(y - 256) - 84, 0);
  return dx * dx + dy * dy <= 92 * 92;
}
const line = [[140, 276], [194, 276], [223, 197], [281, 357], [318, 260], [372, 260]];
function onLine(x, y) {
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    if ((x - ax - t * (bx - ax)) ** 2 + (y - ay - t * (by - ay)) ** 2 <= 225) return true;
  }
  return false;
}
mkdirSync("artifacts/dfs-dashboard/public/icons", { recursive: true });
for (const size of [192, 512]) {
  const pixels = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) * 512 / size;
      const py = (y + 0.5) * 512 / size;
      const color = onLine(px, py) ? [16, 32, 25] : insideMint(px, py) ? [75, 211, 160] : [16, 20, 29];
      const offset = y * (1 + size * 4) + 1 + x * 4;
      pixels.set([...color, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(`artifacts/dfs-dashboard/public/icons/icon-${size}.png`, png);
}
