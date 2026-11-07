import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";
import { HALO_FRAGMENT, SPHERE_FRAGMENT, SPHERE_VERTEX } from "../brand/orbital-spheres-3d";
import { blendAt, fillForward, mix, type Blend } from "./story-timeline";

/**
 * The 3D scene of the homepage scroll story (#85, storyboard in docs/design/homepage-story.md). One scene whose
 * objects carry one keyframe per chapter; `setProgress(chapter + fraction)` picks the scene, `frame(dt)` adds
 * the idle motion and renders. Everything here is decorative and illustrative – no real session data.
 */

type V3 = [number, number, number];
interface Key {
  p: V3;
  s: number;
  o: number;
}

const CHAPTERS = 11;
const LAST = CHAPTERS - 1;
const HIDDEN: Key = { p: [0, 0, 0], s: 0.001, o: 0 };

const COLORS = { cyan: "#22d3ee", mint: "#2ee6a8", violet: "#8b5cf6", blue: "#2f7bff", amber: "#fbbf24", text: "#e8eefc", muted: "#9aa9c6" };

/**
 * The three example models. Named after real providers the user can connect with their own keys (owner request
 * 05.11.26: visitors should see at first glance that Claude, OpenAI and DeepSeek debate a decision); the scene is
 * marked "Illustration – not live data".
 */
const MODEL_STYLE = [
  { name: "Claude", color: COLORS.violet, tint: "#c4b5fd" },
  { name: "OpenAI", color: COLORS.cyan, tint: "#a5f3fc" },
  { name: "DeepSeek", color: COLORS.mint, tint: "#a7f3d0" },
];

/**
 * Further providers in the intro orbit (owner request 07.11.26: Gemini, Grok and Kimi were missing). They circle the
 * core between the three example models in chapter 0 – the first frame of the homepage and the whole sign-in
 * scene – and sink into the core once the story's formation starts, so the later chapters keep their A/B/C example.
 */
const GUEST_STYLE = [
  { name: "Gemini", color: COLORS.blue, tint: "#bfdbfe" },
  { name: "Grok", color: "#94a3b8", tint: "#f1f5f9" },
  { name: "Kimi", color: "#ec4899", tint: "#fbcfe8" },
];
/** Orbit slots: the example models and the guests alternate around the core. */
const ORBIT_SLOTS = MODEL_STYLE.length + GUEST_STYLE.length;
/** Intro orbit: wider, more tilted and with smaller spheres than with three models, so six names stay readable. */
const ORBIT = { radius: 3.5, tilt: 0.42, scale: 0.8 };

/**
 * Every text drawn inside the 3D scene. English is the default; the landing page passes the visitor's language
 * (messages `scene.*`). Model names are product names and stay as they are.
 */
export const SCENE_LABELS_EN = {
  models: [
    { role: "Software Architect", roles: ["Architecture", "Scalability", "Reliability", "Cost"] },
    { role: "Security Expert", roles: ["Security", "Data governance", "Performance", "Compliance"] },
    { role: "Critical Thinker", roles: ["Critic", "Maintainability", "Developer experience", "Operations"] },
  ],
  apiKey: "Your API key",
  decision: "Decision",
  proposal: "Proposal {letter}",
  proposalLines: ["Managed multi-tenant", "Self-hosted cluster", "Hybrid architecture"],
  evidenceAttached: "Evidence attached",
  example: "example",
  optional: "optional",
  brief: { title: "Brief", lines: ["Which database architecture?", "3 models · 12 perspectives", "Budget on your own keys"] },
  objection: { title: "Objection · Security", lines: ["Tenant isolation risk", "Checked against evidence", "Kept on record"] },
  evidence: ["Evidence: test results", "Evidence: provider docs"],
  hybrid: { title: "Hybrid A + C", lines: ["Revised against objections", "Merged where compatible"] },
  difference: "Difference documented",
  report: { title: "Decision report", lines: ["Recommended: Hybrid A + C", "Minority position kept"], bars: ["Security", "Cost", "Time to launch"] },
  awaiting: "Awaiting your approval",
  approved: "✓ Approved by you",
  pipeline: [
    { title: "Tasks", lines: ["Validated plan", "Task graph"] },
    { title: "Code", lines: ["Isolated sandbox", "No network access"] },
    { title: "Tests", lines: ["Run in the sandbox", "Results attached"] },
    { title: "Reviews", lines: ["Independent models", "Findings visible"] },
    { title: "Draft PR", lines: ["GitHub draft pull request", "Merge stays your call"] },
  ],
};
export type SceneLabels = typeof SCENE_LABELS_EN;

/** Formation positions of the three models per chapter (chapter 0 orbits instead). */
const MODEL_KEYS: Array<Array<Key | undefined>> = [
  [{ p: [-3.3, 1.3, 0], s: 1, o: 1 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { p: [-3.6, 2.7, -2.5], s: 0.7, o: 1 }],
  [{ p: [3.3, 1.3, 0], s: 1, o: 1 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { p: [3.6, 2.7, -2.5], s: 0.7, o: 1 }],
  [{ p: [0, -2.5, 0], s: 1, o: 1 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { p: [0, 3.4, -3], s: 0.7, o: 1 }],
];

const CAMERA: Array<{ pos: V3; target: V3 } | undefined> = [
  { pos: [0, 0.5, 10.5], target: [0, 0, 0] },
  { pos: [0, 0.3, 10], target: [0, 0, 0] },
  { pos: [0, 0.4, 10.5], target: [0, 0, 0] },
  { pos: [0, 0.1, 10], target: [0, -0.3, 0] },
  { pos: [0, 0.4, 10.5], target: [0, 0, 0] },
  { pos: [1.2, 0, 9.4], target: [1.2, -0.7, 0] },
  { pos: [0, 0, 9.5], target: [0, -0.4, 0] },
  { pos: [0, 0, 8.6], target: [0, 0, 0] },
  { pos: [0, 0, 8.2], target: [0, 0, 0] },
  { pos: [0, 0.2, 10], target: [0, -0.2, 0] },
  { pos: [0.2, 0.4, 12.5], target: [0.2, -0.1, 0] },
];

interface CardSpec {
  title: string;
  lines: string[];
  accent: string;
  badge?: string;
  /** Illustrative score bars (label, 0–10), drawn under the lines. */
  bars?: Array<[string, number]>;
}

/** Pipeline of the Execution Council chapter: emerges from the report after the approval gate. */
const PIPELINE: Array<{ accent: string; optional?: boolean; at: V3 }> = [
  { accent: COLORS.cyan, at: [-0.4, 1.7, 1.5] },
  { accent: COLORS.blue, at: [1.6, 0.7, 1.8] },
  { accent: COLORS.mint, at: [-0.2, -0.4, 2] },
  { accent: COLORS.violet, at: [1.8, -1.5, 1.8] },
  { accent: COLORS.violet, optional: true, at: [0.5, -2.7, 2.2] },
];

// ---------------------------------------------------------------- textures

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const FONT = "Inter, 'Avenir Next', 'Segoe UI', system-ui, sans-serif";

function cardCanvas(spec: CardSpec) {
  const w = 640;
  const bars = spec.bars ?? [];
  const h = 146 + spec.lines.length * 60 + bars.length * 50;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  roundRect(ctx, 6, 6, w - 12, h - 12, 34);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "rgba(13, 26, 50, 0.95)");
  bg.addColorStop(1, "rgba(6, 12, 26, 0.95)");
  ctx.fillStyle = bg;
  ctx.fill();
  const border = ctx.createLinearGradient(0, 0, w, h);
  border.addColorStop(0, spec.accent);
  border.addColorStop(1, "rgba(139, 92, 246, 0.8)");
  ctx.lineWidth = 5;
  ctx.strokeStyle = border;
  ctx.stroke();
  // Translated texts are longer (owner: 5 languages): every text shrinks to its space instead of running into the next.
  const fitFont = (text: string, weight: number, size: number, min: number, max: number) => {
    let px = size;
    ctx.font = `${weight} ${px}px ${FONT}`;
    while (px > min && ctx.measureText(text).width > max) {
      px -= 2;
      ctx.font = `${weight} ${px}px ${FONT}`;
    }
  };
  let badgeWidth = 0;
  if (spec.badge) {
    ctx.font = `500 26px ${FONT}`;
    badgeWidth = ctx.measureText(spec.badge).width + 34;
    roundRect(ctx, w - badgeWidth - 32, 46, badgeWidth, 44, 22);
    ctx.strokeStyle = spec.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = spec.accent;
    ctx.fillText(spec.badge, w - badgeWidth - 15, 77);
  }
  ctx.fillStyle = COLORS.text;
  fitFont(spec.title, 600, 52, 30, w - 80 - (badgeWidth ? badgeWidth + 24 : 0));
  ctx.fillText(spec.title, 40, 88);
  spec.lines.forEach((line, i) => {
    const y = 152 + i * 60;
    ctx.fillStyle = spec.accent;
    ctx.beginPath();
    ctx.arc(54, y - 12, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#dbe4f5";
    fitFont(line, 400, 37, 24, w - 120);
    ctx.fillText(line, 80, y);
  });
  bars.forEach(([label, value], i) => {
    const y = 140 + spec.lines.length * 60 + i * 50;
    ctx.fillStyle = "#c7d2e8";
    fitFont(label, 400, 30, 20, 244);
    ctx.fillText(label, 44, y + 10);
    ctx.font = `400 30px ${FONT}`;
    roundRect(ctx, 300, y - 8, 250, 18, 9);
    ctx.fillStyle = "rgba(148, 186, 255, 0.18)";
    ctx.fill();
    roundRect(ctx, 300, y - 8, 25 * value, 18, 9);
    const g = ctx.createLinearGradient(300, 0, 550, 0);
    g.addColorStop(0, COLORS.cyan);
    g.addColorStop(1, COLORS.mint);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.fillText(value.toFixed(1), 566, y + 10);
  });
  return canvas;
}

function pillCanvas(text: string, color: string) {
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `600 34px ${FONT}`;
  const w = Math.ceil(probe.measureText(text).width) + 84;
  const h = 72;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  roundRect(ctx, 3, 3, w - 6, h - 6, 33);
  ctx.fillStyle = "rgba(8, 16, 32, 0.94)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, h / 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(text, 54, h / 2 + 12);
  return canvas;
}

// ---------------------------------------------------------------- shaders

const FRESNEL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.4);
  float a = (f * 0.9 + 0.05) * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}`;

// Plasma ball core (inspired by "plasma globe" visuals, written for Consyrion): glass sphere with flickering
// filaments from the centre to the glass; they bend towards the pointer, which also lights a contact spot.
const CORE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec2 uPointer;
uniform float uHover;
varying vec3 vNormal;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 n = normalize(vNormal);
  float facing = max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0);
  vec2 uv = n.xy;
  float r = length(uv);
  vec3 col = vec3(0.015, 0.03, 0.08) + vec3(0.04, 0.09, 0.2) * (1.0 - r);
  float pointerAngle = atan(uPointer.y, uPointer.x);
  float glow = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float ang = fi * 0.8976 + uTime * (0.22 + 0.06 * fi) + 0.6 * sin(uTime * 0.7 + fi * 1.7);
    float d = atan(sin(pointerAngle - ang), cos(pointerAngle - ang));
    ang += d * uHover * (0.6 + 0.12 * mod(fi, 3.0));
    vec2 dir = vec2(cos(ang), sin(ang));
    float along = dot(uv, dir);
    float across = dot(uv, vec2(-dir.y, dir.x));
    if (along > 0.0) {
      float wig = (n2(vec2(along * 6.0 - uTime * 3.0, fi * 7.0)) - 0.5) * 0.24 * along;
      float w = 0.012 + 0.022 * along;
      float s = w / (abs(across - wig) + w * 0.7);
      s *= smoothstep(1.02, 0.12, along) * smoothstep(0.0, 0.08, along);
      s *= 0.7 + 0.3 * n2(vec2(uTime * 9.0, fi * 13.0));
      glow += s;
    }
  }
  vec3 plasma = mix(vec3(0.13, 0.83, 0.93), vec3(0.55, 0.36, 0.96), 0.5 + 0.5 * sin(uTime * 0.5));
  col += plasma * glow * (0.55 + 0.35 * uHover);
  col += vec3(0.85, 0.97, 1.0) * pow(glow * 0.16, 2.0);
  col += plasma * exp(-r * r * 12.0) * 1.1;
  vec2 pdir = normalize(uPointer + vec2(1e-4));
  col += vec3(0.9, 0.98, 1.0) * exp(-length(uv - pdir * 0.92) * 16.0) * uHover * 1.6;
  float f = pow(1.0 - facing, 2.2);
  col += vec3(0.13, 0.83, 0.93) * f + vec3(0.55, 0.36, 0.96) * pow(f, 4.0) * 1.2;
  vec3 L = normalize(vec3(-0.4, 0.6, 0.7));
  col += pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0) * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- scene

export interface StoryScene {
  setProgress(progress: number): void;
  /** Pointer in canvas NDC (-1…1) or null; the plasma core reacts when it is near. */
  setPointer(pointer: { x: number; y: number } | null): void;
  /** Advance idle motion by `dt` seconds (0 when paused) and render. */
  frame(dt: number): void;
  resize(): void;
  dispose(): void;
}

/** Fraction in [0, 1), also for negative input. */
const wrap01 = (v: number) => ((v % 1) + 1) % 1;

const sample = (keys: Key[], b: Blend): Key => {
  const a = keys[b.from]!;
  const c = keys[b.to]!;
  return { p: [mix(a.p[0], c.p[0], b.t), mix(a.p[1], c.p[1], b.t), mix(a.p[2], c.p[2], b.t)], s: mix(a.s, c.s, b.t), o: mix(a.o, c.o, b.t) };
};

/** Returns null without WebGL 2, so the page shows the static story instead. */
export function createStoryScene(
  canvas: HTMLCanvasElement,
  options: {
    mobile: boolean;
    labels?: SceneLabels;
    /** "center": the scene sits in the middle of its canvas (sign-in page) instead of right of the story text. */
    framing?: "story" | "center";
    /** Star field inside the scene (off where the page already draws its own background). */
    stars?: boolean;
  },
): StoryScene | null {
  const L = options.labels ?? SCENE_LABELS_EN;
  const MODELS = MODEL_STYLE.map((m, i) => ({ ...m, role: L.models[i]?.role ?? SCENE_LABELS_EN.models[i]!.role, roles: L.models[i]?.roles ?? SCENE_LABELS_EN.models[i]!.roles }));
  const attributes = { alpha: true, antialias: true, powerPreference: "high-performance" as const };
  const context = canvas.getContext("webgl2", attributes) as WebGL2RenderingContext | null;
  if (!context) return null;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, context, ...attributes });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 200);
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T) => {
    disposables.push(item);
    return item;
  };
  const billboards: Mesh[] = [];

  const planeGeometry = track(new PlaneGeometry(1, 1));
  const sphereGeometry = track(new SphereGeometry(1, 72, 48));
  const smallSphere = track(new SphereGeometry(1, 20, 14));

  const textScale = options.mobile ? 1.3 : 1;
  /** `onTop` planes skip the depth test so spheres never cover their text. */
  const texturePlane = (source: HTMLCanvasElement, width: number, onTop = true) => {
    const texture = track(new CanvasTexture(source)) as Texture;
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const material = track(new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: !onTop, opacity: 0 }));
    const mesh = new Mesh(planeGeometry, material);
    mesh.userData.size = [width, (width * source.height) / source.width];
    mesh.renderOrder = onTop ? 10 : 2;
    billboards.push(mesh);
    scene.add(mesh);
    return mesh;
  };
  const card = (spec: CardSpec, width = 2.3) => texturePlane(cardCanvas(spec), width * textScale);
  const pill = (text: string, color: string, height = 0.34, onTop = true) => {
    const source = pillCanvas(text, color);
    return texturePlane(source, (height * textScale * source.width) / source.height, onTop);
  };
  const place = (mesh: Mesh, key: Key) => {
    const [w, h] = mesh.userData.size as [number, number];
    mesh.position.set(...key.p);
    mesh.scale.set(w * key.s, h * key.s, 1);
    (mesh.material as MeshBasicMaterial).opacity = key.o;
    mesh.visible = key.o > 0.01 && key.s > 0.01;
  };
  const halo = (color: string, strength: number) => {
    const material = track(
      new ShaderMaterial({
        vertexShader: SPHERE_VERTEX,
        fragmentShader: HALO_FRAGMENT,
        uniforms: { uColor: { value: new Color(color) }, uStrength: { value: strength } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    const mesh = new Mesh(planeGeometry, material);
    billboards.push(mesh);
    scene.add(mesh);
    return mesh;
  };

  // Stars.
  const starCount = options.mobile ? 260 : 600;
  const starPositions: number[] = [];
  for (let i = 0; i < starCount; i++) {
    const v = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(25 + Math.random() * 35);
    starPositions.push(v.x, v.y, v.z - 10);
  }
  const starGeometry = track(new BufferGeometry());
  starGeometry.setAttribute("position", new Float32BufferAttribute(starPositions, 3));
  if (options.stars !== false) scene.add(new Points(starGeometry, track(new PointsMaterial({ color: "#cfe8ff", size: 0.09, transparent: true, opacity: 0.75 }))));

  // Core with the original mark (from the shipped SVG asset) on a camera-facing plane in front of it.
  const coreMaterial = track(
    new ShaderMaterial({
      vertexShader: SPHERE_VERTEX,
      fragmentShader: CORE_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uPointer: { value: new Vector2(0.7, 0.7) }, uHover: { value: 0 } },
    }),
  );
  const core = new Mesh(sphereGeometry, coreMaterial);
  scene.add(core);
  const coreHalo = halo(COLORS.cyan, 0.45);
  const logoCanvas = document.createElement("canvas");
  logoCanvas.width = 1024;
  logoCanvas.height = 1024;
  const logo = texturePlane(logoCanvas, 1, false);
  const logoImage = new Image();
  logoImage.onload = () => {
    const ctx = logoCanvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(logoImage, 0, 0, 1024, 1024);
    ((logo.material as MeshBasicMaterial).map as Texture).needsUpdate = true;
  };
  logoImage.src = "/brand/consyrion-mark.svg";
  const CORE_KEYS = fillForward<Key>(
    [{ p: [0, 0, 0], s: 1.2, o: 1 }, { p: [0, 0.2, -0.5], s: 0.95, o: 1 }, { p: [0, 0.1, -0.5], s: 0.85, o: 1 }, undefined, undefined, undefined, undefined, { p: [0, 0.2, -1.2], s: 0.8, o: 1 }, undefined, { p: [-3.4, 0.9, -1], s: 0.7, o: 1 }, undefined],
    CHAPTERS,
    HIDDEN,
  );

  // Models.
  const models = MODELS.map((m, index) => {
    const material = track(
      new ShaderMaterial({
        vertexShader: SPHERE_VERTEX,
        fragmentShader: SPHERE_FRAGMENT,
        uniforms: {
          uColor: { value: new Color(m.color) },
          uTint: { value: new Color(m.tint) },
          uLight: { value: new Vector3(-0.5, 0.6, 0.6).normalize() },
          uAngle: { value: 0 },
          uSeed: { value: index * 3.7 },
        },
      }),
    );
    const mesh = new Mesh(sphereGeometry, material);
    scene.add(mesh);
    const bubbleMaterial = track(
      new ShaderMaterial({
        vertexShader: SPHERE_VERTEX,
        fragmentShader: FRESNEL_FRAGMENT,
        uniforms: { uColor: { value: new Color(m.tint) }, uOpacity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    const bubble = new Mesh(sphereGeometry, bubbleMaterial);
    scene.add(bubble);
    const letter = String.fromCharCode(65 + index);
    return {
      ...m,
      mesh,
      material,
      halo: halo(m.color, 0.5),
      bubble,
      bubbleMaterial,
      keys: fillForward(MODEL_KEYS[index]!, CHAPTERS, HIDDEN),
      keyChip: pill(L.apiKey, m.color, 0.3),
      // Depth-tested, so a model orbiting behind the core hides its labels with it.
      nameChip: pill(m.name, m.color, 0.42, false),
      roleChip: pill(m.role, m.color, 0.32, false),
      proposal: card({ title: L.proposal.replace("{letter}", letter), lines: [L.proposalLines[index] ?? "", L.evidenceAttached], accent: m.color }),
      satellites: m.roles.map((role) => {
        const dot = new Mesh(smallSphere, track(new MeshBasicMaterial({ color: m.tint, transparent: true, opacity: 0 })));
        scene.add(dot);
        return { role, dot, label: pill(role, m.color, 0.28) };
      }),
      position: new Vector3(),
      /** Pointer reaction state: proximity (0–1), extra spin and lean towards the cursor in screen space. */
      hover: 0,
      spin: 0,
      lean: new Vector3(),
    };
  });
  // Intro guests: sphere, halo and name only (no keys, roles or proposals).
  const guests = GUEST_STYLE.map((g, index) => {
    const material = track(
      new ShaderMaterial({
        vertexShader: SPHERE_VERTEX,
        fragmentShader: SPHERE_FRAGMENT,
        uniforms: {
          uColor: { value: new Color(g.color) },
          uTint: { value: new Color(g.tint) },
          uLight: { value: new Vector3(-0.5, 0.6, 0.6).normalize() },
          uAngle: { value: 0 },
          uSeed: { value: 11 + index * 3.7 },
        },
      }),
    );
    const mesh = new Mesh(sphereGeometry, material);
    scene.add(mesh);
    return { ...g, mesh, material, halo: halo(g.color, 0.5), nameChip: pill(g.name, g.color, 0.42, false), position: new Vector3(), hover: 0, spin: 0, lean: new Vector3() };
  });
  const FORMATION = fillForward<number>([0, 1], CHAPTERS, 0);
  const BUBBLE = fillForward<number>([0, 0, 1, 0], CHAPTERS, 0);
  const KEY_CHIP = fillForward<number>([0, 1, 0], CHAPTERS, 0);
  const ROLE_CHIP = fillForward<number>([1, 0, 1, 1, 0], CHAPTERS, 0);
  const DECISION_CHIP = fillForward<number>([1, 1, 1, 1, 1, 1, 1, 0], CHAPTERS, 0);
  const decisionChip = pill(L.decision, COLORS.cyan, 0.4);
  const SATELLITES = fillForward<number>([0, 0, 0, 0, 1, 0.9, 0], CHAPTERS, 0);
  const HIGHLIGHT = fillForward<number>([0, 0, 0, 0, 0, 1, 0], CHAPTERS, 0);
  const QUESTIONS = fillForward<number>([0, 0, 0, 1, 0.7, 0.25, 0], CHAPTERS, 0);
  const PROPOSAL_FRONT: V3[] = [
    [-2.7, -0.7, 2.6],
    [0, -0.7, 2.9],
    [2.7, -0.7, 2.6],
  ];

  // Brief, objection, evidence, hybrid, difference note, report, gate, pipeline.
  const brief = card({ title: L.brief.title, lines: L.brief.lines, accent: COLORS.cyan, badge: L.example }, 2.6);
  const BRIEF = fillForward<Key>([HIDDEN, { p: [0, -0.2, 2.4], s: 1, o: 1 }, { p: [0, -0.2, 2.4], s: 0.4, o: 0 }], CHAPTERS, HIDDEN);
  const objection = card({ title: L.objection.title, lines: L.objection.lines, accent: COLORS.amber }, 2.3);
  const OBJECTION = fillForward<Key>([HIDDEN, undefined, undefined, undefined, undefined, { p: [2.4, -1.9, 2.4], s: 0.95, o: 1 }, { p: [2.4, -1.9, 2.4], s: 0.5, o: 0 }], CHAPTERS, HIDDEN);
  const evidence = L.evidence.slice(0, 2).map((e) => pill(e, COLORS.amber, 0.3));
  const EVIDENCE: V3[] = [
    [0.4, -3.1, 2.2],
    [4.3, -3.1, 2.0],
  ];
  const hybrid = card({ title: L.hybrid.title, lines: L.hybrid.lines, accent: COLORS.mint }, 2.4);
  const HYBRID = fillForward<Key>([HIDDEN, undefined, undefined, undefined, undefined, { p: [-0.4, -1.2, 3.0], s: 0.4, o: 0 }, { p: [-0.4, -1.2, 3.0], s: 1, o: 1 }, { p: [0, 0.1, 2.8], s: 0.6, o: 0 }], CHAPTERS, HIDDEN);
  const difference = pill(L.difference, COLORS.violet, 0.3);
  const DIFFERENCE = fillForward<Key>([HIDDEN, undefined, undefined, undefined, undefined, undefined, { p: [2.5, -2.45, 1.7], s: 1, o: 1 }, HIDDEN], CHAPTERS, HIDDEN);
  const report = card(
    {
      title: L.report.title,
      lines: L.report.lines,
      accent: COLORS.cyan,
      badge: L.example,
      bars: [
        [L.report.bars[0] ?? "", 8.5],
        [L.report.bars[1] ?? "", 7],
        [L.report.bars[2] ?? "", 7.5],
      ],
    },
    2.7,
  );
  const REPORT = fillForward<Key>([HIDDEN, undefined, undefined, undefined, undefined, undefined, { p: [0, 0.1, 2.8], s: 0.5, o: 0 }, { p: [0, 0.1, 2.8], s: 1.25, o: 1 }, { p: [0, 0.2, 2.2], s: 0.95, o: 1 }, { p: [-2.9, 0.9, 0.6], s: 0.75, o: 1 }], CHAPTERS, HIDDEN);
  const gateMaterial = track(new MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0 }));
  const gate = new Mesh(track(new TorusGeometry(1.75, 0.045, 16, 120)), gateMaterial);
  scene.add(gate);
  const gateGlow = halo(COLORS.amber, 0.25);
  const GATE = fillForward<Key>([HIDDEN, undefined, undefined, undefined, undefined, undefined, undefined, { p: [0, 0.2, 2.6], s: 1.4, o: 0 }, { p: [0, 0.2, 2.6], s: 1, o: 1 }, { p: [0, 0.2, 2.6], s: 1.6, o: 0 }], CHAPTERS, HIDDEN);
  const awaiting = pill(L.awaiting, COLORS.amber, 0.36);
  const approved = pill(L.approved, COLORS.mint, 0.36);
  const pipeline = PIPELINE.map((step, i) => card({ title: L.pipeline[i]?.title ?? "", lines: L.pipeline[i]?.lines ?? [], accent: step.accent, badge: step.optional ? L.optional : undefined }, 1.9));
  const PIPE_ON = fillForward<number>([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], CHAPTERS, 0);

  // Lines: questions between the models, objection links, pipeline path.
  const lineMaterial = (color: string) => track(new LineBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
  const dynamicLine = (color: string, points: number) => {
    const geometry = track(new BufferGeometry());
    geometry.setAttribute("position", new Float32BufferAttribute(new Array(points * 3).fill(0), 3));
    const line = new Line(geometry, lineMaterial(color));
    scene.add(line);
    return line;
  };
  const setLine = (line: Line, pts: Vector3[], opacity: number) => {
    const attr = line.geometry.getAttribute("position") as Float32BufferAttribute;
    pts.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
    attr.needsUpdate = true;
    (line.material as LineBasicMaterial).opacity = opacity;
    line.visible = opacity > 0.01;
  };
  const pulseDot = (color: string) => {
    const mesh = new Mesh(smallSphere, track(new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false })));
    scene.add(mesh);
    return mesh;
  };
  const questions = [0, 1, 2].map((i) => ({ line: dynamicLine(MODELS[i]!.tint, 32), dot: pulseDot("#ffffff"), from: i, to: (i + 1) % 3 }));
  const objectionLines = [dynamicLine(COLORS.amber, 2), dynamicLine(COLORS.amber, 2), dynamicLine(COLORS.amber, 2)];
  const pipePath = dynamicLine(COLORS.cyan, 64);
  const pipeDots = [pulseDot(COLORS.cyan), pulseDot(COLORS.violet)];

  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Sparks rising around the plasma core.
  const sparkCount = options.mobile ? 160 : 420;
  const sparkSeed = Array.from({ length: sparkCount }, () => ({ a: random() * Math.PI * 2, r: 1.15 + random() * 0.9, phase: random(), speed: 0.08 + random() * 0.18, z: (random() - 0.5) * 1.4 }));
  const sparkGeometry = track(new BufferGeometry());
  sparkGeometry.setAttribute("position", new Float32BufferAttribute(new Array(sparkCount * 3).fill(0), 3));
  const sparkMaterial = track(new PointsMaterial({ color: "#a5f3fc", size: 0.05, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }));
  const sparks = new Points(sparkGeometry, sparkMaterial);
  scene.add(sparks);

  // Moments with their own visual signature (all driven by the scroll position, so they also play backwards).
  const burst = (color: string, count: number, size: number) => {
    const dirs = Array.from({ length: count }, () => new Vector3(random() - 0.5, random() - 0.5, (random() - 0.5) * 0.6).normalize());
    const geometry = track(new BufferGeometry());
    geometry.setAttribute("position", new Float32BufferAttribute(new Array(count * 3).fill(0), 3));
    const material = track(new PointsMaterial({ color, size, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    const points = new Points(geometry, material);
    points.renderOrder = 5;
    scene.add(points);
    return { dirs, points, material, attr: geometry.getAttribute("position") as Float32BufferAttribute };
  };
  const setBurst = (b: ReturnType<typeof burst>, origin: Vector3, t: number, from: number, to: number) => {
    const on = t > 0 && t < 1;
    b.points.visible = on;
    if (!on) return;
    b.dirs.forEach((d, i) => b.attr.setXYZ(i, origin.x + d.x * mix(from, to, t), origin.y + d.y * mix(from, to, t), origin.z + d.z * mix(from, to, t)));
    b.attr.needsUpdate = true;
    b.material.opacity = (1 - t) * Math.min(1, t * 6);
  };
  const revealBursts = MODELS.map((m) => burst(m.tint, 46, 0.11));
  const approvalBurst = burst(COLORS.mint, 90, 0.12);
  const spotlight = halo(COLORS.amber, 0);
  const objectionRing = new Mesh(track(new TorusGeometry(1.55, 0.03, 12, 96)), track(new MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0, depthWrite: false })));
  objectionRing.renderOrder = 9;
  scene.add(objectionRing);
  const reportGlow = halo(COLORS.cyan, 0);
  const rays = MODELS.map((m) => dynamicLine(m.tint, 2));
  const RAYS = fillForward<number>([0, 0, 0, 0, 0, 0, 0, 1, 0.35, 0], CHAPTERS, 0);

  // ---------------------------------------------------------------- state
  let progress = 0;
  let time = 0;
  /** Pointer in canvas NDC (-1…1), or null when outside / on touch release. */
  let pointer: { x: number; y: number } | null = null;
  let hover = 0;
  const pointerUv = new Vector2(0.7, 0.7);
  let width = 1;
  let height = 1;
  const ndcA = new Vector3();
  const ndcB = new Vector3();
  const tmp = new Vector3();
  const target = new Vector3();

  const resize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.mobile ? 1.5 : 1.75));
    width = canvas.clientWidth || 1;
    height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Desktop: the chapters cover the left part, so the scene's centre moves right. Portrait: up.
    if (options.framing === "center") camera.clearViewOffset();
    else if (width / height > 1.1) camera.setViewOffset(width, height, -width * 0.17, 0, width, height);
    else camera.setViewOffset(width, height, 0, height * 0.2, width, height);
    camera.updateProjectionMatrix();
  };
  resize();

  const lightFor = (from: Vector3, material: ShaderMaterial) => {
    ndcA.copy(from).project(camera);
    ndcB.copy(core.position).project(camera);
    const light = material.uniforms.uLight!.value as Vector3;
    light.set(ndcB.x - ndcA.x, ndcB.y - ndcA.y, 0);
    if (light.lengthSq() < 1e-6) light.set(-0.5, 0.6, 0);
    light.normalize().multiplyScalar(0.8).add(tmp.set(0, 0.15, 0.62)).normalize();
  };

  const update = () => {
    const b = blendAt(progress, LAST);
    const at = (values: number[]) => mix(values[b.from]!, values[b.to]!, b.t);

    // Camera; portrait screens step back so the whole formation fits.
    const ca = CAMERA_FILLED[b.from]!;
    const cb = CAMERA_FILLED[b.to]!;
    // Landscape: the chapters cover the left part, so step back until the formation fits the right part.
    // Portrait: step back further so the formation fits the narrow width.
    const back = options.framing === "center" ? 0.95 * Math.max(1, 1.5 / camera.aspect) : camera.aspect > 1.1 ? 1.4 : Math.min(2.4, Math.max(1.4, 1.1 / camera.aspect));
    camera.position.set(mix(ca.pos[0], cb.pos[0], b.t), mix(ca.pos[1], cb.pos[1], b.t), mix(ca.pos[2], cb.pos[2], b.t) * back);
    target.set(mix(ca.target[0], cb.target[0], b.t), mix(ca.target[1], cb.target[1], b.t), mix(ca.target[2], cb.target[2], b.t));
    camera.lookAt(target);
    camera.updateMatrixWorld();

    // Core and logo.
    const c = sample(CORE_KEYS, b);
    core.position.set(...c.p);
    core.scale.setScalar(c.s);
    place(decisionChip, { p: [core.position.x, core.position.y - c.s * 1.25, core.position.z + c.s + 0.2], s: 1, o: c.o * at(DECISION_CHIP) });
    coreHalo.position.copy(core.position);
    coreHalo.scale.setScalar(c.s * 4.2 * (1 + 0.04 * Math.sin(time * 1.4)));
    tmp.copy(camera.position).sub(core.position).normalize().multiplyScalar(c.s * 1.02);
    logo.position.copy(core.position).add(tmp);
    logo.scale.set(c.s * 1.2, c.s * 1.2, 1);
    (logo.material as MeshBasicMaterial).opacity = c.o;
    logo.visible = true;

    // Plasma: filaments bend towards a nearby pointer; sparks rise around the ball.
    coreMaterial.uniforms.uTime!.value = time;
    ndcA.copy(core.position).project(camera);
    ndcB.copy(core.position).add(tmp.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(c.s)).project(camera);
    const radiusNdc = Math.max(0.01, Math.abs(ndcB.x - ndcA.x));
    let hoverTarget = 0;
    if (pointer) {
      const ux = (pointer.x - ndcA.x) / radiusNdc;
      const uy = ((pointer.y - ndcA.y) / radiusNdc) * (1 / camera.aspect);
      const dist = Math.hypot(ux, uy);
      hoverTarget = Math.max(0, Math.min(1, (3.2 - dist) / 2));
      if (dist > 0.001) pointerUv.lerp(new Vector2(ux / dist, uy / dist), 0.25);
    }
    hover += (hoverTarget - hover) * 0.12;
    coreMaterial.uniforms.uHover!.value = hover;
    (coreMaterial.uniforms.uPointer!.value as Vector2).copy(pointerUv);
    const sparkAttr = sparkGeometry.getAttribute("position") as Float32BufferAttribute;
    sparkSeed.forEach((sp, i) => {
      const life = wrap01(sp.phase + time * sp.speed);
      const rr = sp.r * c.s;
      sparkAttr.setXYZ(i, core.position.x + Math.cos(sp.a + life * 0.6) * rr, core.position.y - rr * 0.8 + life * rr * 2.2, core.position.z + sp.z * c.s);
    });
    sparkAttr.needsUpdate = true;
    sparkMaterial.opacity = 0.75 * c.o * (0.6 + 0.4 * hover);

    // Models: orbit in the intro, formation afterwards.
    const formation = at(FORMATION);
    models.forEach((m, index) => {
      const angle = time * 0.13 + (index * 2 * Math.PI * 2) / ORBIT_SLOTS;
      const orbit = new Vector3(ORBIT.radius * Math.cos(angle), 0, ORBIT.radius * Math.sin(angle)).applyAxisAngle(new Vector3(1, 0, 0), ORBIT.tilt);
      const k = sample(m.keys, b);
      m.position.set(mix(orbit.x, k.p[0], formation), mix(orbit.y, k.p[1], formation), mix(orbit.z, k.p[2], formation));
      // Pointer (owner request 06.11.26: the model spheres should react like the core): a nearby cursor makes a sphere
      // glow, grow a little, spin faster and lean towards the cursor. Reduced motion never runs this loop.
      ndcA.copy(m.position).project(camera);
      let near = 0;
      if (pointer) {
        const dx = pointer.x - ndcA.x;
        const dy = (pointer.y - ndcA.y) / camera.aspect;
        near = Math.max(0, Math.min(1, (0.32 - Math.hypot(dx, dy)) / 0.2));
        tmp.set(dx, pointer.y - ndcA.y, 0).normalize();
        m.lean.lerp(new Vector3(tmp.x, tmp.y, 0).multiplyScalar(0.28 * near), 0.12);
      } else m.lean.multiplyScalar(0.9);
      m.hover += (near - m.hover) * 0.12;
      m.spin += 0.004 + 0.03 * m.hover;
      m.position
        .add(tmp.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(m.lean.x))
        .add(tmp.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(m.lean.y));
      const s = 0.62 * mix(ORBIT.scale, k.s, formation) * (1 + 0.12 * m.hover);
      m.mesh.position.copy(m.position);
      m.mesh.scale.setScalar(s);
      m.material.uniforms.uAngle!.value = time * (0.25 + index * 0.04) + m.spin;
      lightFor(m.position, m.material);
      m.halo.position.copy(m.position);
      // Open Council: each sealed bubble bursts and its model flares up.
      const reveal = Math.min(1, Math.max(0, (progress - 2.5) / 0.75));
      m.halo.scale.setScalar(s * 2.6 * (1 + 1.4 * Math.sin(Math.PI * reveal)) * (1 + 0.5 * m.hover));
      setBurst(revealBursts[index]!, m.position, reveal, 0.8, 3.2);
      m.bubble.position.copy(m.position);
      const bubble = at(BUBBLE);
      m.bubble.scale.setScalar(s * (1.75 + 0.25 * (1 - bubble)));
      m.bubbleMaterial.uniforms.uOpacity!.value = bubble;
      m.bubble.visible = bubble > 0.01;
      place(m.keyChip, { p: [m.position.x, m.position.y - 1.05, m.position.z + 0.4], s: 1, o: at(KEY_CHIP) });
      // Model name above the sphere in every chapter; its role below it until the 12 Minds satellites take over.
      place(m.nameChip, { p: [m.position.x, m.position.y + s * 1.55, m.position.z + 0.4], s: 1, o: 1 });
      place(m.roleChip, { p: [m.position.x, m.position.y - s * 1.55, m.position.z + 0.4], s: 1, o: at(ROLE_CHIP) });
    });

    // Intro guests: same orbit, odd slots; they shrink into the core as the formation starts.
    guests.forEach((g, index) => {
      const angle = time * 0.13 + ((index * 2 + 1) * Math.PI * 2) / ORBIT_SLOTS;
      const orbit = new Vector3(ORBIT.radius * Math.cos(angle), 0, ORBIT.radius * Math.sin(angle)).applyAxisAngle(new Vector3(1, 0, 0), ORBIT.tilt);
      const away = Math.min(1, formation * 1.6);
      g.position.set(mix(orbit.x, core.position.x, away), mix(orbit.y, core.position.y, away), mix(orbit.z, core.position.z, away));
      ndcA.copy(g.position).project(camera);
      let near = 0;
      if (pointer) {
        const dx = pointer.x - ndcA.x;
        const dy = (pointer.y - ndcA.y) / camera.aspect;
        near = Math.max(0, Math.min(1, (0.32 - Math.hypot(dx, dy)) / 0.2));
        tmp.set(dx, pointer.y - ndcA.y, 0).normalize();
        g.lean.lerp(new Vector3(tmp.x, tmp.y, 0).multiplyScalar(0.28 * near), 0.12);
      } else g.lean.multiplyScalar(0.9);
      g.hover += (near - g.hover) * 0.12;
      g.spin += 0.004 + 0.03 * g.hover;
      g.position
        .add(tmp.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(g.lean.x))
        .add(tmp.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(g.lean.y));
      const s = 0.62 * ORBIT.scale * (1 - away) * (1 + 0.12 * g.hover);
      const shown = s > 0.01;
      g.mesh.visible = shown;
      g.halo.visible = shown;
      g.mesh.position.copy(g.position);
      g.mesh.scale.setScalar(Math.max(s, 0.001));
      g.material.uniforms.uAngle!.value = time * (0.27 + index * 0.04) + g.spin;
      lightFor(g.position, g.material);
      g.halo.position.copy(g.position);
      g.halo.scale.setScalar(s * 2.6 * (1 + 0.5 * g.hover));
      place(g.nameChip, { p: [g.position.x, g.position.y + s * 1.55, g.position.z + 0.4], s: 1, o: 1 - away });
    });

    // Proposals: sealed with their model → revealed side by side → back to the model → merged.
    models.forEach((m, index) => {
      const near: V3 = [m.position.x, m.position.y - 1.15, m.position.z + 0.6];
      const sealed: V3 = [m.position.x, m.position.y, m.position.z + 0.3];
      const merged: V3 = index === 1 ? [2.5, -1.3, 1.6] : [index === 0 ? -0.8 : 0.8, -1.2, 2.8];
      const keys = fillForward<Key>(
        [HIDDEN, HIDDEN, { p: sealed, s: 0.42, o: 0.35 }, { p: PROPOSAL_FRONT[index]!, s: 1, o: 1 }, { p: near, s: 0.55, o: 0.75 }, { p: near, s: 0.55, o: 0.5 }, { p: merged, s: 0.8, o: index === 1 ? 0.9 : 0.25 }, { p: [0, 0.1, 2.8], s: 0.5, o: 0 }],
        CHAPTERS,
        HIDDEN,
      );
      const pk = sample(keys, b);
      place(m.proposal, { ...pk, o: pk.o * (1 - 0.6 * at(HIGHLIGHT)) });
    });

    // 12 Minds: four role satellites per model; Minority Review highlights one security role.
    const satellites = at(SATELLITES);
    const highlight = at(HIGHLIGHT);
    models.forEach((m, mi) => {
      m.satellites.forEach((sat, si) => {
        const a = time * 0.35 + (si * Math.PI) / 2 + mi;
        const isFocus = mi === 1 && si === 0;
        const radius = 1.3;
        sat.dot.position.set(m.position.x + radius * Math.cos(a), m.position.y + radius * 0.45 * Math.sin(a), m.position.z + radius * 0.6 * Math.sin(a) + 0.2);
        const dim = isFocus ? 1 : 1 - highlight * 0.7;
        sat.dot.scale.setScalar(0.12 * satellites * (isFocus ? 1 + highlight * 1.2 : 1));
        const dotMaterial = sat.dot.material as MeshBasicMaterial;
        dotMaterial.opacity = satellites * dim;
        dotMaterial.color.set(isFocus && highlight > 0.5 ? COLORS.amber : m.tint);
        sat.dot.visible = satellites > 0.01;
        // Label pushed outward from the model so it never sits on the sphere.
        tmp.copy(sat.dot.position).sub(m.position).setZ(0).normalize();
        place(sat.label, { p: [sat.dot.position.x + tmp.x * 0.45, sat.dot.position.y + tmp.y * 0.3 + 0.22, sat.dot.position.z + 0.3], s: isFocus ? 1 + highlight * 0.3 : 1, o: satellites * dim });
      });
    });

    // Questions travelling between the models.
    const q = at(QUESTIONS);
    questions.forEach((item, i) => {
      const a = models[item.from]!.position;
      const c2 = models[item.to]!.position;
      const mid = a.clone().add(c2).multiplyScalar(0.5).add(new Vector3(0, 0, 1.6));
      const curve = new QuadraticBezierCurve3(a, mid, c2);
      setLine(item.line, curve.getPoints(31), q * 0.55 * (1 - 0.7 * at(HIGHLIGHT)));
      const t = wrap01(time * 0.35 + i / 3);
      item.dot.position.copy(curve.getPoint(t));
      item.dot.scale.setScalar(0.07);
      (item.dot.material as MeshBasicMaterial).opacity = q;
      item.dot.visible = q > 0.01;
    });

    // Minority Review: objection with evidence.
    const o = sample(OBJECTION, b);
    place(objection, o);
    const focus = models[1]!.satellites[0]!.dot.position;
    setLine(objectionLines[0]!, [focus.clone(), new Vector3(...o.p)], o.o * 0.8);
    evidence.forEach((chip, i) => {
      place(chip, { p: EVIDENCE[i]!, s: 1, o: o.o });
      setLine(objectionLines[i + 1]!, [new Vector3(...o.p), new Vector3(...EVIDENCE[i]!)], o.o * 0.6);
    });

    // Minority Review: amber spotlight and a pulsing ring single out the objection.
    spotlight.position.set(o.p[0], o.p[1], o.p[2] - 0.2);
    spotlight.scale.setScalar(6.5 * o.s);
    (spotlight.material as ShaderMaterial).uniforms.uStrength!.value = 0.42 * o.o;
    spotlight.visible = o.o > 0.01;
    objectionRing.position.set(o.p[0], o.p[1], o.p[2] - 0.05);
    objectionRing.scale.set(1.15 * (1 + 0.06 * Math.sin(time * 3)), 0.78 * (1 + 0.06 * Math.sin(time * 3)), 1);
    objectionRing.quaternion.copy(camera.quaternion);
    (objectionRing.material as MeshBasicMaterial).opacity = 0.85 * o.o;
    objectionRing.visible = o.o > 0.01;

    // Consensus, verdict, approval gate.
    place(hybrid, sample(HYBRID, b));
    place(difference, sample(DIFFERENCE, b));
    const r = sample(REPORT, b);
    place(report, r);
    // Final Verdict: light rays from every model converge in the report.
    const rayOn = at(RAYS);
    models.forEach((m, i) => setLine(rays[i]!, [m.position.clone(), new Vector3(...r.p)], rayOn * 0.9));
    reportGlow.position.set(r.p[0], r.p[1], r.p[2] - 0.3);
    reportGlow.scale.setScalar(7 * r.s);
    (reportGlow.material as ShaderMaterial).uniforms.uStrength!.value = 0.32 * rayOn;
    reportGlow.visible = rayOn > 0.01;
    place(brief, sample(BRIEF, b));
    const g = sample(GATE, b);
    gate.position.set(...g.p);
    gate.scale.setScalar(g.s);
    gate.quaternion.copy(camera.quaternion);
    const approvedness = Math.min(1, Math.max(0, (progress - 8.15) / 0.25));
    gateMaterial.color.set(COLORS.amber).lerp(new Color(COLORS.mint), approvedness);
    gateMaterial.opacity = g.o;
    gate.visible = g.o > 0.01;
    gateGlow.position.copy(gate.position);
    gateGlow.scale.setScalar(g.s * 5.4);
    ((gateGlow.material as ShaderMaterial).uniforms.uColor!.value as Color).copy(gateMaterial.color);
    (gateGlow.material as ShaderMaterial).uniforms.uStrength!.value = 0.25 * g.o;
    gateGlow.visible = g.o > 0.01;
    place(awaiting, { p: [g.p[0], g.p[1] - 2.05, g.p[2] + 0.1], s: 1, o: g.o * (1 - approvedness) });
    place(approved, { p: [g.p[0], g.p[1] - 2.05, g.p[2] + 0.1], s: 1, o: g.o * approvedness });
    // Approval: a ring of light bursts out of the gate once it turns green.
    setBurst(approvalBurst, new Vector3(...g.p), Math.min(1, Math.max(0, (progress - 8.3) / 0.6)), 1.8, 4.2);

    // Execution Council: the pipeline grows out of the report.
    const pipeOn = at(PIPE_ON);
    const origin = new Vector3(...r.p);
    const points = PIPELINE.map((step) => new Vector3(...step.at).lerp(origin, 1 - pipeOn));
    pipeline.forEach((mesh, i) => place(mesh, { p: points[i]!.toArray() as V3, s: 0.35 + 0.55 * pipeOn, o: pipeOn }));
    const path = new CatmullRomCurve3([origin.clone(), ...points]);
    setLine(pipePath, path.getPoints(63), pipeOn * 0.6);
    pipeDots.forEach((dot, i) => {
      dot.position.copy(path.getPoint(wrap01(time * 0.18 + i * 0.5)));
      dot.scale.setScalar(0.08);
      (dot.material as MeshBasicMaterial).opacity = pipeOn;
      dot.visible = pipeOn > 0.01;
    });

    for (const mesh of billboards) mesh.quaternion.copy(camera.quaternion);
  };

  return {
    setProgress(p) {
      progress = p;
    },
    setPointer(p) {
      pointer = p;
    },
    frame(dt) {
      time += dt;
      update();
      renderer.render(scene, camera);
    },
    resize,
    dispose() {
      for (const item of disposables) item.dispose();
      renderer.dispose();
    },
  };
}

const CAMERA_FILLED = fillForward(CAMERA, CHAPTERS, CAMERA[0]!);

