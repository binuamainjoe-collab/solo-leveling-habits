export const WORLD_VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * The world, drawn in a single pass: sky, sun or moon, then three ridges from
 * far to near, each sliding further than the last as the tabs move, which is
 * what gives it depth. Each tab has its own place along the way: the forge on
 * Quests, a distant gate on Planner, near gates on Goal and Collection, and the
 * spire on Status. The forge burns with the day: `uForge` is how much of today
 * is cleared and `uFlare` the flash as a quest lands.
 */
export const WORLD_FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uCam;
uniform vec3 uSun;
uniform vec3 uTop;
uniform vec3 uLow;
uniform vec3 uLight;
uniform float uHeat;
uniform float uCold;
uniform float uTime;
uniform float uForge;
uniform float uFlare;
// One star for every perfect day. STARS is set when the shader is built, to
// what this GPU can hold.
#define STARS 40
uniform vec3 uStars[STARS];
uniform float uStarCount;
uniform float uNight;

const float STEP = 0.7;

float hash(float p) { return fract(sin(p * 127.1) * 43758.5453); }

float noise(float p) {
  float i = floor(p);
  float f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f);
}

// Folded noise at four sizes, which reads as broken rock.
float rock(float p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * (1.0 - abs(2.0 * noise(p) - 1.0));
    p = p * 2.07 + 3.7;
    a *= 0.5;
  }
  return s;
}

vec3 ember(float k) { return mix(vec3(0.62, 0.14, 0.03), vec3(1.0, 0.5, 0.14), k); }

// A standing ring of light with a faint fill.
float gate(vec2 p, float size) {
  float r = length(p * vec2(1.0, 0.78));
  float band = (r - size) / (size * 0.1);
  return exp(-band * band) + 0.2 * exp(-r * r / (size * size * 0.6));
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 uv = gl_FragCoord.xy / uRes;
  float x = uv.x * aspect;
  float y = uv.y + uCam.y;
  float mid = 0.5 * aspect;

  vec3 c = mix(uLow, uTop, smoothstep(0.62, 1.04, y));

  // Your perfect days, as stars: fixed in place, far enough away to barely move
  // as the tabs do, and brighter at night.
  for (int i = 0; i < STARS; i++) {
    if (float(i) >= uStarCount) break;
    vec3 st = uStars[i];
    vec2 d = vec2(x - (st.x * aspect - uCam.x * 0.04), y - st.y);
    float r2 = dot(d, d) / (st.z * st.z);
    float twinkle = 0.8 + 0.2 * sin(uTime * 1.3 + float(i) * 2.1);
    c += vec3(1.0, 0.93, 0.78) * (exp(-r2 * 9000.0) + 0.1 * exp(-r2 * 700.0)) * (0.3 + 0.7 * uNight) * twinkle;
  }

  vec2 s = vec2(x - uSun.x * aspect, y - uSun.y);
  float d = dot(s, s);
  c += uLight * uSun.z * (0.09 * exp(-d * 4.0) + 0.12 * exp(-d * 34.0) + 0.34 * exp(-d * 420.0));

  float shimmer = 0.8 + 0.2 * sin(uTime * 0.7);
  float groundX = 0.0;
  float groundH = 0.0;

  for (int i = 0; i < 3; i++) {
    float k = float(i) * 0.5;
    float along = x + uCam.x * mix(0.22, 1.0, k);
    float h = mix(0.84, 0.7, k) + mix(0.07, 0.11, k) * (rock(along * mix(4.0, 8.0, k) + k * 11.0) - 0.5);

    if (i == 0) {
      vec2 far = vec2(along - (mid + STEP * 0.22 + 0.1), y - 0.87);
      c += ember(0.7) * gate(far, 0.05) * (0.12 + 0.26 * uHeat) * shimmer;
    }
    if (i == 1) {
      vec2 near = vec2(along - (mid + 2.0 * STEP * 0.61 - 0.05), y - 0.83);
      c += ember(0.85) * gate(near, 0.085) * (0.15 + 0.32 * uHeat) * shimmer;

      vec2 vault = vec2(along - (mid + 3.0 * STEP * 0.61 + 0.06), y - 0.85);
      c += ember(0.6) * gate(vault, 0.06) * (0.12 + 0.28 * uHeat) * shimmer;

      float forge = along - (mid + 0.12);
      h += 0.1 * exp(-forge * forge * 90.0);
    }
    if (i == 2) {
      float spire = along - (mid + 4.0 * STEP - 0.08);
      h += 0.17 * exp(-abs(spire) * 34.0);
      groundX = along;
      groundH = h;
    }

    vec3 stone = mix(uLow * 0.62, vec3(0.05, 0.034, 0.026), k);
    float rim = exp(-max(h - y, 0.0) * mix(26.0, 46.0, k));
    stone += uLight * uSun.z * rim * mix(0.1, 0.06, k);
    stone += ember(0.3) * rim * (0.01 + 0.09 * uHeat) * k;
    // smoothstep with its edges reversed is undefined in GLSL and breaks on some
    // phone GPUs, so the ridge is one minus the forward curve.
    c = mix(c, stone, 1.0 - smoothstep(h - 0.007, h + 0.007, y));

    if (i == 1) {
      // The forge heats as the day's quests clear and flares as each one lands.
      float forge = along - (mid + 0.12);
      vec2 mouth = vec2(forge, y - h);
      float fire = 0.1 + 0.42 * uHeat + 0.5 * uForge + 0.7 * uFlare;
      c += ember(1.0) * exp(-dot(mouth, mouth) * mix(240.0, 130.0, uForge)) * fire * shimmer;
      vec2 plume = vec2(forge * 2.4, max(y - h, 0.0) * 0.9);
      c += ember(0.6) * exp(-dot(plume, plume) * 70.0) * (0.1 * uForge + 0.32 * uFlare) * shimmer;
    }
    if (i == 2) {
      float spire = along - (mid + 4.0 * STEP - 0.08);
      vec2 tip = vec2(spire, y - h);
      c += ember(0.9) * exp(-dot(tip, tip) * 900.0) * (0.14 + 0.5 * uHeat) * shimmer;
    }
  }

  // Lava seams in the ground, which is where rank shows most.
  float below = groundH - y;
  if (below > 0.0) {
    float depth = 1.0 + below * 3.0;
    float vein = abs(noise(groundX * 5.0 * depth + y * 9.0) + 0.5 * noise(groundX * 12.0 - y * 16.0 + uTime * 0.05) - 0.75);
    float seam = (1.0 - smoothstep(0.0, 0.05, vein)) * smoothstep(0.0, 0.05, below);
    c += ember(seam) * seam * (0.015 + 0.26 * uHeat) * (0.75 + 0.25 * sin(uTime * 0.6 + groundX * 7.0));
  }

  float grey = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(c, vec3(grey * 0.9, grey * 0.94, grey * 1.04), uCold);

  // A little grain, so a dark gradient doesn't band.
  c += (hash(gl_FragCoord.x * 0.37 + gl_FragCoord.y * 1.7) - 0.5) / 200.0;
  gl_FragColor = vec4(c, 1.0);
}
`;
