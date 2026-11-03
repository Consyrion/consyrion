import { AdditiveBlending, Color, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, SphereGeometry, Vector3, WebGLRenderer } from "three";

export interface SphereSpec {
  color: string;
  tint: string;
  radius: number;
  /** Seconds per turn around the sphere's own axis. */
  spin: number;
}

/** Per-frame state of one sphere in SVG view-box space (y down). */
export interface SphereState {
  x: number;
  y: number;
  scale: number;
  /** -1 (far side of the orbit) … 1 (near side). */
  depth: number;
  visible: boolean;
}

export interface Spheres3D {
  render(states: SphereState[], seconds: number): void;
  resize(): void;
  dispose(): void;
}

export const SPHERE_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vPos;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Marbled planet: fbm-warped bands that turn with the sphere, lit by the logo in the centre (the "sun") plus a
// soft fill from the viewer, with a specular highlight and a coloured fresnel rim.
export const SPHERE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTint;
uniform vec3 uLight;
uniform float uAngle;
uniform float uSeed;
varying vec3 vNormal;
varying vec3 vPos;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 p = normalize(vPos);
  float c = cos(uAngle);
  float s = sin(uAngle);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  p.y += 0.25 * p.x;
  float warp = fbm(p * 1.6 + uSeed);
  float bands = sin(p.y * 6.0 + warp * 4.5);
  float marble = smoothstep(-1.0, 1.0, bands);
  vec3 base = mix(uColor * 0.5, mix(uColor, uTint, 0.45), marble * 0.85);
  float smoothWarp = noise(p * 1.3 + uSeed) + 0.5 * noise(p * 2.6 + uSeed);
  float line = 1.0 - smoothstep(0.0, 0.04, abs(fract(p.y * 3.5 + smoothWarp * 2.2) - 0.5));
  base += uTint * line * 0.4;

  float diffuse = max(dot(n, uLight), 0.0) * 0.85 + 0.22;
  float spec = pow(max(dot(reflect(-uLight, n), vec3(0.0, 0.0, 1.0)), 0.0), 36.0) * 0.55;
  float fresnel = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 2.0);
  vec3 col = base * diffuse + vec3(spec) + uColor * fresnel * 0.8 + uTint * pow(fresnel, 3.5) * 1.5;
  gl_FragColor = vec4(col, 1.0);
}`;

// Limited halo: a soft radial glow on a camera-facing quad behind each sphere.
export const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vPos;
void main() {
  float d = length(vPos.xy) * 2.0;
  float a = smoothstep(1.0, 0.42, d) * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}`;

/**
 * WebGL spheres for the sign-in illustration. An orthographic camera matches the SVG view box, so the spheres
 * sit exactly where the SVG geometry puts them; depth orders the spheres and drives their size. Two instances
 * (behind and in front of the SVG logo core) give real occlusion. Returns null without WebGL.
 */
export function createSpheres3D(canvas: HTMLCanvasElement, specs: SphereSpec[], viewBox: { x: number; y: number; width: number; height: number }): Spheres3D | null {
  // Probe first so a missing WebGL ends in the SVG fallback without three.js logging an error.
  const attributes = { alpha: true, antialias: true, powerPreference: "low-power" as const };
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
  // y up in three.js; SVG y is down, so positions are negated on the way in.
  const camera = new OrthographicCamera(viewBox.x, viewBox.x + viewBox.width, -viewBox.y, -(viewBox.y + viewBox.height), -1000, 1000);
  camera.position.z = 500;
  const sphereGeometry = new SphereGeometry(1, 96, 64);
  const haloGeometry = new PlaneGeometry(1, 1);
  const fill = new Vector3(0, 0.15, 0.62);
  const parts = specs.map((spec, index) => {
    const material = new ShaderMaterial({
      vertexShader: SPHERE_VERTEX,
      fragmentShader: SPHERE_FRAGMENT,
      uniforms: {
        uColor: { value: new Color(spec.color) },
        uTint: { value: new Color(spec.tint) },
        uLight: { value: new Vector3(-0.5, 0.6, 0.6).normalize() },
        uAngle: { value: 0 },
        uSeed: { value: index * 3.7 },
      },
    });
    const haloMaterial = new ShaderMaterial({
      vertexShader: SPHERE_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      uniforms: { uColor: { value: new Color(spec.color) }, uStrength: { value: 0.5 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const sphere = new Mesh(sphereGeometry, material);
    const halo = new Mesh(haloGeometry, haloMaterial);
    scene.add(halo, sphere);
    return { spec, sphere, halo, material, haloMaterial };
  });

  const resize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  };
  resize();

  return {
    render(states, seconds) {
      parts.forEach(({ spec, sphere, halo, material }, index) => {
        const state = states[index];
        const visible = Boolean(state?.visible);
        sphere.visible = visible;
        halo.visible = visible;
        if (!state || !visible) return;
        const r = spec.radius * state.scale;
        // Nearer spheres get a higher z so they cover farther ones within the same layer.
        sphere.position.set(state.x, -state.y, state.depth * 100);
        sphere.scale.setScalar(r);
        halo.position.set(state.x, -state.y, state.depth * 100 - 60);
        halo.scale.setScalar(r * 2.3);
        // Sunlight from the logo in the centre, softened by a fill from the viewer.
        const light = material.uniforms.uLight!.value as Vector3;
        light.set(-state.x, state.y, 0).normalize().multiplyScalar(0.8).add(fill).normalize();
        material.uniforms.uAngle!.value = (seconds / spec.spin) * Math.PI * 2;
      });
      renderer.render(scene, camera);
    },
    resize,
    dispose() {
      sphereGeometry.dispose();
      haloGeometry.dispose();
      parts.forEach(({ material, haloMaterial }) => {
        material.dispose();
        haloMaterial.dispose();
      });
      renderer.dispose();
    },
  };
}
