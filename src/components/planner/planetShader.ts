/** One triangle that covers the canvas; the fragment shader does the drawing. */
export const PLANET_VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * The planet behind the Planner's clock and the sun behind its ring, in one
 * pass. The planet is a sphere worked out per pixel: cracked ember rock, lit
 * from the sun's direction, with lava veins that glow where the light does
 * not reach and thin air at the edge on the sun's side. The sun is a hot core
 * in a soft glow. Everything is in device pixels with y up, as gl_FragCoord
 * is. The output is premultiplied, so the clock's own background shows
 * through everywhere the planet and the sun are not.
 */
export const PLANET_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uCentre;
uniform float uR;
uniform vec2 uSun;
uniform float uSunR;
uniform float uSunShow;
uniform vec3 uL;
uniform vec3 uLight;
uniform float uPower;
uniform float uTurn;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + 3.1;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 p = gl_FragCoord.xy;

  // The sun behind the ring: a hot core inside a wide, soft glow.
  float ds = length(p - uSun);
  float glow = exp(-(ds * ds) / (2.0 * uSunR * uSunR)) * 0.5 + exp(-ds / (uSunR * 0.22)) * 0.5;
  float sunA = glow * uSunShow * uPower;
  vec3 col = mix(uLight, vec3(1.0, 0.95, 0.86), 0.4) * sunA;
  float alpha = sunA;

  vec2 q = (p - uCentre) / uR;
  float r = length(q);
  float aa = 1.5 / uR;

  // Thin air past the edge, only on the side the light comes from.
  float side = max(dot(q / max(r, 1e-3), normalize(uL.xy + vec2(1e-4))), 0.0);
  float air = exp(-max(r - 1.0, 0.0) * 16.0) * side * (0.15 + 0.35 * max(uL.z + 0.6, 0.0)) * uPower;
  air *= smoothstep(1.0 - aa, 1.0 + aa, r);
  col += uLight * air;
  alpha += air;

  // The planet itself. Pixels outside it skip the rock: a cheap early-out.
  if (r < 1.0 + aa) {
    float z = sqrt(max(0.0, 1.0 - r * r));
    vec3 n = vec3(q, z);
    // It turns a little through the day, about an axis tipped toward you.
    float c = cos(uTurn);
    float s = sin(uTurn);
    vec3 m = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
    m = vec3(m.x, 0.96 * m.y - 0.28 * m.z, 0.28 * m.y + 0.96 * m.z);

    float crust = fbm(m * 1.8);
    float v = abs(fbm(m * 2.7 + 3.0) - 0.5);
    // Thin cracks, and mostly in the low, dark ground, so they read as
    // cracks in a crust rather than a pattern laid over it.
    float vein = (1.0 - smoothstep(0.0, 0.026, v)) * (1.0 - smoothstep(0.38, 0.58, crust));

    float d = dot(n, uL);
    float lit = smoothstep(-0.1, 0.5, d);
    vec3 rock = mix(vec3(0.07, 0.05, 0.04), vec3(0.34, 0.23, 0.15), crust);
    vec3 surf = rock * (0.13 + 1.2 * lit * uPower) * mix(vec3(1.0), uLight, 0.55);
    // Lava shows where the light is not, and barely where it is.
    surf += vec3(1.0, 0.36, 0.08) * vein * (1.0 - lit) * 0.62;
    surf += vec3(0.9, 0.42, 0.1) * vein * lit * 0.04;
    // Air at the rim, brightest facing the sun.
    float rim = pow(1.0 - z, 3.0);
    surf += uLight * rim * max(d + 0.35, 0.0) * 0.5 * uPower;

    float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    col = mix(col, surf, inside);
    alpha = mix(alpha, 1.0, inside);
  }

  gl_FragColor = vec4(col, min(alpha, 1.0));
}
`;
