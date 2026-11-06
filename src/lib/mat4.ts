/**
 * Just enough 4×4 matrix maths for the Status page's two small scenes, the
 * ability crystal and the city of days. Column-major, as WebGL reads them.
 * No React or React Native here, so it can be checked in Node.
 */

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** a × b: b happens first, then a. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function translate(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function rotateX(a: number): Mat4 {
  const m = identity();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

export function rotateY(a: number): Mat4 {
  const m = identity();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

/** The top-left 3×3, for turning normals with a matrix that only rotates. */
export function upper3(m: Mat4): Float32Array {
  return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
}

export function apply(m: Mat4, x: number, y: number, z: number): [number, number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

/**
 * Where a point lands on a canvas `w` × `h` px, y counted down from the top,
 * with its depth (smaller is nearer). Null behind the camera.
 */
export function toScreen(
  mvp: Mat4,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
): { x: number; y: number; depth: number } | null {
  const [cx, cy, cz, cw] = apply(mvp, x, y, z);
  if (cw <= 1e-6) return null;
  return { x: ((cx / cw + 1) / 2) * w, y: ((1 - cy / cw) / 2) * h, depth: cz / cw };
}

/**
 * A camera circling a point: `yaw` turns it round the vertical, `pitch` lifts
 * it (π/2 looks straight down, with the scene's +z toward the bottom of the
 * screen), `dist` is how far back it stands.
 */
export function orbitView(
  target: [number, number, number],
  yaw: number,
  pitch: number,
  dist: number,
): { view: Mat4; eye: [number, number, number] } {
  const view = multiply(
    translate(0, 0, -dist),
    multiply(rotateX(pitch), multiply(rotateY(-yaw), translate(-target[0], -target[1], -target[2]))),
  );
  const eye: [number, number, number] = [
    target[0] + dist * Math.cos(pitch) * Math.sin(yaw),
    target[1] + dist * Math.sin(pitch),
    target[2] + dist * Math.cos(pitch) * Math.cos(yaw),
  ];
  return { view, eye };
}
