#!/usr/bin/env node
// Regenerates the device bezel art and geometry from the local Xcode install.
//
//   npm run devices:extract
//
// Needs Xcode 27 (for /Library/Developer/DeviceKit and the CoreSimulator device
// types) and pdftocairo (`brew install poppler`). The output is committed, so
// this only has to run when the device list changes.
//
// The art is Apple's, taken from the Xcode install on the machine this runs on.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEVICE_TYPES = "/Library/Developer/CoreSimulator/Profiles/DeviceTypes";
const CHROME = "/Library/Developer/DeviceKit/Chrome";
const MASKS = "/Library/Developer/DeviceKit/FramebufferMasks";

const PUBLIC_DIR = path.join(ROOT, "public/devices");
const GENERATED = path.join(ROOT, "lib/devices/generated.ts");

// Menu order. Names must match the .simdevicetype bundle names.
const FAMILIES = [
  ["iPhone 18", ["iPhone 18 Pro", "iPhone 18 Pro Max"]],
  ["iPhone 17", ["iPhone 17", "iPhone 17 Pro", "iPhone 17 Pro Max", "iPhone Air", "iPhone 17e"]],
  ["iPhone 16", ["iPhone 16", "iPhone 16 Plus", "iPhone 16 Pro", "iPhone 16 Pro Max", "iPhone 16e"]],
  ["iPhone 15", ["iPhone 15", "iPhone 15 Plus", "iPhone 15 Pro", "iPhone 15 Pro Max"]],
];

function fail(message) {
  console.error(`extract-device-chrome: ${message}`);
  process.exit(1);
}

function readPlist(file) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));
}

// Logical screen size of a device type, in points.
function screenOf(capabilities) {
  const dimensions = capabilities.ScreenDimensionsCapability;
  const scale = dimensions["main-screen-scale"];
  return { width: dimensions["main-screen-width"] / scale, height: dimensions["main-screen-height"] / scale, scale };
}

// pdftocairo prints one self-contained SVG per page; every PDF here is one page.
function pdfToSvg(file) {
  if (!existsSync(file)) fail(`missing ${file}`);
  const svg = execFileSync("pdftocairo", ["-svg", file, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const match = svg.match(/<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"[^>]*>([\s\S]*)<\/svg>/);
  if (!match) fail(`could not parse SVG converted from ${file}`);
  return { width: Number(match[1]), height: Number(match[2]), inner: match[3].trim() };
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function write(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents.endsWith("\n") ? contents : `${contents}\n`);
}

function svgDocument(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${body}\n</svg>`;
}

// The framebuffer mask is the screen outline: a clip path over a black rect.
function readScreenOutline(maskId) {
  const svg = pdfToSvg(path.join(MASKS, `${maskId}.pdf`));
  const match = svg.inner.match(/<clipPath[^>]*>\s*<path[^>]*\bd="([^"]+)"/);
  if (!match) fail(`no outline path in framebuffer mask ${maskId}`);
  return { width: svg.width, height: svg.height, d: match[1].trim() };
}

// Re-emits a pdftocairo path (absolute M/L/C/Z only) with every point mapped.
function mapPath(d, map, places = 3) {
  const tokens = d.trim().split(/\s+/);
  const format = (value) => String(Number(value.toFixed(places)));
  const out = [];
  let index = 0;
  const isNumber = () => index < tokens.length && !Number.isNaN(Number(tokens[index]));
  const point = () => map(Number(tokens[index++]), Number(tokens[index++])).map(format).join(" ");
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "Z") {
      out.push("Z");
    } else if (command === "M" || command === "L" || command === "C") {
      const pointsPerSegment = command === "C" ? 3 : 1;
      do {
        out.push(`${command}${Array.from({ length: pointsPerSegment }, point).join(" ")}`);
      } while (isNumber());
    } else {
      fail(`unexpected path command "${command}"`);
    }
  }
  // pdftocairo closes with a stray move back to the start.
  if (out.at(-1)?.startsWith("M")) out.pop();
  return out.join("");
}

function pathPoints(d) {
  const points = [];
  mapPath(d, (x, y) => {
    points.push([x, y]);
    return [x, y];
  });
  return points;
}

// pdftocairo writes rectangles as four-point paths.
function rectFromPath(d) {
  const match = d.trim().match(/^M (\S+) (\S+) L (\S+) (\S+) L (\S+) (\S+) L (\S+) (\S+) Z(?: M \S+ \S+)?$/);
  if (!match) return null;
  const xs = [1, 3, 5, 7].map((index) => Number(match[index]));
  const ys = [2, 4, 6, 8].map((index) => Number(match[index]));
  if (new Set(xs).size !== 2 || new Set(ys).size !== 2) return null;
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function rectToPath({ x0, y0, x1, y1 }) {
  return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`;
}

const CLIP_PATH = /<clipPath id="([^"]+)">\s*<path[^>]*\bd="([^"]+)"[^>]*\/>\s*<\/clipPath>/g;

// Each 9-slice piece is the whole bezel drawing cropped to one page. This undoes
// the crop on the top-left piece to get the full drawing back, for bezel styles
// that ship without a composite.
//
// Stitching the pieces together instead leaves a faint line at every join once
// the device is zoomed: the art is stacked opaque layers, and anti-aliasing a
// crop edge lets the lighter ones underneath show through.
function reconstructFromSlices(slices) {
  const { topLeft, topRight, bottomLeft, bottomRight } = slices;
  if (topLeft.inner.includes("<mask")) fail("cannot rebuild masked bezel art from its slices");

  // Where a slice sits in the drawing: every slice carries the same outlines,
  // shifted by its page origin.
  const origin = (slice) => {
    const outlines = [...slice.inner.matchAll(CLIP_PATH)].map((match) => match[2]).filter((d) => !rectFromPath(d));
    if (outlines.length === 0) fail("bezel slice has no outline to locate it by");
    const points = outlines.flatMap(pathPoints);
    return { x: Math.min(...points.map(([x]) => x)), y: Math.min(...points.map(([, y]) => y)) };
  };
  const base = origin(topLeft);
  const offset = (slice) => ({ x: base.x - origin(slice).x, y: base.y - origin(slice).y });
  const right = offset(topRight).x;
  const down = offset(bottomLeft).y;
  const far = offset(bottomRight);
  if (offset(topRight).y !== 0 || offset(bottomLeft).x !== 0 || far.x !== right || far.y !== down) fail("bezel corner slices do not line up");
  const width = right + topRight.width;
  const height = down + bottomLeft.height;

  // Small details (antenna lines) exist only in the corner they belong to: a
  // filled rectangle clipped to a smaller one.
  const DETAIL = /<g clip-path="url\(#([^)]+)\)">\s*<path ([^>]*)\bd="([^"]+)"[^>]*\/>\s*<\/g>\n?/g;
  const details = [];
  const takeDetails = (slice, dx, dy) => {
    const clips = Object.fromEntries([...slice.inner.matchAll(CLIP_PATH)].map((match) => [match[1], rectFromPath(match[2])]));
    const taken = new Set();
    const rest = slice.inner.replace(DETAIL, (group, clipId, attributes, d) => {
      const clip = clips[clipId];
      const fill = rectFromPath(d);
      if (!clip || !fill || /fill="none"/.test(attributes)) return group;
      const x0 = Math.max(clip.x0, fill.x0) + dx;
      const y0 = Math.max(clip.y0, fill.y0) + dy;
      const x1 = Math.min(clip.x1, fill.x1) + dx;
      const y1 = Math.min(clip.y1, fill.y1) + dy;
      details.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" ${attributes.replace(/fill-rule="[^"]*"\s*/, "").trim()}/>`);
      taken.add(clipId);
      return "";
    });
    // Drop the clips those details used, so only the page crops are left.
    return rest.replace(CLIP_PATH, (clipPath, id) => (taken.has(id) ? "" : clipPath));
  };
  let inner = takeDetails(topLeft, 0, 0);
  takeDetails(topRight, right, 0);
  takeDetails(bottomLeft, 0, down);
  takeDetails(bottomRight, right, down);

  // Un-crop: clips and fills that stop at the page edge run to the far side instead.
  const page = { width: topLeft.width, height: topLeft.height };
  inner = inner
    .replace(CLIP_PATH, (clipPath, _id, d) => {
      const rect = rectFromPath(d);
      if (!rect) return clipPath;
      if (rect.x1 !== page.width || rect.y1 !== page.height) fail("bezel slice is cropped in a way this script does not handle");
      return clipPath.replace(d, rectToPath({ ...rect, x1: width, y1: height }));
    })
    .replace(/<rect x="(\S+)" y="(\S+)" width="\S+" height="\S+"/g, (_tag, x, y) => `<rect x="${x}" y="${y}" width="${width - 2 * Number(x)}" height="${height - 2 * Number(y)}"`)
    .replace(/(<path [^>]*\bfill="rgb[^>]*\bd=")([^"]+)"/g, (tag, before, d) => {
      const rect = rectFromPath(d);
      if (!rect || (rect.x1 < page.width && rect.y1 < page.height)) return tag;
      return `${before}${rectToPath({ ...rect, x1: Math.max(rect.x1, width), y1: Math.max(rect.y1, height) })}"`;
    });

  return { inner: `${inner}\n${details.join("\n")}`, width, height };
}

// Vector 9-slice: everything past the middle of the drawing moves by the change
// in size. The art is straight through the middle, so nothing distorts.
function stretchDrawing(drawing, width, height) {
  const cut = { x: drawing.width / 2, y: drawing.height / 2 };
  const delta = { x: width - drawing.width, y: height - drawing.height };
  const move = (value, axis, shift = 0) => (value + shift > cut[axis] ? value + delta[axis] : value);
  const tidy = (value) => Number(value.toFixed(6));

  const stretched = drawing.inner
    .replace(/<path\b[^>]*>/g, (tag) => {
      // The only transform pdftocairo emits here is a plain translation.
      const shift = tag.match(/\btransform="matrix\(1, 0, 0, 1, (\S+), (\S+)\)"/);
      if (!shift && tag.includes("transform=")) fail("bezel art uses a transform this script does not handle");
      const [dx, dy] = shift ? [Number(shift[1]), Number(shift[2])] : [0, 0];
      return tag.replace(/\bd="([^"]+)"/, (_attribute, d) => `d="${mapPath(d, (x, y) => [move(x, "x", dx), move(y, "y", dy)], 6)}"`);
    })
    .replace(/<rect x="(\S+)" y="(\S+)" width="(\S+)" height="(\S+)"/g, (_tag, x, y, w, h) => {
      const [x0, y0] = [move(Number(x), "x"), move(Number(y), "y")];
      const [x1, y1] = [move(Number(x) + Number(w), "x"), move(Number(y) + Number(h), "y")];
      return `<rect x="${tidy(x0)}" y="${tidy(y0)}" width="${tidy(x1 - x0)}" height="${tidy(y1 - y0)}"`;
    });
  if (/<(?!path\b)[^>]*\btransform=/.test(stretched)) fail("bezel art uses a transform this script does not handle");
  return stretched;
}

// How far the screen sits inside the bezel art. chrome.json's `sizing` is off by
// one for phone11/phone12, so measure it: the composite's size minus the screen
// it was drawn for. That screen can belong to a device outside FAMILIES (the Air
// borrows the Pro Max's bezel), so fall back to everything Xcode knows.
function measureInset(chromeId, composite, listedScreens) {
  const insetFor = ({ width, height }) => {
    const inset = (composite.width - width) / 2;
    return inset > 0 && Number.isInteger(inset) && inset === (composite.height - height) / 2 ? inset : null;
  };
  for (const screen of listedScreens) {
    const inset = insetFor(screen);
    if (inset !== null) return inset;
  }
  for (const bundle of readdirSync(DEVICE_TYPES)) {
    const resources = path.join(DEVICE_TYPES, bundle, "Contents/Resources");
    if (!existsSync(path.join(resources, "profile.plist"))) continue;
    if (readPlist(path.join(resources, "profile.plist")).chromeIdentifier?.split(".").pop() !== chromeId) continue;
    const inset = insetFor(screenOf(readPlist(path.join(resources, "capabilities.plist")).capabilities));
    if (inset !== null) return inset;
  }
  return fail(`${chromeId}: no device matches its composite, so the bezel inset cannot be measured`);
}

// --- read Xcode -------------------------------------------------------------

try {
  execFileSync("pdftocairo", ["-v"], { stdio: "ignore" });
} catch {
  fail("pdftocairo not found. Install it with `brew install poppler`.");
}
for (const dir of [DEVICE_TYPES, CHROME, MASKS]) {
  if (!existsSync(dir)) fail(`${dir} not found. This needs Xcode 27 installed and launched once.`);
}

const devices = [];
for (const [family, names] of FAMILIES) {
  for (const name of names) {
    const resources = path.join(DEVICE_TYPES, `${name}.simdevicetype/Contents/Resources`);
    if (!existsSync(resources)) fail(`Xcode has no device type named "${name}"`);
    const profile = readPlist(path.join(resources, "profile.plist"));
    const capabilities = readPlist(path.join(resources, "capabilities.plist")).capabilities;
    devices.push({
      id: slug(name),
      name,
      family,
      model: profile.modelIdentifier,
      chrome: profile.chromeIdentifier.split(".").pop(),
      maskId: profile.framebufferMask,
      ...screenOf(capabilities),
      cornerRadius: Number(capabilities.DeviceCornerRadius.toFixed(2)),
      island: capabilities.DeviceSupportsDynamicIsland === true,
      sensorBar: path.join(resources, `${profile.sensorBarImage}.pdf`),
    });
  }
}

const chromes = new Map();
for (const id of new Set(devices.map((device) => device.chrome))) {
  const resources = path.join(CHROME, `${id}.devicechrome/Contents/Resources`);
  const json = JSON.parse(readFileSync(path.join(resources, "chrome.json"), "utf8"));
  const { images } = json;
  const load = (imageName) => pdfToSvg(path.join(resources, `${imageName}.pdf`));
  const slices = Object.fromEntries(["topLeft", "topRight", "bottomLeft", "bottomRight"].map((key) => [key, load(images[key])]));
  // Most styles ship the whole bezel as one drawing; the rest only as 9 slices.
  const composite = images.composite ? load(images.composite) : null;

  let inset;
  if (composite) {
    inset = measureInset(id, composite, devices.filter((device) => device.chrome === id));
  } else {
    const { leftWidth, rightWidth, topHeight, bottomHeight } = images.sizing;
    if (new Set([leftWidth, rightWidth, topHeight, bottomHeight]).size !== 1) fail(`${id}: uneven bezel sizing is not handled`);
    inset = leftWidth;
  }

  chromes.set(id, { id, json, drawing: composite ?? reconstructFromSlices(slices), inset, load });
}

// --- write art --------------------------------------------------------------

rmSync(PUBLIC_DIR, { recursive: true, force: true });

const outlines = {};
const bezels = {};
const deviceSpecs = [];

for (const device of devices) {
  const chrome = chromes.get(device.chrome);
  const { inset } = chrome;
  const padding = { top: 0, right: 0, bottom: 0, left: 0, ...chrome.json.images.devicePadding };

  // Screen outline, as CSS clip paths in points for each orientation. Rotating
  // the device left turns its top edge to the left; right turns it to the right.
  const outlineKey = device.maskId.slice(0, 8).toLowerCase();
  if (!outlines[outlineKey]) {
    const outline = readScreenOutline(device.maskId);
    const outlineScale = outline.width / device.width;
    if (Math.abs(outline.height / device.height - outlineScale) > 1e-6) {
      fail(`${device.name}: framebuffer mask ${device.maskId} does not match a ${device.width}x${device.height} screen`);
    }
    const { width, height } = device;
    outlines[outlineKey] = {
      portrait: mapPath(outline.d, (x, y) => [x / outlineScale, y / outlineScale]),
      "landscape-left": mapPath(outline.d, (x, y) => [y / outlineScale, width - x / outlineScale]),
      "landscape-right": mapPath(outline.d, (x, y) => [height - y / outlineScale, x / outlineScale]),
    };
  }

  const bezelKey = `${chrome.id}-${device.width}x${device.height}`;
  if (!bezels[bezelKey]) {
    const artWidth = device.width + 2 * inset;
    const artHeight = device.height + 2 * inset;
    // The drawing is made for one screen size; stretch it for any other.
    const { drawing } = chrome;
    const fits = drawing.width === artWidth && drawing.height === artHeight;
    const art = fits ? drawing.inner : stretchDrawing(drawing, artWidth, artHeight);
    write(path.join(PUBLIC_DIR, "bezels", `${bezelKey}.svg`), svgDocument(artWidth, artHeight, art));

    const windowWidth = artWidth + padding.left + padding.right;
    const buttons = chrome.json.inputs.map((input) => {
      // "switch" is the iPhone 15's ring/silent toggle; everything else is a push button.
      if (!["button", "switch"].includes(input.type) || input.align !== "leading" || !["left", "right"].includes(input.anchor)) {
        fail(`${chrome.id}: input "${input.name}" uses a layout this script does not handle`);
      }
      const image = chrome.load(input.image);
      const fileFor = (imageName) => {
        const file = path.join(PUBLIC_DIR, "buttons", chrome.id, `${slug(imageName)}.svg`);
        if (!existsSync(file)) {
          const svg = chrome.load(imageName);
          write(file, svgDocument(svg.width, svg.height, svg.inner));
        }
        return `/devices/buttons/${chrome.id}/${slug(imageName)}.svg`;
      };
      // Offsets are in window coordinates: from the left edge for left-anchored
      // buttons, and from the right edge (negative) for right-anchored ones.
      const position = (offset) => (input.anchor === "left" ? offset.x : windowWidth + offset.x - image.width);
      return {
        name: input.name,
        label: input.accessibilityTitle,
        kind: input.type,
        side: input.anchor,
        x: position(input.offsets.normal),
        hoverX: position(input.offsets.rollover),
        y: input.offsets.normal.y,
        width: image.width,
        height: image.height,
        src: fileFor(input.image),
        srcDown: fileFor(input.imageDown),
      };
    });

    bezels[bezelKey] = {
      src: `/devices/bezels/${bezelKey}.svg`,
      width: artWidth,
      height: artHeight,
      inset,
      padding,
      cornerRadius: chrome.json.paths.simpleOutsideBorder.cornerRadiusX,
      buttons,
    };
  }

  let notch = null;
  if (!device.island) {
    const svg = pdfToSvg(device.sensorBar);
    const hash = createHash("sha256").update(svg.inner).digest("hex").slice(0, 8);
    const file = path.join(PUBLIC_DIR, "sensors", `notch-${hash}.svg`);
    if (!existsSync(file)) write(file, svgDocument(svg.width, svg.height, svg.inner));
    notch = { src: `/devices/sensors/notch-${hash}.svg`, width: svg.width, height: svg.height };
  }

  deviceSpecs.push({
    id: device.id,
    name: device.name,
    family: device.family,
    model: device.model,
    screen: { width: device.width, height: device.height, scale: device.scale, cornerRadius: device.cornerRadius, outline: outlineKey },
    sensor: device.island ? "island" : "notch",
    notch,
    bezel: bezelKey,
  });
}

// --- write data -------------------------------------------------------------

write(
  GENERATED,
  `// GENERATED by scripts/extract-device-chrome.mjs from the local Xcode install.
// Do not edit; run \`npm run devices:extract\` instead.

export type Orientation = "portrait" | "landscape-left" | "landscape-right";

export type SensorHousing = "island" | "notch";

export interface DeviceSpec {
  id: string;
  name: string;
  family: string;
  model: string;
  /** Logical screen in points. \`outline\` is a key into SCREEN_OUTLINES. */
  screen: { width: number; height: number; scale: number; cornerRadius: number; outline: string };
  sensor: SensorHousing;
  notch: { src: string; width: number; height: number } | null;
  bezel: string;
}

export interface ButtonSpec {
  name: string;
  label: string;
  /** A switch stays down until clicked again; \`srcDown\` is its "on" art. */
  kind: "button" | "switch";
  side: "left" | "right";
  /** Resting and hovered left offsets, in window coordinates. */
  x: number;
  hoverX: number;
  y: number;
  width: number;
  height: number;
  src: string;
  srcDown: string;
}

export interface BezelSpec {
  src: string;
  /** Size of the bezel art. The screen sits \`inset\` points in from each edge. */
  width: number;
  height: number;
  inset: number;
  /** Room around the art for the side buttons to slide out into. */
  padding: { top: number; right: number; bottom: number; left: number };
  cornerRadius: number;
  buttons: ButtonSpec[];
}

export const DEVICES: readonly DeviceSpec[] = ${JSON.stringify(deviceSpecs, null, 2)};

export const BEZELS: Readonly<Record<string, BezelSpec>> = ${JSON.stringify(bezels, null, 2)};

/** Exact screen shape per orientation, as SVG path data in points. */
export const SCREEN_OUTLINES: Readonly<Record<string, Record<Orientation, string>>> = ${JSON.stringify(outlines, null, 2)};
`,
);

console.log(`Wrote ${deviceSpecs.length} devices, ${Object.keys(bezels).length} bezels and ${Object.keys(outlines).length} screen outlines.`);
for (const [key, bezel] of Object.entries(bezels)) {
  console.log(`  ${key}: ${bezel.width}x${bezel.height}, inset ${bezel.inset}, ${bezel.buttons.length} buttons`);
}
