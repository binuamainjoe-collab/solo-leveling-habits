/**
 * Your rank's seal on fire, with your aura behind it.
 *
 * The seal is the System's hexagon. Its rim burns the way fire-paper-loader
 * says paper burns: a bright thread at the edge that beads and pinches as it
 * goes, gold where it runs hot and dull red where it cools, heat pulses
 * running round it both ways, and behind it a few px of ember zone graded
 * smoothly down a ramp of deep red, red-orange, orange and warm yellow-orange,
 * never cream. Tongues of flame rise off it, tallest off the top edges. Inside
 * is char, lit faintly from behind the letter, so the letter reads.
 *
 * The aura is the hunter, with no figure: slow wisps in the rank's own colour
 * rising off the seal and reaching up, fuller the higher the rank. It is
 * left out of the fire's tone curve so it keeps the rank's hue instead of
 * going orange.
 *
 * Out comes premultiplied colour over the page, the fire adding light.
 */

export const FIRE_VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FIRE_FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uC;
uniform float uR;
uniform float uPx;
uniform float uT;
uniform float uLife;
uniform vec3 uAura; // sRGB, 0-1
uniform float uAuraK;
// 0 burns the hexagon seal; 1 a round medal, for the trophy forge.
uniform float uRound;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}
// A hexagon with its points at top and bottom: r is the distance to the
// middle of a side. Negative inside.
float sdHex(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p.yx);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
vec3 ramp(float h) {
  vec3 c = mix(vec3(0.11, 0.006, 0.0007), vec3(0.34, 0.032, 0.0025), smoothstep(0.0, 0.33, h));
  c = mix(c, vec3(0.90, 0.13, 0.012), smoothstep(0.33, 0.66, h));
  return mix(c, vec3(1.13, 0.30, 0.036), smoothstep(0.66, 1.0, h));
}
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  // css px from the seal's middle, y up.
  vec2 p = (gl_FragCoord.xy - uC) / uPx;
  float R = uR;
  float t = uT;
  float d = mix(sdHex(p, R * 0.8660254), length(p) - R, uRound);
  float len = max(length(p), 1e-3);
  float up = smoothstep(-0.25, 0.95, p.y / len);

  // The aura: big slow wisps, rising, held close round the seal and reaching up.
  vec2 q = vec2(p.x * 0.011, p.y * 0.0085 - t * 0.22);
  float wisp = fbm(q + vec2(0.7 * fbm(q * 1.7 + vec2(0.0, t * 0.05)), 0.0));
  float reachUp = clamp((p.y + R * 1.3) / (R * 4.2), 0.0, 1.0);
  float hold = exp(-max(d, 0.0) / (R * (0.4 + 0.95 * reachUp)));
  // Gone well before the canvas edge, so the aura never shows a box.
  vec2 edge = min(gl_FragCoord.xy, uRes - gl_FragCoord.xy) / uPx;
  hold *= smoothstep(0.0, R * 0.7, min(edge.x, edge.y));
  // A glow that hugs the seal, and wisps that tear off it and climb.
  float aura = hold * (0.3 + 0.7 * smoothstep(0.32, 0.72, wisp + 0.2 * hold)) * uAuraK * uLife;

  // Flames off the rim: the distance to the edge, pushed out by noise that
  // climbs, so tongues lick upward and break off.
  vec2 fp = vec2(p.x * 0.065, p.y * 0.045 - t * 2.1);
  float n = fbm(fp + vec2(0.0, 0.8 * fbm(fp * 0.5 - vec2(0.0, t * 0.3))));
  // A forge burns taller than a seal: the medal is born in it.
  float tall = R * (0.12 + 0.62 * up) * (0.3 + 0.7 * uLife) * (1.0 + 0.8 * uRound);
  float f = 1.0 - (max(d, 0.0) - (n - 0.42) * tall) / max(tall, 1.0);
  float flame = clamp(f, 0.0, 1.0);
  flame *= flame * smoothstep(-2.0, 1.0, d);

  // The thread along the edge: beading, flickering, pulses running both ways.
  float sA = atan(p.y, p.x) * R;
  float run = 0.5 * vnoise(vec2(sA * 0.05 - t * 1.3, 2.0)) + 0.5 * vnoise(vec2(sA * 0.07 + t * 1.7, 5.0));
  float flk = vnoise(vec2(sA * 0.2, t * 7.0) + 3.0);
  float heat = clamp(0.32 + 0.5 * (run - 0.5) + 0.22 * (flk - 0.5) + 0.28 * up, 0.0, 1.0) * uLife;
  float bead = 0.5 + vnoise(vec2(sA * 0.12 - t * 0.8, 7.0));
  float wc = max(0.35, (0.6 + 1.7 * heat) * bead);
  float core = exp(-abs(d) / wc);
  float inside = 1.0 - smoothstep(-0.6, 0.6, d);
  // The ember zone just inside the edge, then the inner line of the seal.
  float zone = exp(min(d, 0.0) / (1.6 + 2.6 * heat)) * inside;
  float inner = exp(-abs(d + R * 0.15) / 0.9) * inside;

  vec3 fire = ramp(flame * (0.55 + 0.45 * heat)) * flame * 1.7;
  fire += ramp(0.3 + 0.6 * heat) * zone * 0.85;
  fire += ramp(0.3 + 0.4 * heat) * inner * 0.22 * uLife;
  fire += mix(vec3(1.40, 0.56, 0.09), vec3(1.85, 1.02, 0.30), heat) * core * heat;
  vec3 lit = srgb(aces(fire));
  float litA = clamp(max(max(lit.r, lit.g), lit.b) * 1.1, 0.0, 1.0);

  // Char: the seal's face, nearly opaque, warmed faintly behind the letter.
  vec3 charC = vec3(0.017, 0.012, 0.009) + vec3(0.07, 0.022, 0.006) * exp(-len / (R * 0.55)) * uLife;
  // A medal brings its own face, so the forge has no char to show behind it.
  float charA = inside * 0.9 * (1.0 - uRound);

  // The rank's own colour, untouched by the fire's tone curve.
  vec3 auraC = uAura;
  float auraA = clamp(aura * 1.25, 0.0, 0.85);

  vec3 rgb = auraC * auraA;
  float a = auraA;
  rgb = mix(rgb, charC, charA);
  a = mix(a, 1.0, charA);
  rgb += lit;
  a = max(a, litA);
  gl_FragColor = vec4(min(rgb, vec3(1.0)), clamp(a, 0.0, 1.0));
}
`;
