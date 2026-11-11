// Cutest cat, drawn procedurally (Node 22, standard library only).
// A front-facing ginger kitten: huge sparkling eyes, tilted head, one
// oversized clumsy paw, curled tail and a yarn ball. Everything is fixed
// constants, so every run writes byte-identical PNG bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024; // output size
const SS = 2; // supersample factor (draw at 2048, box-downsample)
const SW = W * SS;
const buf = new Uint8ClampedArray(SW * SW * 4); // RGBA, drawn space

// ---------- palette ----------
const OUTLINE = [91, 58, 41];
const GINGER = [244, 169, 92];
const GINGER_LT = [251, 201, 138];
const GINGER_DK = [222, 138, 61];
const STRIPE = [217, 122, 43];
const CREAM = [255, 244, 226];
const PINK = [246, 169, 184];
const PINK_DK = [239, 143, 162];
const NOSE = [229, 107, 124];
const IRIS = [242, 169, 59];
const IRIS_DK = [201, 127, 30];
const PUPIL = [42, 32, 24];
const WHITE = [255, 255, 255];
const YARN = [229, 107, 124];
const YARN_DK = [201, 79, 97];

// ---------- pixel helpers (coords in 1024-space, scaled to drawn space) ----------
function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SW || y >= SW || a <= 0) return;
  const i = (y * SW + x) * 4;
  const ia = 1 - a;
  buf[i] = Math.round(r * a + buf[i] * ia);
  buf[i + 1] = Math.round(g * a + buf[i + 1] * ia);
  buf[i + 2] = Math.round(b * a + buf[i + 2] * ia);
  buf[i + 3] = 255;
}

function fillEllipse(cx, cy, rx, ry, c, a) {
  const x0 = Math.max(0, Math.floor((cx - rx) * SS));
  const x1 = Math.min(SW - 1, Math.ceil((cx + rx) * SS));
  const y0 = Math.max(0, Math.floor((cy - ry) * SS));
  const y1 = Math.min(SW - 1, Math.ceil((cy + ry) * SS));
  for (let y = y0; y <= y1; y++) {
    const ny = (y + 0.5) / SS - cy;
    const t = 1 - (ny * ny) / (ry * ry);
    if (t < 0) continue;
    const hw = rx * Math.sqrt(t);
    const xa = Math.max(x0, Math.ceil((cx - hw) * SS));
    const xb = Math.min(x1, Math.floor((cx + hw) * SS));
    for (let x = xa; x <= xb; x++) blend(x, y, c[0], c[1], c[2], a);
  }
}

function circle(cx, cy, r, c, a) {
  fillEllipse(cx, cy, r, r, c, a);
}

// Ellipse as a rotated polygon (exact rotation, for the tilted head/eyes).
function fillEllipseRot(cx, cy, rx, ry, ang, c, a) {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const px = Math.cos(t) * rx;
    const py = Math.sin(t) * ry;
    pts.push([cx + px * Math.cos(ang) - py * Math.sin(ang),
              cy + px * Math.sin(ang) + py * Math.cos(ang)]);
  }
  fillPoly(pts, c, a);
}

function fillPoly(pts, c, a) {
  // Scanline fill in drawn space.
  const sp = pts.map(([x, y]) => [x * SS, y * SS]);
  let y0 = Infinity, y1 = -Infinity;
  for (const [, y] of sp) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  y0 = Math.max(0, Math.floor(y0));
  y1 = Math.min(SW - 1, Math.ceil(y1));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0; i < sp.length; i++) {
      const [x1, y1p] = sp[i];
      const [x2, y2p] = sp[(i + 1) % sp.length];
      if ((y1p <= y + 0.5 && y2p > y + 0.5) || (y2p <= y + 0.5 && y1p > y + 0.5)) {
        xs.push(x1 + ((y + 0.5 - y1p) / (y2p - y1p)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(SW - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) blend(x, y, c[0], c[1], c[2], a);
    }
  }
}

function stamp(x, y, r, c, a) {
  circle(x, y, r, c, a);
}

// Thick polyline: stamp circles along each segment.
function thickLine(pts, w, c, a) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / (w * 0.45)));
    for (let k = 0; k <= n; k++) {
      stamp(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, w / 2, c, a);
    }
  }
}

// Smooth tapered chain (e.g. the tail): densely stamped circles whose
// width interpolates from w0 to w1 along the whole path, so the result
// is one smooth sausage instead of a string of beads.
function chain(pts, w0, w1, c, a, ow) {
  let total = 0;
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(d);
    total += d;
  }
  let done = 0;
  const passes = [[ow, OUTLINE, 1], [0, c, a]];
  for (const [extra, col, al] of passes) {
    done = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const n = Math.max(1, Math.ceil(segs[i] / 4));
      for (let k = 0; k <= n; k++) {
        const f = (done + (segs[i] * k) / n) / total;
        const w = w0 + (w1 - w0) * f;
        stamp(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, w / 2 + extra, col, al);
      }
      done += segs[i];
    }
  }
}

// Quadratic bezier as a polyline.
function quad(x0, y0, cx, cy, x1, y1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([
      (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1,
      (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1,
    ]);
  }
  return pts;
}

// ---------- head transform: slight tilt about the head centre ----------
const HX = 512, HY = 430, TILT = -0.105; // ~-6 degrees
const CT = Math.cos(TILT), ST = Math.sin(TILT);
function hx(x, y) { return HX + (x - HX) * CT - (y - HY) * ST; }
function hy(x, y) { return HY + (x - HX) * ST + (y - HY) * CT; }
function hpt(x, y) { return [hx(x, y), hy(x, y)]; }

// Outlined ellipse: dark shell, then fill.
function oEllipse(cx, cy, rx, ry, c, a, ow) {
  fillEllipse(cx, cy, rx + ow, ry + ow, OUTLINE, a);
  fillEllipse(cx, cy, rx, ry, c, a);
}
function oEllipseRot(cx, cy, rx, ry, ang, c, a, ow) {
  fillEllipseRot(cx, cy, rx + ow, ry + ow, ang, OUTLINE, a);
  fillEllipseRot(cx, cy, rx, ry, ang, c, a);
}
function oPoly(pts, c, a, ow) {
  thickLine([...pts, pts[0]], ow * 2, OUTLINE, a);
  fillPoly(pts, c, a);
}

// ---------- background ----------
function background() {
  // Vertical cream -> peach gradient.
  for (let y = 0; y < SW; y++) {
    const t = y / SW;
    const r = Math.round(255 + (255 - 255) * t);
    const g = Math.round(247 + (231 - 247) * t);
    const b = Math.round(234 + (199 - 234) * t);
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
  // Faint pastel dots, low contrast so the cat pops.
  const dots = [
    [140, 150, 26, [249, 198, 211]], [880, 120, 30, [191, 227, 208]],
    [920, 300, 20, [201, 214, 242]], [90, 420, 22, [191, 227, 208]],
    [930, 620, 26, [249, 198, 211]], [120, 700, 18, [201, 214, 242]],
    [830, 90, 14, [249, 198, 211]], [250, 90, 16, [201, 214, 242]],
    [700, 950, 20, [191, 227, 208]], [60, 920, 24, [249, 198, 211]],
  ];
  for (const [x, y, r, c] of dots) circle(x, y, r, c, 0.4);
}

// ---------- cat ----------
function drawCat() {
  // Soft ground shadow.
  fillEllipse(512, 938, 325, 30, [138, 90, 51], 0.16);

  // Tail: smooth tapered curve around the right side, tip curling in.
  chain(
    [[730, 770], [795, 795], [848, 832], [866, 882], [850, 926], [806, 946], [772, 940]],
    68, 46, GINGER, 1, 5,
  );
  // Tail tip stripes: short bars across the tail near its tip.
  thickLine([[819, 916], [837, 956]], 10, STRIPE, 0.55);
  thickLine([[789, 922], [789, 964]], 10, STRIPE, 0.55);

  // Hind paws peeking at the sides (behind the body).
  oEllipse(292, 888, 72, 42, GINGER, 1, 5);
  oEllipse(732, 888, 72, 42, GINGER, 1, 5);

  // Body + cream belly.
  oEllipse(512, 735, 250, 185, GINGER, 1, 6);
  fillEllipse(512, 782, 152, 112, CREAM, 1);
  // Body side stripes.
  thickLine([[300, 690], [330, 700]], 12, STRIPE, 0.45);
  thickLine([[296, 740], [326, 748]], 12, STRIPE, 0.45);
  thickLine([[724, 690], [694, 700]], 12, STRIPE, 0.45);
  thickLine([[728, 740], [698, 748]], 12, STRIPE, 0.45);

  // ---- head group (tilted) ----
  // Ears (behind head).
  const earL = [hpt(330, 302), hpt(414, 276), hpt(346, 162)];
  const earR = [hpt(610, 276), hpt(694, 302), hpt(678, 162)];
  oPoly(earL, GINGER, 1, 6);
  oPoly(earR, GINGER, 1, 6);
  fillPoly([hpt(352, 282), hpt(398, 266), hpt(362, 200)], PINK, 1);
  fillPoly([hpt(626, 266), hpt(672, 282), hpt(662, 200)], PINK, 1);

  // Head.
  oEllipseRot(HX, HY, 258, 222, TILT, GINGER, 1, 6);
  // Forehead tabby stripes.
  for (const sx of [470, 512, 554]) {
    const a = hpt(sx, 252), b = hpt(sx, 302);
    thickLine([a, b], 15, STRIPE, 0.5);
  }

  // Eyes: huge, sparkling.
  for (const [ex, ey] of [[415, 430], [610, 425]]) {
    const [cx, cy] = hpt(ex, ey);
    oEllipseRot(cx, cy, 60, 70, TILT, WHITE, 1, 5);
    fillEllipseRot(cx, cy, 42, 50, TILT, IRIS, 1);
    fillEllipseRot(cx, cy, 42, 50, TILT, IRIS_DK, 0.35); // rim shade
    fillEllipseRot(cx + 2, cy + 4, 20, 28, TILT, PUPIL, 1);
    circle(cx - 15, cy - 20, 12, WHITE, 1);
    circle(cx + 13, cy + 15, 6, WHITE, 1);
  }

  // Nose + "w" smile mouth.
  fillPoly([hpt(494, 498), hpt(530, 498), hpt(512, 526)], NOSE, 1);
  thickLine([hpt(512, 526), hpt(512, 540)], 7, OUTLINE, 1);
  thickLine(quad(...hpt(512, 540), ...hpt(500, 552), ...hpt(482, 545), 10), 7, OUTLINE, 1);
  thickLine(quad(...hpt(512, 540), ...hpt(524, 552), ...hpt(542, 545), 10), 7, OUTLINE, 1);

  // Blush.
  const [bx1, by1] = hpt(362, 516);
  const [bx2, by2] = hpt(662, 511);
  fillEllipse(bx1, by1, 34, 20, PINK_DK, 0.5);
  fillEllipse(bx2, by2, 34, 20, PINK_DK, 0.5);

  // Whiskers.
  for (const [sx, sy, dx] of [[332, 492, -1], [692, 490, 1]]) {
    const [ox, oy] = hpt(sx, sy);
    thickLine([[ox, oy], [ox + dx * 110, oy - 22], [ox + dx * 128, oy - 26]], 5, OUTLINE, 0.7);
    thickLine([[ox, oy + 8], [ox + dx * 118, oy + 6], [ox + dx * 132, oy + 4]], 5, OUTLINE, 0.7);
    thickLine([[ox, oy + 16], [ox + dx * 108, oy + 34], [ox + dx * 122, oy + 42]], 5, OUTLINE, 0.7);
  }

  // ---- front paws (in front of the body) ----
  oEllipse(448, 896, 60, 40, GINGER, 1, 5);
  // The oversized clumsy raised paw, tilted up toward the viewer.
  oEllipseRot(622, 842, 90, 62, -0.32, GINGER, 1, 5);
  // Toe beans on the big paw.
  circle(590, 888, 10, PINK_DK, 0.9);
  circle(620, 896, 10, PINK_DK, 0.9);
  circle(650, 888, 10, PINK_DK, 0.9);

  // Yarn ball beside the left paw, with a loose strand to the paw.
  thickLine(quad(300, 872, 350, 850, 392, 880, 12), 5, YARN_DK, 0.9);
  circle(252, 906, 62, OUTLINE, 1);
  circle(252, 906, 56, YARN, 1);
  thickLine(quad(200, 880, 250, 900, 300, 878, 12), 6, YARN_DK, 0.8);
  thickLine(quad(210, 930, 255, 948, 305, 928, 12), 6, YARN_DK, 0.8);
  thickLine(quad(252, 852, 252, 900, 252, 956, 12), 6, YARN_DK, 0.8);
}

// ---------- downsample 2x2 box -> RGB ----------
function downsample() {
  const out = Buffer.alloc(W * W * 3);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = (((y * SS + dy) * SW) + (x * SS + dx)) * 4;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const o = (y * W + x) * 3;
      out[o] = Math.round(r / (SS * SS));
      out[o + 1] = Math.round(g / (SS * SS));
      out[o + 2] = Math.round(b / (SS * SS));
    }
  }
  return out;
}

// ---------- minimal PNG encoder (CRC32 + zlib) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc(W * (W * 3 + 1));
  for (let y = 0; y < W; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- main ----------
background();
drawCat();
const png = encodePNG(downsample());
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
