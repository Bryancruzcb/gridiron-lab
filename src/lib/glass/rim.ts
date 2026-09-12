const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_radius;
uniform float u_bevel;
uniform vec2 u_light;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  vec2 p = v_uv * u_size - u_size * 0.5;
  vec2 halfs = u_size * 0.5;
  float d = sdRoundedBox(p, halfs, u_radius);
  if (d > 1.0) discard;
  float inner = max(0.0, -d);
  float rim = 1.0 - smoothstep(0.0, u_bevel, inner);

  float e = 1.2;
  vec2 n2 = vec2(
    sdRoundedBox(p + vec2(e, 0.0), halfs, u_radius) - sdRoundedBox(p - vec2(e, 0.0), halfs, u_radius),
    sdRoundedBox(p + vec2(0.0, e), halfs, u_radius) - sdRoundedBox(p - vec2(0.0, e), halfs, u_radius)
  );
  vec3 N = normalize(vec3(n2, 0.55));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(u_light.x * 2.0 - 1.0, -(u_light.y * 2.0 - 1.0), 0.85));
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 28.0);

  float a = rim * (0.22 + spec * 0.7 + fres * 0.28);
  vec3 col = vec3(0.95 + rim * 0.12, 0.97, 1.0 + fres * 0.08);
  gl_FragColor = vec4(col * a, a);
}
`;

export type Rim = {
  dirty: () => void;
  resize: (w: number, h: number, radius: number, bevel: number) => void;
  destroy: () => void;
};

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function lightFromCss(): [number, number] {
  const s = getComputedStyle(document.documentElement);
  const x = Number.parseFloat(s.getPropertyValue("--spec-x")) || 50;
  const y = Number.parseFloat(s.getPropertyValue("--spec-y")) || 8;
  return [x / 100, y / 100];
}

/** Overlay only. Does not sample the DOM. Sleeps when the light is still. */
export function createRim(canvas: HTMLCanvasElement): Rim | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a_pos");
  const uSize = gl.getUniformLocation(prog, "u_size");
  const uRadius = gl.getUniformLocation(prog, "u_radius");
  const uBevel = gl.getUniformLocation(prog, "u_bevel");
  const uLight = gl.getUniformLocation(prog, "u_light");

  let w = 1;
  let h = 1;
  let radius = 0;
  let bevel = 16;
  let raf = 0;
  let until = 0;
  let dead = false;

  const draw = () => {
    if (dead) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      gl.viewport(0, 0, pw, ph);
    }
    const [lx, ly] = lightFromCss();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uSize, w, h);
    gl.uniform1f(uRadius, radius);
    gl.uniform1f(uBevel, bevel);
    gl.uniform2f(uLight, lx, ly);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const tick = (now: number) => {
    raf = 0;
    if (dead) return;
    draw();
    if (now < until) raf = requestAnimationFrame(tick);
  };

  const dirty = () => {
    if (dead) return;
    until = performance.now() + 180;
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    dead = true;
    canvas.hidden = true;
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    dirty,
    resize: (nw, nh, nr, nb) => {
      w = Math.max(1, nw);
      h = Math.max(1, nh);
      radius = nr;
      bevel = nb;
      dirty();
    },
    destroy: () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onLost);
    },
  };
}
