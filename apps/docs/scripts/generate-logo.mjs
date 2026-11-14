// Generates the Quickben mark (the High Mage) and its lockup.
// Run from apps/docs: node scripts/generate-logo.mjs
//
// Construction, in units of a (a = 48). PHI is the golden ratio. Hours are clock positions.
//   hood    head circle r = PHI^2. Two arcs leave it at 9:15 (r = 3 PHI) and 2:45 (r = PHI^4)
//           and meet at the tip, which leans right because the radii differ.
//   face    a moon: disc r = 3/PHI, centre (-1/PHI^5, 1/PHI).
//   eyes    discs r = 1/PHI at +-(1/PHI + 1/PHI^3) from the face's centre, 1/PHI^2 below it.
//           A lid cuts each one: the left is 3/10 open and tilts 15 deg, the right is
//           1/PHI open and tilts -5 deg.
//   mantle  circle r = PHI^3 centred (1/PHI^3, PHI^3 + PHI), cut level at y = PHI^3
//           and kept 1/PHI^2 clear of the head.
//   studs   twelve holes r = 1/PHI^5, every 10 minutes of the mantle's own clock:
//           six from 10:05 and six from 1:00.
import { writeFileSync } from "node:fs";

import { WORDMARK_ADVANCE, WORDMARK_CAP_HEIGHT, WORDMARK_PATH } from "./logo-wordmark.mjs";

const PHI = (1 + Math.sqrt(5)) / 2;
const A = 48;
// The hood takes the ink, the face is saffron and the eyes take the colour behind the mark.
const COLORS = {
  light: { ink: "#2a1b3d", face: "#f2a413", eye: "#2a1b3d" },
  dark: { ink: "#f0e8da", face: "#f5b02e", eye: "#170f22" },
};

const n2 = (x) => String(Math.round(x * 100) / 100);
const pt = ([x, y]) => `${n2(x * A)} ${n2(y * A)}`;
const hour = (h) => [Math.sin((h * Math.PI) / 6), -Math.cos((h * Math.PI) / 6)];
const along = (from, dir, d) => [from[0] + dir[0] * d, from[1] + dir[1] * d];
const arc = (r, large, sweep, to) => `A${n2(r * A)} ${n2(r * A)} 0 ${large} ${sweep} ${pt(to)}`;
const disc = (c, r) =>
  `M${pt([c[0] - r, c[1]])} ${arc(r, 1, 1, [c[0] + r, c[1]])} ${arc(r, 1, 1, [c[0] - r, c[1]])} Z`;

/** Both crossing points of two circles, the higher one on screen first. */
function crossings(c1, r1, c2, r2) {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  const k = (r1 ** 2 - r2 ** 2 + d ** 2) / (2 * d);
  const h = Math.sqrt(r1 ** 2 - k ** 2);
  const mid = [c1[0] + (dx * k) / d, c1[1] + (dy * k) / d];
  const pair = [
    [mid[0] + (h * dy) / d, mid[1] - (h * dx) / d],
    [mid[0] - (h * dy) / d, mid[1] + (h * dx) / d],
  ];
  return pair.sort((p, q) => p[1] - q[1]);
}

// Hood
const HEAD_R = PHI ** 2;
const LEFT = { hour: 9.25, r: 3 * PHI };
const RIGHT = { hour: 2.75, r: PHI ** 4 };
const leftC = along([0, 0], hour(LEFT.hour), HEAD_R - LEFT.r);
const rightC = along([0, 0], hour(RIGHT.hour), HEAD_R - RIGHT.r);
const TIP = crossings(leftC, LEFT.r, rightC, RIGHT.r)[0];
const leftP = along([0, 0], hour(LEFT.hour), HEAD_R);
const rightP = along([0, 0], hour(RIGHT.hour), HEAD_R);
const HOOD =
  `M${pt(rightP)} ${arc(HEAD_R, 1, 1, leftP)} ${arc(LEFT.r, 0, 1, TIP)} ` +
  `${arc(RIGHT.r, 0, 1, rightP)} Z`;

// Face and eyes
const FACE_C = [-(PHI ** -5), 1 / PHI];
const FACE_R = 3 / PHI;
const FACE = disc(FACE_C, FACE_R);
const EYE = { r: 1 / PHI, dx: 1 / PHI + PHI ** -3, dy: PHI ** -2 };

/** The part of an eye disc below its lid. `open` is the visible share of the diameter. */
function eye(side, open, tiltDeg) {
  const c = [FACE_C[0] + side * EYE.dx, FACE_C[1] + EYE.dy];
  const t = (tiltDeg * Math.PI) / 180;
  const lid = [Math.cos(t), Math.sin(t)];
  const down = [-lid[1], lid[0]];
  const drop = EYE.r * (1 - 2 * open);
  const half = Math.sqrt(EYE.r ** 2 - drop ** 2);
  const mid = along(c, down, drop);
  const from = along(mid, lid, -half);
  return `M${pt(from)} L${pt(along(mid, lid, half))} ${arc(EYE.r, open > 0.5 ? 1 : 0, 1, from)} Z`;
}
const EYES = `${eye(-1, 0.3, 15)} ${eye(1, 1 / PHI, -5)}`;

// Mantle
const MANTLE_R = PHI ** 3;
const MANTLE_C = [PHI ** -3, PHI ** 3 + PHI];
const BASE_Y = PHI ** 3;
const GAP = PHI ** -2;
const baseHalf = Math.sqrt(MANTLE_R ** 2 - (BASE_Y - MANTLE_C[1]) ** 2);
const baseL = [MANTLE_C[0] - baseHalf, BASE_Y];
const baseR = [MANTLE_C[0] + baseHalf, BASE_Y];
const [neckA, neckB] = crossings([0, 0], HEAD_R + GAP, MANTLE_C, MANTLE_R).sort(
  (p, q) => p[0] - q[0],
);
const STUDS = [];
for (let i = 0; i < 6; i++) {
  for (const h of [10 + 1 / 12 + i / 6, 1 + i / 6]) {
    STUDS.push(disc(along(MANTLE_C, hour(h), MANTLE_R - 1 / PHI), PHI ** -5));
  }
}
const MANTLE =
  `M${pt(baseL)} ${arc(MANTLE_R, 0, 1, neckA)} ${arc(HEAD_R + GAP, 0, 0, neckB)} ` +
  `${arc(MANTLE_R, 0, 1, baseR)} Z ${STUDS.join(" ")}`;

function squareBox(xs, ys) {
  const pad = PHI ** -2;
  const side = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const x = (Math.min(...xs) + Math.max(...xs)) / 2 - side / 2 - pad;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2 - side / 2 - pad;
  return { x, y, side: side + 2 * pad };
}
const viewBox = (b) => [b.x, b.y, b.side, b.side].map((x) => n2(x * A)).join(" ");
const BUST_BOX = squareBox([baseL[0], baseR[0], -HEAD_R, HEAD_R], [TIP[1], BASE_Y]);
const HEAD_BOX = squareBox([-HEAD_R, HEAD_R, TIP[0]], [TIP[1], HEAD_R]);

// Files loaded through <img> or as a favicon follow the OS theme.
const rules = (c) => `.ink{fill:${c.ink}}.face{fill:${c.face}}.eye{fill:${c.eye}}`;
const STYLE =
  `<style>${rules(COLORS.light)}` +
  `@media (prefers-color-scheme:dark){${rules(COLORS.dark)}}</style>`;
const HEAD =
  `<path class="ink" d="${HOOD}"/><path class="face" d="${FACE}"/>` +
  `<path class="eye" d="${EYES}"/>`;
const BUST = `<path class="ink" fill-rule="evenodd" d="${MANTLE}"/>${HEAD}`;
const open = (box) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" role="img" aria-label="Quickben">`;

const bustSvg = `${open(viewBox(BUST_BOX))}${STYLE}${BUST}</svg>\n`;
const headSvg = `${open(viewBox(HEAD_BOX))}${STYLE}${HEAD}</svg>\n`;

// Lockup: the bust, then the wordmark with its capitals centred on the figure's height.
const WORD_SCALE = (HEAD_R * 0.9 * A) / WORDMARK_CAP_HEIGHT;
const WORD_X = (baseR[0] + 1) * A;
const WORD_Y = ((TIP[1] + BASE_Y) / 2) * A + (WORDMARK_CAP_HEIGHT * WORD_SCALE) / 2;
const lockW = WORD_X + WORDMARK_ADVANCE * WORD_SCALE + PHI ** -2 * A - BUST_BOX.x * A;
const lockBox = [BUST_BOX.x * A, BUST_BOX.y * A, lockW, BUST_BOX.side * A].map(n2).join(" ");
const lockupSvg =
  `${open(lockBox)}${STYLE}${BUST}<path class="ink" ` +
  `transform="translate(${n2(WORD_X)} ${n2(WORD_Y)}) scale(${WORD_SCALE.toFixed(5)})" ` +
  `d="${WORDMARK_PATH}"/></svg>\n`;

// Matches Prettier: a declaration stays on one line when it fits in 100 columns.
function decl(name, value) {
  const line = `export const ${name} = "${value}";`;
  return line.length <= 100 ? line : `export const ${name} =\n  "${value}";`;
}
const geometry = `${[
  "// GENERATED by scripts/generate-logo.mjs. Do not edit by hand.",
  decl("HEAD_VIEWBOX", viewBox(HEAD_BOX)),
  decl("BUST_VIEWBOX", viewBox(BUST_BOX)),
  decl("MARK_HOOD", HOOD),
  decl("MARK_FACE", FACE),
  decl("MARK_EYES", EYES),
  decl("MARK_MANTLE", MANTLE),
].join("\n")}\n`;

writeFileSync(new URL("../public/logo.svg", import.meta.url), bustSvg);
writeFileSync(new URL("../public/logo-head.svg", import.meta.url), headSvg);
writeFileSync(new URL("../public/logo-lockup.svg", import.meta.url), lockupSvg);
writeFileSync(new URL("../app/icon.svg", import.meta.url), headSvg);
writeFileSync(new URL("../components/logo-geometry.ts", import.meta.url), geometry);
process.stdout.write(`bust ${viewBox(BUST_BOX)}\nhead ${viewBox(HEAD_BOX)}\n`);
