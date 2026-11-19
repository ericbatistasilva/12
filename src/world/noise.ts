export function hashSeed(seedInput: string): number {
  const normalized = seedInput.trim() || 'blockworld-default';
  let h = 2166136261 >>> 0;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise2D {
  private readonly perm: Uint8Array;

  constructor(seed: number) {
    const rng = mulberry32(seed);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      base[i] = i;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = base[i];
      base[i] = base[j];
      base[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = base[i & 255];
    }
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private static lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private static grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) !== 0 ? -u : u) + ((h & 2) !== 0 ? -2.0 * v : 2.0 * v);
  }

  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = Noise2D.fade(xf);
    const v = Noise2D.fade(yf);

    const aa = this.perm[this.perm[X] + Y];
    const ab = this.perm[this.perm[X] + Y + 1];
    const ba = this.perm[this.perm[X + 1] + Y];
    const bb = this.perm[this.perm[X + 1] + Y + 1];

    const x1 = Noise2D.lerp(Noise2D.grad(aa, xf, yf), Noise2D.grad(ba, xf - 1, yf), u);
    const x2 = Noise2D.lerp(Noise2D.grad(ab, xf, yf - 1), Noise2D.grad(bb, xf - 1, yf - 1), u);

    // Normaliza aproximadamente para [-1, 1]
    return Math.max(-1, Math.min(1, Noise2D.lerp(x1, x2, v) * 0.45));
  }

  fbm(x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1.0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }
}

export class Noise3D {
  private readonly n2a: Noise2D;
  private readonly n2b: Noise2D;

  constructor(seed: number) {
    this.n2a = new Noise2D((seed ^ 0x9e3779b9) >>> 0);
    this.n2b = new Noise2D((seed ^ 0x85ebca6b) >>> 0);
  }

  noise(x: number, y: number, z: number): number {
    const xy = this.n2a.noise(x + y * 0.57, z - y * 0.43);
    const yz = this.n2b.noise(y + x * 0.37, z + x * 0.71);
    return (xy + yz) * 0.5;
  }
}
