/**
 * NORA's signature background. Framework-free, so the React component only owns
 * its lifecycle.
 *
 * Two layers: thousands of fibers drawn by the GPU, and a Canvas 2D overlay for
 * the nodes, connections, particles and labels. `flow` below and the vertex
 * shader are the same curve, so nodes stay on their fibers. Change them together.
 */
export type NetworkRole = 'agents' | 'providers' | 'payments' | 'trust' | 'discovery';

export const ROLES: Record<NetworkRole, { label: string; text: string }> = {
  agents: { label: 'AI AGENTS', text: 'Act on a request and buy what it needs, inside the limits you set.' },
  providers: { label: 'API PROVIDERS', text: 'List a service, set a price and get paid per call.' },
  payments: { label: 'PAYMENTS', text: 'USDC moves through Arc once the firewall allows it.' },
  trust: { label: 'TRUST', text: 'Payment events are written to a Hedera audit topic.' },
  discovery: { label: 'DISCOVERY', text: 'Agents search marketplaces for a service that fits.' },
};

const ROLE_IDS = Object.keys(ROLES) as NetworkRole[];
const BUNDLES = 6;
/** Threads and nodes stay quiet here, so the headline stays readable. */
const CENTER_FLOOR = 0.1;

interface Quality {
  threads: number;
  segments: number;
  nodes: number;
  maxDpr: number;
  /** Light per fiber. Blending is additive, so denser layouts need less of it. */
  light: number;
}

const qualityFor = (width: number): Quality => {
  if (width < 640) return { threads: 900, segments: 36, nodes: 18, maxDpr: 1.5, light: 0.04 };
  if (width < 1100) return { threads: 2200, segments: 44, nodes: 34, maxDpr: 2, light: 0.022 };
  return { threads: 4600, segments: 56, nodes: 58, maxDpr: 1.5, light: 0.017 };
};

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

type Vec4 = [number, number, number, number];

/** a: base, amplitude, frequency, phase. b: second frequency, second phase, width, speed. */
function makeBundles(random: () => number) {
  const bases = [-0.84, -0.54, -0.2, 0.2, 0.54, 0.84];
  return bases.map((base) => ({
    a: [base, 0.1 + random() * 0.17, 3 + random() * 3.5, random() * 6.283] as Vec4,
    b: [7 + random() * 5, random() * 6.283, 0.13 + random() * 0.2, 0.05 + random() * 0.06] as Vec4,
  }));
}

type Bundle = ReturnType<typeof makeBundles>[number];

function flow(bundle: Bundle, t: number, lane: number, phase: number, time: number) {
  const { a, b } = bundle;
  const s = time * b[3];
  let y = a[0] + a[1] * Math.sin(t * a[2] + a[3] + s) + a[1] * 0.45 * Math.sin(t * b[0] + b[1] - s * 0.7);
  const pinch = 0.5 + 0.5 * Math.sin(t * a[2] * 1.7 + b[1] * 1.3 + s * 0.6);
  y += lane * b[2] * (0.12 + 0.88 * pinch * pinch);
  y += 0.012 * Math.sin(t * 19 + phase * 6.283 + s * 1.4) * (0.3 + Math.abs(lane));
  return { x: -1.12 + 2.24 * t, y };
}

const smoothstep = (low: number, high: number, value: number) => {
  const x = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return x * x * (3 - 2 * x);
};

/** On narrow screens the headline fills the width, so the quiet zone does too. */
const quietZone = (aspect: number): [number, number] => (aspect < 1 ? [1.15, 0.52] : [0.66, 0.46]);

const centerFade = (x: number, y: number, zone: [number, number]) => {
  const distance = Math.hypot(x / zone[0], y / zone[1]);
  return CENTER_FLOOR + (1 - CENTER_FLOOR) * smoothstep(0.62, 1.3, distance);
};

const VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in float a_t;
layout(location = 1) in vec4 i_thread;
uniform float u_time, u_aspect, u_reveal, u_light;
uniform vec2 u_zone;
uniform vec3 u_mouse;
uniform vec4 u_a[${BUNDLES}];
uniform vec4 u_b[${BUNDLES}];
out float v_alpha;
out float v_tint;
void main() {
  int id = int(i_thread.w);
  vec4 a = u_a[id];
  vec4 b = u_b[id];
  float t = a_t, lane = i_thread.x, phase = i_thread.y;
  float s = u_time * b.w;
  float y = a.x + a.y * sin(t * a.z + a.w + s) + a.y * 0.45 * sin(t * b.x + b.y - s * 0.7);
  float pinch = 0.5 + 0.5 * sin(t * a.z * 1.7 + b.y * 1.3 + s * 0.6);
  y += lane * b.z * (0.12 + 0.88 * pinch * pinch);
  y += 0.012 * sin(t * 19.0 + phase * 6.283 + s * 1.4) * (0.3 + abs(lane));
  vec2 p = vec2(-1.12 + 2.24 * t, y);

  vec2 d = (p - u_mouse.xy) * vec2(u_aspect, 1.0);
  float near = exp(-dot(d, d) / 0.07) * u_mouse.z;
  p += normalize(d + 0.0001) * near * 0.03 / vec2(u_aspect, 1.0);

  float shimmer = pow(0.5 + 0.5 * sin(t * 16.0 - u_time * (0.35 + phase * 0.5) + phase * 90.0), 40.0);
  float center = ${CENTER_FLOOR.toFixed(2)} + ${(1 - CENTER_FLOOR).toFixed(2)} * smoothstep(0.62, 1.3, length(p / u_zone));
  float ribbon = mix(1.0, 0.45, abs(lane));
  float reveal = 1.0 - smoothstep(u_reveal - 0.16, u_reveal, t);
  // Fibers crowd together at a pinch, so each one gives less light there.
  float crowd = 0.2 + 0.8 * pinch;
  v_alpha = (u_light * i_thread.z * crowd + shimmer * u_light * 7.0 + near * u_light * 1.6) * ribbon * center * reveal;
  v_tint = phase;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in float v_alpha;
in float v_tint;
out vec4 color;
void main() {
  vec3 silver = vec3(0.71, 0.74, 0.79);
  vec3 blue = vec3(0.48, 0.64, 0.93);
  color = vec4(mix(silver, blue, v_tint * v_tint) * v_alpha, 1.0);
}`;

interface ThreadRenderer {
  draw(time: number, aspect: number, mouse: [number, number, number], reveal: number, share: number): void;
  resize(width: number, height: number, dpr: number, zone: [number, number]): void;
  destroy(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function webglThreads(canvas: HTMLCanvasElement, bundles: Bundle[], quality: Quality, random: () => number): ThreadRenderer | null {
  // Multisampling tanks integrated GPUs on this many lines: 24fps with it, 60 without.
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const ts = new Float32Array(quality.segments + 1).map((_, index) => index / quality.segments);
  const threads = new Float32Array(quality.threads * 4);
  for (let index = 0; index < quality.threads; index++) {
    threads[index * 4] = (random() + random() + random()) / 1.5 - 1;
    threads[index * 4 + 1] = random();
    threads[index * 4 + 2] = 0.45 + random() * random() * 1.3;
    threads[index * 4 + 3] = Math.floor(random() * BUNDLES);
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const stripBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, stripBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, ts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
  const threadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, threadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, threads, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  gl.useProgram(program);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform4fv(uniform('u_a'), bundles.flatMap((bundle) => bundle.a));
  gl.uniform4fv(uniform('u_b'), bundles.flatMap((bundle) => bundle.b));
  const time = uniform('u_time');
  const aspectUniform = uniform('u_aspect');
  const revealUniform = uniform('u_reveal');
  const mouseUniform = uniform('u_mouse');
  const lightUniform = uniform('u_light');
  const zoneUniform = uniform('u_zone');
  let light = quality.light;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0.024, 0.027, 0.035, 1);

  return {
    draw(now, aspect, mouse, reveal, share) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(time, now);
      gl.uniform1f(aspectUniform, aspect);
      gl.uniform1f(revealUniform, reveal);
      gl.uniform3fv(mouseUniform, mouse);
      // Fewer fibers each carry more, so slower devices keep the same look.
      gl.uniform1f(lightUniform, light / Math.sqrt(share));
      gl.drawArraysInstanced(gl.LINE_STRIP, 0, quality.segments + 1, Math.floor(quality.threads * share));
    },
    resize(width, height, dpr, zone) {
      gl.viewport(0, 0, width, height);
      // Lines are one device pixel wide, so sharper screens need a little more light.
      light = quality.light * (0.6 + 0.4 * dpr);
      gl.uniform2fv(zoneUniform, zone);
    },
    destroy() {
      gl.deleteBuffer(stripBuffer);
      gl.deleteBuffer(threadBuffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}

/** For devices with no WebGL2. The same curves, far fewer of them. */
function canvasThreads(canvas: HTMLCanvasElement, bundles: Bundle[], random: () => number): ThreadRenderer | null {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;
  const threads = Array.from({ length: 150 }, (_, index) => ({
    bundle: bundles[index % BUNDLES],
    lane: (random() + random() + random()) / 1.5 - 1,
    phase: random(),
  }));
  let width = 1;
  let height = 1;
  return {
    draw(time, _aspect, _mouse, reveal) {
      context.fillStyle = '#060709';
      context.fillRect(0, 0, width, height);
      context.lineWidth = 0.6;
      context.strokeStyle = 'rgba(176, 186, 204, 0.16)';
      context.beginPath();
      for (const thread of threads) {
        for (let step = 0; step <= 28; step++) {
          const t = (step / 28) * Math.min(1, reveal);
          const point = flow(thread.bundle, t, thread.lane, thread.phase, time);
          const x = (point.x * 0.5 + 0.5) * width;
          const y = (0.5 - point.y * 0.5) * height;
          if (step === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
      }
      context.stroke();
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
    },
    destroy() {},
  };
}

interface Node {
  bundle: Bundle;
  lane: number;
  phase: number;
  anchor: number;
  drift: number;
  role: NetworkRole | null;
  glow: number;
  highlight: number;
  label: number;
  labelUntil: number;
  nudgeX: number;
  nudgeY: number;
  x: number;
  y: number;
  fade: number;
}

interface Link {
  a: number;
  b: number;
  life: number;
  wanted: boolean;
  particle: number;
  speed: number;
}

interface Pulse {
  link: Link;
  forward: boolean;
  progress: number;
  hops: number;
}

export interface NetworkOptions {
  threads: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  tooltip: HTMLElement;
  reducedMotion: boolean;
  onHover: (role: NetworkRole | null) => void;
}

function glowSprite() {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const context = sprite.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(226, 234, 248, 1)');
    gradient.addColorStop(0.18, 'rgba(164, 192, 240, 0.42)');
    gradient.addColorStop(1, 'rgba(120, 160, 230, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return sprite;
}

export function createNetwork(options: NetworkOptions) {
  const { threads: threadCanvas, overlay, tooltip, reducedMotion, onHover } = options;
  const random = seededRandom(20261106);
  const host = threadCanvas.parentElement!;
  const quality = qualityFor(host.clientWidth);
  const bundles = makeBundles(random);
  const renderer = webglThreads(threadCanvas, bundles, quality, random) ?? canvasThreads(threadCanvas, bundles, random);
  const context = overlay.getContext('2d');
  if (!renderer || !context) return null;

  const sprite = glowSprite();
  const font = `10px ${getComputedStyle(overlay).fontFamily}`;
  // Roles sit toward the edges, clear of the headline.
  const roleAnchors = [0.1, 0.9, 0.2, 0.8, 0.14];
  const nodes: Node[] = Array.from({ length: quality.nodes }, (_, index) => {
    const role = index < ROLE_IDS.length ? ROLE_IDS[index] : null;
    return {
      bundle: bundles[role ? [1, 4, 5, 0, 3][index] : index % BUNDLES],
      lane: (random() - 0.5) * 1.5,
      phase: random(),
      anchor: role ? roleAnchors[index] : random(),
      drift: 0.3 + random() * 0.7,
      role,
      glow: 0,
      highlight: 0,
      label: 0,
      labelUntil: 0,
      nudgeX: 0,
      nudgeY: 0,
      x: 0,
      y: 0,
      fade: 1,
    };
  });

  const links = new Map<string, Link>();
  const pulses: Pulse[] = [];
  const pointer = { x: -9999, y: -9999, inside: false, strength: 0 };
  let width = 1;
  let height = 1;
  let dpr = 1;
  let zone = quietZone(16 / 9);
  let frame = 0;
  let running = false;
  let visible = true;
  let last = 0;
  let clock = 40;
  let revealed = reducedMotion ? 1.3 : 0;
  let share = 1;
  let slowFrames = 0;
  let countedFrames = 0;
  let nextLinks = 0;
  let nextPulse = 3;
  let nextLabel = 2.5;
  let hovered: Node | null = null;

  const placeNodes = (dt: number) => {
    for (const node of nodes) {
      const wander = node.role ? 0.03 * Math.sin(clock * 0.09 + node.phase * 6.283) : 0.14 * Math.sin(clock * 0.03 * node.drift + node.phase * 6.283);
      const t = Math.min(1, Math.max(0, node.anchor + wander));
      const point = flow(node.bundle, t, node.lane, node.phase, clock);
      const baseX = (point.x * 0.5 + 0.5) * width;
      const baseY = (0.5 - point.y * 0.5) * height;
      const dx = baseX - pointer.x;
      const dy = baseY - pointer.y;
      const reach = Math.exp(-(dx * dx + dy * dy) / 32000) * pointer.strength;
      const distance = Math.hypot(dx, dy) || 1;
      const ease = 1 - Math.exp(-dt * 5);
      node.nudgeX += ((dx / distance) * reach * 16 - node.nudgeX) * ease;
      node.nudgeY += ((dy / distance) * reach * 16 - node.nudgeY) * ease;
      node.x = baseX + node.nudgeX;
      node.y = baseY + node.nudgeY;
      node.fade = centerFade(point.x, point.y, zone);
      node.glow = Math.max(0, node.glow - dt * 0.55);
      node.highlight = Math.max(0, node.highlight - dt * 0.42);
      const showLabel = node === hovered || clock < node.labelUntil;
      node.label += ((showLabel ? 1 : 0) - node.label) * (1 - Math.exp(-dt * 1.6));
    }
  };

  /** Pairs change every few seconds, so connections form and dissolve on their own. */
  const refreshLinks = () => {
    const reach = Math.min(240, Math.max(130, width * 0.14));
    const epoch = Math.floor(clock / 7);
    for (const link of links.values()) link.wanted = false;
    nodes.forEach((a, i) => {
      const near = nodes
        .map((b, j) => ({ j, distance: Math.hypot(a.x - b.x, a.y - b.y) }))
        .filter((item) => item.j !== i && item.distance < reach)
        .sort((x, y) => x.distance - y.distance)
        .slice(0, 3);
      for (const { j } of near) {
        const low = Math.min(i, j);
        const high = Math.max(i, j);
        const chance = Math.sin(low * 12.9898 + high * 78.233 + epoch * 37.719) * 43758.5453;
        if (chance - Math.floor(chance) > 0.62) continue;
        const key = `${low}-${high}`;
        const link = links.get(key);
        if (link) link.wanted = true;
        else links.set(key, { a: low, b: high, life: 0, wanted: true, particle: random(), speed: 0.1 + random() * 0.14 });
      }
    });
  };

  const trace = (start: number, end: number, link: Link, amount: number) => {
    const a = nodes[link.a];
    const b = nodes[link.b];
    const at = start + (end - start) * amount;
    return { x: a.x + (b.x - a.x) * at, y: a.y + (b.y - a.y) * at };
  };

  const firePulse = () => {
    const live = [...links.values()].filter((link) => link.life > 0.7);
    if (!live.length) return;
    pulses.push({ link: live[Math.floor(random() * live.length)], forward: random() > 0.5, progress: 0, hops: 3 });
  };

  /** Lights up everything within two hops, so the click shows what this node reaches. */
  const highlightFrom = (origin: Node) => {
    const start = nodes.indexOf(origin);
    let frontier = new Set([start]);
    const seen = new Set(frontier);
    for (let hop = 0; hop < 2; hop++) {
      const next = new Set<number>();
      for (const link of links.values()) {
        if (frontier.has(link.a) && !seen.has(link.b)) next.add(link.b);
        if (frontier.has(link.b) && !seen.has(link.a)) next.add(link.a);
      }
      next.forEach((index) => seen.add(index));
      frontier = next;
    }
    seen.forEach((index) => {
      nodes[index].highlight = 1;
      nodes[index].glow = 1;
    });
    origin.labelUntil = clock + 5;
  };

  const updateHover = () => {
    let best: Node | null = null;
    let bestDistance = 24;
    if (pointer.inside) {
      for (const node of nodes) {
        if (!node.role || node.fade < 0.3) continue;
        const distance = Math.hypot(node.x - pointer.x, node.y - pointer.y);
        if (distance < bestDistance) {
          best = node;
          bestDistance = distance;
        }
      }
    }
    if (best !== hovered) {
      hovered = best;
      onHover(best?.role ?? null);
      host.style.cursor = best ? 'pointer' : '';
    }
    if (hovered) {
      const x = Math.min(width - 250, Math.max(10, hovered.x + 14));
      const y = Math.max(84, hovered.y - 54);
      tooltip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  };

  const drawOverlay = (dt: number) => {
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const entrance = smoothstep(0.7, 1.25, revealed);
    context.globalCompositeOperation = 'lighter';
    context.lineWidth = 0.7;

    for (const [key, link] of links) {
      link.life = Math.min(1, Math.max(0, link.life + (link.wanted ? dt * 0.5 : -dt * 0.4)));
      if (link.life === 0 && !link.wanted) {
        links.delete(key);
        continue;
      }
      const a = nodes[link.a];
      const b = nodes[link.b];
      const lit = Math.max(a.highlight, b.highlight) > 0 ? Math.min(a.highlight, b.highlight) : 0;
      const alpha = link.life * entrance * Math.min(a.fade, b.fade);
      context.strokeStyle = `rgba(172, 192, 228, ${(0.13 + lit * 0.55) * alpha})`;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();

      link.particle = (link.particle + dt * link.speed) % 1;
      const point = trace(0, 1, link, link.particle);
      const size = 7;
      context.globalAlpha = Math.min(1, 0.6 * alpha);
      context.drawImage(sprite, point.x - size / 2, point.y - size / 2, size, size);
      context.globalAlpha = 1;
    }

    for (let index = pulses.length - 1; index >= 0; index--) {
      const pulse = pulses[index];
      pulse.progress += dt * 0.75;
      const [from, to] = pulse.forward ? [0, 1] : [1, 0];
      const quiet = Math.min(nodes[pulse.link.a].fade, nodes[pulse.link.b].fade);
      for (let tail = 0; tail < 6; tail++) {
        const amount = pulse.progress - tail * 0.028;
        if (amount < 0 || amount > 1) continue;
        const point = trace(from, to, pulse.link, amount);
        const size = 18 - tail * 2.4;
        context.globalAlpha = (1 - tail / 6) * 0.8 * entrance * quiet;
        context.drawImage(sprite, point.x - size / 2, point.y - size / 2, size, size);
      }
      context.globalAlpha = 1;
      if (pulse.progress < 1) continue;
      const arrived = pulse.forward ? pulse.link.b : pulse.link.a;
      nodes[arrived].glow = 1;
      const onward = [...links.values()].filter((link) => link !== pulse.link && link.life > 0.6 && (link.a === arrived || link.b === arrived));
      pulses.splice(index, 1);
      if (pulse.hops > 0 && onward.length) {
        const link = onward[Math.floor(random() * onward.length)];
        pulses.push({ link, forward: link.a === arrived, progress: 0, hops: pulse.hops - 1 });
      }
    }

    context.font = font;
    context.textBaseline = 'middle';
    for (const node of nodes) {
      const shown = node.fade * entrance;
      const glow = Math.max(node.glow, node === hovered ? 0.8 : 0, node.highlight * 0.8);
      const size = (node.role ? 9 : 6) + glow * 28;
      context.globalAlpha = Math.min(1, (0.32 + glow * 0.68) * shown);
      context.drawImage(sprite, node.x - size / 2, node.y - size / 2, size, size);
      // The navigation covers the top of the hero, so no label is shown behind it.
      if (node.label > 0.01 && node.role && node.y > 92) {
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = node.label * 0.62 * shown;
        context.fillStyle = '#c6cedc';
        context.letterSpacing = '1.6px';
        // Labels near the right edge read leftward, so they are never cut off.
        const leftward = node.x > width - 140;
        context.textAlign = leftward ? 'right' : 'left';
        context.fillText(ROLES[node.role].label, node.x + (leftward ? -11 : 11), node.y);
        context.globalCompositeOperation = 'lighter';
      }
    }
    context.globalAlpha = 1;
  };

  const render = (dt: number) => {
    placeNodes(dt);
    if (clock >= nextLinks) {
      refreshLinks();
      nextLinks = clock + 1.4;
    }
    updateHover();
    const aspect = width / height;
    const mouse: [number, number, number] = [(pointer.x / width) * 2 - 1, 1 - (pointer.y / height) * 2, pointer.strength];
    renderer.draw(clock, aspect, mouse, revealed, share);
    drawOverlay(dt);
  };

  const tick = (now: number) => {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    const elapsed = Math.min(0.05, (now - last) / 1000 || 0.016);
    // A device that cannot keep up draws fewer fibers rather than stuttering.
    if (share > 0.2 && last) {
      countedFrames += 1;
      if (now - last > 30) slowFrames += 1;
      if (countedFrames === 60) {
        if (slowFrames > 24) share = Math.max(0.2, share * 0.7);
        countedFrames = 0;
        slowFrames = 0;
      }
    }
    last = now;
    clock += elapsed;
    revealed = Math.min(1.3, revealed + elapsed * 0.55);
    pointer.strength += ((pointer.inside ? 1 : 0) - pointer.strength) * (1 - Math.exp(-elapsed * 3));
    if (clock >= nextPulse) {
      firePulse();
      nextPulse = clock + 2.5 + random() * 3.5;
    }
    if (clock >= nextLabel) {
      const roles = nodes.filter((node) => node.role && node.fade > 0.45);
      const node = roles[Math.floor(random() * roles.length)];
      if (node) {
        node.labelUntil = clock + 4 + random() * 2;
        node.glow = 0.7;
      }
      nextLabel = clock + 3 + random() * 3;
    }
    render(elapsed);
  };

  const start = () => {
    if (running || reducedMotion || !visible || document.hidden) return;
    running = true;
    last = 0;
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };

  const resize = () => {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
    for (const canvas of [threadCanvas, overlay]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    zone = quietZone(width / height);
    renderer.resize(threadCanvas.width, threadCanvas.height, dpr, zone);
    if (reducedMotion) {
      placeNodes(0.016);
      refreshLinks();
      for (const link of links.values()) link.life = 1;
      render(0);
    }
  };

  const onMove = (event: PointerEvent) => {
    const box = host.getBoundingClientRect();
    pointer.x = event.clientX - box.left;
    pointer.y = event.clientY - box.top;
    pointer.inside = event.pointerType === 'mouse' && pointer.y >= 0 && pointer.y <= box.height;
  };
  const onLeave = () => {
    pointer.inside = false;
  };
  const onClick = (event: MouseEvent) => {
    if (hovered && !(event.target as Element).closest('a, button, summary')) highlightFrom(hovered);
  };
  const onVisibility = () => (document.hidden ? stop() : start());

  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  const viewObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else stop();
  });
  viewObserver.observe(host);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('blur', onLeave);
  host.addEventListener('pointerleave', onLeave);
  host.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisibility);
  resize();
  start();

  return {
    destroy() {
      stop();
      sizeObserver.disconnect();
      viewObserver.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onLeave);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisibility);
      renderer.destroy();
    },
  };
}
