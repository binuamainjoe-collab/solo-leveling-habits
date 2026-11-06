/** Lights and lines one facet scene is drawn with. */
export interface FacetLook {
  /** Toward the key light, unit length. */
  light: [number, number, number];
  key: [number, number, number];
  fill: [number, number, number];
  /** A rim where faces turn away, plus this much of the face's own colour. */
  rim: [number, number, number];
  rimTint: number;
  /** Lines with a positive strength, and lines with a negative one. */
  lineA: [number, number, number];
  lineB: [number, number, number];
}

const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

/**
 * The crystal: dark glass lit from the upper left, so each side's colour
 * comes mostly from its own glow, and the strong sides shine.
 */
export const CRYSTAL_LOOK: FacetLook = {
  light: unit(-0.45, 0.75, 0.5),
  key: [0.5, 0.42, 0.34],
  fill: [0.07, 0.06, 0.055],
  rim: [0.1, 0.07, 0.05],
  rimTint: 0.85,
  lineA: [1.0, 0.93, 0.84],
  lineB: [1.0, 0.44, 0.13],
};

/** The city at dusk: a low warm sun from the left, windows doing the rest. */
export const CITY_LOOK: FacetLook = {
  light: unit(-0.5, 0.8, 0.35),
  key: [0.95, 0.72, 0.5],
  fill: [0.42, 0.34, 0.3],
  rim: [0.25, 0.12, 0.06],
  rimTint: 0,
  lineA: [0.97, 0.93, 0.87],
  lineB: [1.0, 0.44, 0.13],
};

/**
 * One shader for the Status page's two small scenes, the ability crystal and
 * the city of days: flat facets lit by a warm key light, a fill from above
 * and a rim where a face turns away, with thin lines along the real edges.
 * The city's walls carry windows, lit as far as that day was cleared.
 */

export const FACET_VERTEX = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColour;
attribute float aGlow;
attribute vec3 aBary;
attribute vec2 aUv;
attribute vec2 aWin;
attribute float aEdge;
uniform mat4 uMVP;
uniform mat4 uModel;
uniform mat3 uTurn;
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying float vG;
varying vec3 vB;
varying vec2 vUv;
varying vec2 vWin;
varying float vE;
void main() {
  vW = (uModel * vec4(aPos, 1.0)).xyz;
  vN = uTurn * aNormal;
  vC = aColour;
  vG = aGlow;
  vB = aBary;
  vUv = aUv;
  vWin = aWin;
  vE = aEdge;
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

export const FACET_FRAGMENT = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying float vG;
varying vec3 vB;
varying vec2 vUv;
varying vec2 vWin;
varying float vE;
uniform vec3 uEye;
uniform vec3 uL;
uniform vec3 uKey;
uniform vec3 uFill;
uniform vec3 uRim;
uniform float uRimTint;
uniform vec3 uLineA;
uniform vec3 uLineB;
uniform float uInside;
uniform float uAlpha;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 n = normalize(vN);
  // The far side of a see-through crystal is lit from within, not from the key.
  if (uInside > 0.5) n = -n;
  vec3 v = normalize(uEye - vW);
  float diff = max(dot(n, uL), 0.0);
  float sky = 0.55 + 0.45 * n.y;
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - facing, 3.0);
  vec3 h = normalize(uL + v);
  float spec = pow(max(dot(n, h), 0.0), 56.0);
  vec3 col = vC * (uFill * sky + uKey * diff) + vC * vG + (uRim + vC * uRimTint) * fres + uKey * spec * 0.9;
  // Seen through the front, the far faces glow with their own light.
  if (uInside > 0.5) col = vC * (0.16 + 1.25 * vG) * (0.7 + 0.3 * sky);

  // Windows: three across a wall, a storey every 0.2 of a cell, each lit or
  // dark by its own hash so a half-cleared day reads as a half-lit block.
  if (vWin.x > 0.0) {
    vec2 g = vec2(vUv.x * 3.0, vUv.y / 0.2);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float pane = step(0.26, f.x) * step(f.x, 0.74) * step(0.3, f.y) * step(f.y, 0.78);
    float on = step(hash(cell + vWin.y * 3.17), vWin.x);
    // Nothing in the ground floor's bottom strip or above the roof line.
    on *= step(0.08, vUv.y);
    col += pane * on * vec3(1.0, 0.6, 0.22) * 0.95;
  }

  float e = min(min(vB.x, vB.y), vB.z);
#ifdef GL_OES_standard_derivatives
  float w = fwidth(e);
#else
  float w = 0.02;
#endif
  float line = 1.0 - smoothstep(w * 0.5, w * 1.6, e);
  vec3 lineC = vE >= 0.0 ? uLineA : uLineB;
  col = mix(col, lineC, line * abs(vE));

  gl_FragColor = vec4(col * uAlpha, uAlpha);
}
`;
