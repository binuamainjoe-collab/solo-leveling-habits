import { FACET_FRAGMENT, FACET_VERTEX, type FacetLook } from '@/components/status/facetShader';
import { FACET_FLOATS } from '@/lib/status';

type Gl = WebGLRenderingContext;

function compile(gl: Gl, vertex: string, fragment: string) {
  const make = (type: number, source: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = make(gl.VERTEX_SHADER, vertex);
  const f = make(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!v || !f || !program) return null;
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** A canvas sized in css px, drawn at the screen's density up to `maxDpr`. */
export function makeCanvas(width: number, height: number, maxDpr: number) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width:${width}px;height:${height}px;display:block`;
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  return { canvas, dpr };
}

/** A program for a full-canvas triangle, as the fire uses. */
export function setUpQuad(canvas: HTMLCanvasElement, vertex: string, fragment: string) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  const program = compile(gl, vertex, fragment);
  if (!program) return null;
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const known = new Map<string, WebGLUniformLocation | null>();
  const at = (name: string) => {
    if (!known.has(name)) known.set(name, gl.getUniformLocation(program, name));
    return known.get(name) ?? null;
  };
  const pos = gl.getAttribLocation(program, 'aPos');
  return {
    gl,
    at,
    draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    },
    free() {
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

export type QuadGpu = NonNullable<ReturnType<typeof setUpQuad>>;

/**
 * The facet program and a vertex buffer for the crystal or the city. Meshes
 * come from `src/lib/status.ts` and `src/lib/city.ts`, FACET_FLOATS a vertex.
 */
export function setUpFacets(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    depth: true,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  // Smooth line edges where the phone can; a fixed width where it can't.
  gl.getExtension('OES_standard_derivatives');
  const program = compile(gl, FACET_VERTEX, FACET_FRAGMENT);
  if (!program) return null;
  const buffer = gl.createBuffer();
  const known = new Map<string, WebGLUniformLocation | null>();
  const at = (name: string) => {
    if (!known.has(name)) known.set(name, gl.getUniformLocation(program, name));
    return known.get(name) ?? null;
  };
  const attrs: [string, number][] = [
    ['aPos', 3],
    ['aNormal', 3],
    ['aColour', 3],
    ['aGlow', 1],
    ['aBary', 3],
    ['aUv', 2],
    ['aWin', 2],
    ['aEdge', 1],
  ];
  const locs = attrs.map(([name, size]) => ({ loc: gl.getAttribLocation(program, name), size }));
  let count = 0;

  return {
    gl,
    /** Hands over a new mesh. */
    load(mesh: Float32Array) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.DYNAMIC_DRAW);
      count = mesh.length / FACET_FLOATS;
    },
    clear() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    },
    /**
     * One pass over the mesh. `inside` draws the far faces, lit from within,
     * for a crystal you can half see through.
     */
    draw(
      m: { mvp: Float32Array; model: Float32Array; turn: Float32Array; eye: [number, number, number] },
      look: FacetLook,
      pass: { inside: boolean; alpha: number },
    ) {
      if (!count) return;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      let offset = 0;
      for (const { loc, size } of locs) {
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FACET_FLOATS * 4, offset * 4);
        }
        offset += size;
      }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(pass.inside ? gl.FRONT : gl.BACK);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(at('uMVP'), false, m.mvp);
      gl.uniformMatrix4fv(at('uModel'), false, m.model);
      gl.uniformMatrix3fv(at('uTurn'), false, m.turn);
      gl.uniform3fv(at('uEye'), m.eye);
      gl.uniform3fv(at('uL'), look.light);
      gl.uniform3fv(at('uKey'), look.key);
      gl.uniform3fv(at('uFill'), look.fill);
      gl.uniform3fv(at('uRim'), look.rim);
      gl.uniform1f(at('uRimTint'), look.rimTint);
      gl.uniform3fv(at('uLineA'), look.lineA);
      gl.uniform3fv(at('uLineB'), look.lineB);
      gl.uniform1f(at('uInside'), pass.inside ? 1 : 0);
      gl.uniform1f(at('uAlpha'), pass.alpha);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    },
    free() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

export type FacetGpu = NonNullable<ReturnType<typeof setUpFacets>>;

/** The closest element above `node` that scrolls, for scroll-linked turns. */
export function scrollerOf(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const o = getComputedStyle(el).overflowY;
    if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * How far `el` has travelled through the screen: 0 as it rises past the
 * bottom edge, 0.5 when centred, 1 as it leaves at the top.
 */
export function passage(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || 1;
  const p = (vh - (r.top + r.height / 2)) / vh;
  return Math.min(1, Math.max(0, p));
}
