// Store-upload packaging. `pnpm --filter @crossy/extension package` builds both
// variants (dist/ Chrome, dist-firefox/ Firefox) and writes two upload-ready zips
// under artifacts/: crossy-chrome-<version>.zip and crossy-firefox-<version>.zip,
// versioned from public/manifest.json. Each zip has the manifest at its root, the
// form the Chrome Web Store and AMO both expect.
//
// The archives are byte-deterministic: entries are sorted by name, every timestamp
// is pinned to 1980-01-01 (the earliest the zip format encodes), and the STORE
// method carries the raw file bytes (no compression, so no zlib-version drift). A
// re-run on an unchanged tree yields identical bytes on any machine, matching the
// repo's fresh-clone reproducibility gate. No npm dependency: a hand-rolled CRC-32
// and a minimal zip writer keep this plain node, like build-firefox.mjs beside it.
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

/** Standard CRC-32 (polynomial 0xEDB88320), table-built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Fixed DOS date/time: 1980-01-01 00:00:00. Date field packs (year-1980)<<9 |
// month<<5 | day, so 1980-01-01 is 0x0021; the time field is 0.
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/** Every file under `dir`, as {full, name} with forward-slashed names, sorted. */
function listEntries(dir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  return files
    .map((full) => ({ full, name: relative(dir, full).split(sep).join("/") }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Zip the tree at `dir` (files only, STORE method, fixed timestamps) into one Buffer. */
function zipStore(dir) {
  const parts = [];
  const centrals = [];
  let offset = 0;

  for (const { full, name } of listEntries(dir)) {
    const data = readFileSync(full);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(0, 6); // general purpose flags
    local.writeUInt16LE(0, 8); // compression method: store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size == uncompressed (store)
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(local, 30);
    parts.push(local, data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: store
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // this disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(centrals.length, 8); // entries on this disk
  eocd.writeUInt16LE(centrals.length, 10); // total entries
  eocd.writeUInt32LE(centralDir.length, 12); // central directory size
  eocd.writeUInt32LE(offset, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, centralDir, eocd]);
}

const { version } = JSON.parse(readFileSync("public/manifest.json", "utf8"));
const outDir = "artifacts";
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const [build, label] of [
  ["dist", "chrome"],
  ["dist-firefox", "firefox"],
]) {
  const zip = zipStore(build);
  const out = join(outDir, `crossy-${label}-${version}.zip`);
  writeFileSync(out, zip);
  console.log(`${out} (${zip.length} bytes from ${build}/)`);
}
