/**
 * Beerus on the GPU, in three passes over one small canvas: his dark ember
 * body and halo, then the embers themselves as glowing points, then his cat's
 * eyes on top. Everything that moves is worked out here from a handful of
 * numbers, so the page sends a few values a frame and nothing per ember.
 *
 * Positions are in clip space, where the canvas runs -1 to 1 and his sphere
 * has radius `uR`. Colours come out premultiplied, as the canvas expects.
 */

export const QUAD_VERTEX = `
attribute vec2 aPos;
varying vec2 vPos;
void main() {
  vPos = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** The dark core inside the shell and the ember halo around it. */
export const BODY_FRAGMENT = `
precision mediump float;
varying vec2 vPos;
uniform float uR;
uniform float uScale;
uniform float uEnergy;
uniform float uSleep;
uniform vec3 uTint;

void main() {
  float d = length(vPos) / (uR * uScale);
  float halo = (1.0 - smoothstep(0.72, 1.55, d)) * (0.24 + 0.18 * uEnergy) * (1.0 - 0.6 * uSleep);
  float inner = smoothstep(0.1, 0.62, d);
  vec3 core = mix(vec3(0.36, 0.125, 0.04), vec3(0.18, 0.067, 0.027), inner);
  float c = mix(0.95, 0.85, inner) * (1.0 - smoothstep(0.62, 1.02, d));
  core = mix(core, vec3(0.067, 0.05, 0.04), smoothstep(0.62, 1.02, d));
  vec3 col = core * c + uTint * halo * (1.0 - c);
  gl_FragColor = vec4(col, c + halo * (1.0 - c));
}
`;

/**
 * The embers. Each one is a point on the unit sphere plus a random number.
 * The sphere turns, each latitude twists on its own as he thinks, a voice
 * runs ripples up his body, a nearby finger pushes embers aside, and the
 * whole sphere leans toward where he is looking. Sparks are the same points
 * flagged by a random number of 1 or more; they rise off his crown and fade.
 */
export const EMBER_VERTEX = `
attribute vec4 aSeed;
uniform float uTime;
uniform float uSparkT;
uniform float uTurn;
uniform float uTwist;
uniform float uRipple;
uniform float uEnergy;
uniform float uSleep;
uniform float uScale;
uniform float uR;
uniform float uDot;
uniform float uSqueeze;
uniform vec2 uLook;
uniform vec3 uPointer;
varying float vGlow;
varying float vHeat;

const float PI = 3.14159265;

void main() {
  float spark = step(1.0, aSeed.w);
  float r = fract(aSeed.w);
  float R = uR * uScale;

  // ---- an ember on the shell
  vec3 p = aSeed.xyz;
  float lively = (1.0 + uEnergy) * (1.0 - 0.7 * uSleep);
  p += 0.035 * lively * vec3(
    sin(uTime * 1.7 + r * 40.0 + p.y * 5.0),
    sin(uTime * 1.3 + r * 23.0 + p.z * 5.0),
    sin(uTime * 1.9 + r * 31.0 + p.x * 5.0));
  float around = atan(p.z, p.x);
  float wave = sin(p.y * 9.0 - uTime * 11.0 + around * 2.0);
  p *= 1.0 + uRipple * (0.05 + 0.13 * wave) - uSqueeze * 0.07 - uSleep * 0.04;

  float a = uTurn + uTwist * sin(p.y * 2.5 + r * 0.5);
  float ca = cos(a);
  float sa = sin(a);
  p = vec3(p.x * ca + p.z * sa, p.y, p.z * ca - p.x * sa);
  // He turns toward what he is looking at.
  float yaw = uLook.x * 0.3;
  float pitch = -uLook.y * 0.22;
  p = vec3(p.x * cos(yaw) + p.z * sin(yaw), p.y, p.z * cos(yaw) - p.x * sin(yaw));
  p = vec3(p.x, p.y * cos(pitch) - p.z * sin(pitch), p.y * sin(pitch) + p.z * cos(pitch));

  float persp = 3.2 / (3.2 - p.z);
  vec2 s = p.xy * persp * R;
  vec2 away = s - uPointer.xy;
  float dist = length(away) / R;
  float push = uPointer.z * step(dist, 1.5) * pow(max(0.0, 1.0 - dist / 1.5), 2.0) * R * (0.16 + uSqueeze * 0.28);
  s += normalize(away + 1e-4) * push;

  float depth = (p.z + 1.0) * 0.5;
  float rim = 1.0 - abs(p.z);
  float flicker = 0.7 + 0.3 * sin(uTime * 4.0 + r * 6.2832);
  float glow = clamp((0.1 + depth * 0.55 + rim * 0.5) * flicker + uEnergy * 0.2, 0.0, 1.0);

  // ---- a spark off his crown
  // Each rise gets its own angle, picked as it starts, so a spark never jumps mid-flight.
  // uSparkT is a clock that runs faster when he is lively, kept by the page so a change
  // of pace never makes the sparks jump.
  float run = uSparkT * (0.25 + r * 0.35) + aSeed.z * 7.0;
  float life = fract(run);
  float angle = PI * 0.5 + aSeed.x * 0.9 * sin(floor(run) * 12.9898 + r * 40.0);
  vec2 rise = vec2(cos(angle), sin(angle)) * R * (1.0 + life * 0.55);
  float sparkGlow = (1.0 - life) * 0.8 * (1.0 - uSleep);

  gl_Position = vec4(mix(s, rise, spark), 0.0, 1.0);
  vGlow = mix(glow * (1.0 - 0.55 * uSleep), sparkGlow, spark);
  vHeat = mix(depth, 0.55, spark);
  gl_PointSize = uDot * mix((0.75 + depth * 0.8) * persp * (1.0 + uEnergy * 0.2), 0.9, spark);
}
`;

/** A soft round glow per ember, ember to amber to white-hot as it nears you. */
export const EMBER_FRAGMENT = `
precision mediump float;
varying float vGlow;
varying float vHeat;
uniform vec3 uTint;
uniform vec3 uTintSoft;
uniform vec3 uHot;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float soft = 1.0 - smoothstep(0.0, 1.0, d);
  soft *= soft;
  vec3 col = mix(uTint, uTintSoft, smoothstep(0.35, 0.6, vHeat));
  col = mix(col, uHot, smoothstep(0.72, 0.95, vHeat));
  float a = soft * vGlow;
  gl_FragColor = vec4(col * a, a);
}
`;

/**
 * Two almond cat's eyes with slit pupils, drawn as shapes so they stay sharp
 * at any size. Each almond is the lens where two circles overlap. They follow
 * the look, blink, narrow when he is angry or pleased, and close to a line
 * when he sleeps. Full precision where the GPU has it, because a nearly
 * closed eye is two very large circles and half precision loses the edge.
 */
export const EYES_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
uniform float uR;
uniform float uScale;
uniform float uLid;
uniform float uEnergy;
uniform float uPx;
uniform float uAngry;
uniform float uProud;
uniform vec2 uLook;
uniform vec3 uRim;

// Signed distance to a lens lying on its side: half width w, made of two
// circles of radius r whose centres sit d above and below its middle.
float lens(vec2 p, float r, float d, float w) {
  p = abs(p.yx);
  return ((p.y - w) * d > p.x * w) ? length(p - vec2(0.0, w)) : length(p - vec2(-d, 0.0)) - r;
}

vec4 eye(vec2 pos, float side) {
  float R = uR * uScale;
  vec2 c = vec2(side * 0.33 * R + uLook.x * 0.1 * R, -uLook.y * 0.08 * R);
  vec2 p = pos - c;
  // Outer corners up; anger drops the inner corners further.
  float ang = -side * (0.21 + 0.3 * uAngry);
  p = vec2(p.x * cos(ang) - p.y * sin(ang), p.x * sin(ang) + p.y * cos(ang));
  // Closed eyes draw in a little, so the two lines never join into one.
  float w = 0.32 * R * mix(0.72, 1.0, smoothstep(0.06, 0.4, uLid));
  float h = 0.12 * R * max(0.06, uLid) * (1.0 - 0.3 * uAngry) * (1.0 - 0.32 * uProud);
  float r = 0.5 * (w * w / h + h);
  float d = 0.5 * (w * w / h - h);
  float sd = lens(p, r, d, w);
  float aa = uPx * 1.2;
  float fill = 1.0 - smoothstep(-aa, aa, sd);
  float ring = (1.0 - smoothstep(-aa, aa, abs(sd) - 0.028 * R)) * (1.0 - fill);
  vec2 q = pos - c - vec2(uLook.x * 0.07 * R, uLook.y * 0.03 * R * -1.0);
  float slit = length(q / vec2(0.05 * R, h * 1.05));
  float pupil = (1.0 - smoothstep(0.86, 1.14, slit)) * fill;

  float ringA = ring * (0.4 + uEnergy * 0.3);
  vec3 col = uRim * ringA;
  float a = ringA;
  col = vec3(1.0, 0.851, 0.659) * fill + col * (1.0 - fill);
  a = fill + a * (1.0 - fill);
  col = vec3(0.067, 0.05, 0.04) * pupil + col * (1.0 - pupil);
  return vec4(col, a);
}

void main() {
  vec4 left = eye(vPos, -1.0);
  vec4 right = eye(vPos, 1.0);
  gl_FragColor = vec4(right.rgb + left.rgb * (1.0 - right.a), right.a + left.a * (1.0 - right.a));
}
`;
