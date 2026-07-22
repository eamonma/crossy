// Build a plausible solved 15x15 with a standard symmetric block pattern, real fill,
// clue numbers, and per-cell writer attribution across five solvers. Emits JSON the
// HTML mockups embed verbatim so every direction renders the same believable board.

const COLS = 15,
  ROWS = 15;

// A symmetric American-style block layout (rotationally symmetric). '#' = block.
const layout = [
  "....#.....#....",
  "....#.....#....",
  "....#.....#....",
  "...#....#...#..",
  "######...#.....",
  "....#...#......",
  "...#....#.....#",
  "..#.....#.....#", // will be fixed for symmetry below
  "#.....#....#...",
  "......#...#....",
  ".....#...######",
  "..#...#....#...",
  "....#.....#....",
  "....#.....#....",
  "....#.....#....",
];

// Rather than fight symmetry by hand, build blocks from a clean hand-picked set that is
// rotationally symmetric and gives good word lengths.
const blocks = new Set();
const B = (r, c) => blocks.add(r * COLS + c);
// Top-left region + its 180deg mirror added automatically.
const seeds = [
  [0, 4],
  [0, 10],
  [1, 4],
  [1, 10],
  [2, 4],
  [2, 10],
  [3, 3],
  [3, 8],
  [3, 12],
  [4, 0],
  [4, 1],
  [4, 2],
  [4, 9],
  [5, 4],
  [5, 8],
  [6, 3],
  [6, 8],
  [6, 14],
  [7, 2],
  [7, 7],
  [7, 12],
];
for (const [r, c] of seeds) {
  B(r, c);
  B(ROWS - 1 - r, COLS - 1 - c); // symmetric partner
}

// Solution letters. Hand-authored across the open cells so words read as real-ish fill.
// We lay a full letter grid, then blank the blocks. Good enough to read as a crossword.
const rowsText = [
  "MESAS#GLEAM#ARIA", // 16 -> trim; we recompute below
];

// Simpler: fill every non-block cell deterministically with a themed letter bank that
// still spells common short answers across rows. We author row strings of length 15,
// using '#' where a block sits, and letters elsewhere, matching the block set above.
const solutionRows = [
  "ARCS#SPACE#EAME",
  "LOOP#PANTON#RIS",
  "SEAT#ATONED#GEO",
  "ORE#LODE#WANE#N", // placeholders; corrected programmatically
];

// The above hand-authoring is error-prone. Deterministically synthesize letters instead:
// each open cell gets a letter chosen so the board looks like dense fill. We seed from a
// word bank per row start but the visual only needs plausible glyph density, not a valid
// crossword solve. Use a fixed pseudo-fill that avoids obvious repetition.
// Fill each ACROSS run with a real word of that length from a bank, so every across
// answer reads as English. Down crossings fall where they may (a mockup only needs the
// across pass to scan as real fill; down gibberish is invisible at board scale).
const wordsByLen = {
  2: [
    "AS",
    "ON",
    "OR",
    "ID",
    "EL",
    "GO",
    "HI",
    "AT",
    "BE",
    "NO",
    "UP",
    "MU",
    "AH",
    "OS",
  ],
  3: [
    "ARC",
    "SEA",
    "ODE",
    "NOVA".slice(0, 3),
    "ORB",
    "EAR",
    "ONE",
    "TEA",
    "RAY",
    "ION",
    "ELM",
    "OWL",
    "AIR",
    "GEM",
    "SUN",
  ],
  4: [
    "MESA",
    "GLOW",
    "AURA",
    "NEON",
    "ECHO",
    "LOOM",
    "ORBS",
    "EAME",
    "STAR",
    "MOON",
    "GLEE",
    "ARIA",
    "LUNA",
    "OPAL",
  ],
  5: [
    "SPACE",
    "GLEAM",
    "EAMES",
    "ORBIT",
    "COMET",
    "LUNAR",
    "GLIDE",
    "AURAL",
    "MESAS",
    "PANEL",
    "ATOMS",
    "SOLAR",
  ],
  6: [
    "PANTON",
    "ATONED",
    "GALAXY",
    "NEBULA",
    "COSMOS",
    "METEOR",
    "ROCKET",
    "STELLA",
    "LAUNCH",
    "ASTRAL",
  ],
  7: [
    "STARLIT",
    "ECLIPSE",
    "ORBITAL",
    "AIRLOCK",
    "GRAVITY",
    "SPUTNIK",
    "STATION",
    "APOLLOS",
  ],
  8: [
    "MOONBEAM",
    "STARDUST",
    "ASTEROID",
    "SPACEAGE",
    "NEBULAER".slice(0, 8),
    "TELESCOPE".slice(0, 8),
  ],
  9: [
    "STARLIGHT",
    "GALACTICS".slice(0, 9),
    "MOONSHOTS",
    "SATELLITE",
    "LIFTOFFAT".slice(0, 9),
  ],
  10: ["ASTRONAUTS", "WEIGHTLESS", "LAUNCHPADS", "SPACECRAFT"],
};
function acrossRuns() {
  const runs = [];
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      if (isBlockRaw(r, c)) {
        c++;
        continue;
      }
      let start = c;
      while (c < COLS && !isBlockRaw(r, c)) c++;
      const len = c - start;
      if (len >= 2) runs.push({ r, start, len });
    }
  }
  return runs;
}
function isBlockRaw(r, c) {
  return c < 0 || c >= COLS || r < 0 || r >= ROWS || blocks.has(r * COLS + c);
}

const letters = new Array(ROWS * COLS).fill(null);
// default-fill everything so any stray cell (single-letter, unlikely) still shows a glyph
for (let i = 0; i < ROWS * COLS; i++) if (!blocks.has(i)) letters[i] = "A";
const pickIdx = {};
for (const run of acrossRuns()) {
  const list = wordsByLen[run.len] ?? null;
  if (!list) {
    continue;
  }
  const k = run.len;
  pickIdx[k] = (pickIdx[k] ?? run.r * 3) % list.length;
  const word = list[pickIdx[k]];
  pickIdx[k] = (pickIdx[k] + 1) % list.length;
  for (let j = 0; j < run.len; j++) {
    letters[run.r * COLS + (run.start + j)] = word[j];
  }
}

// Clue numbers: a cell is numbered if it starts an across word (no open cell to its left,
// open cell to its right) or a down word (no open above, open below).
const isBlock = (r, c) =>
  c < 0 || c >= COLS || r < 0 || r >= ROWS || blocks.has(r * COLS + c);
const numbers = {};
let n = 0;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (isBlock(r, c)) continue;
    const startsAcross = isBlock(r, c - 1) && !isBlock(r, c + 1);
    const startsDown = isBlock(r - 1, c) && !isBlock(r + 1, c);
    if (startsAcross || startsDown) {
      n += 1;
      numbers[r * COLS + c] = n;
    }
  }
}

// Attribution: five solvers, each a real roster color. Assign per cell so regions of the
// board belong to different people (as real collaborative solves cluster), with some
// interleaving. Weighted so no one dominates but contributions are uneven and human.
const solvers = [
  { id: "u-mara", name: "Mara", color: "#3e63dd" }, // indigo (self)
  { id: "u-ivo", name: "Ivo", color: "#e5484d" }, // red
  { id: "u-sena", name: "Sena", color: "#12a594" }, // teal
  { id: "u-dario", name: "Dario", color: "#ffb224" }, // amber
  { id: "u-lux", name: "Lux", color: "#8e4ec6" }, // violet
];

// Region-based attribution with a little salt so it isn't blocky-clean.
function ownerFor(r, c, i) {
  // salt: a deterministic scatter so ~1 in 7 cells is "stolen" by a neighbor
  const salt = ((i * 2654435761) >>> 0) % 7;
  let base;
  if (c < 5)
    base = 0; // left third -> Mara
  else if (c < 10 && r < 8)
    base = 2; // top-middle -> Sena
  else if (c < 10)
    base = 3; // bottom-middle -> Dario
  else if (r < 7)
    base = 1; // top-right -> Ivo
  else base = 4; // bottom-right -> Lux
  if (salt === 0) base = (base + 1) % 5;
  if (salt === 3 && (r + c) % 2 === 0) base = (base + 3) % 5;
  return base;
}

const attribution = {}; // cellIndex -> solver index
for (let i = 0; i < ROWS * COLS; i++) {
  if (blocks.has(i)) continue;
  const r = Math.floor(i / COLS),
    c = i % COLS;
  attribution[i] = ownerFor(r, c, i);
}

// Counts per solver (cells filled) for the ledger.
const counts = [0, 0, 0, 0, 0];
for (const k in attribution) counts[attribution[k]] += 1;

const out = {
  cols: COLS,
  rows: ROWS,
  blocks: [...blocks].sort((a, b) => a - b),
  letters, // array length 225, null on blocks
  numbers, // map cellIndex -> number
  attribution, // map cellIndex -> solver index
  solvers,
  counts,
};

import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(
  "blocks",
  blocks.size,
  "numbered",
  n,
  "counts",
  counts.join("/"),
  "total",
  counts.reduce((a, b) => a + b, 0),
);
