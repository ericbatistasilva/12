import * as THREE from 'three';
import { BlockId, BlockTypeId, getBlockDefinition } from '../core/types.js';
import { Noise2D, mulberry32 } from '../world/noise.js';

export interface BlockAtlasResources {
  map: THREE.CanvasTexture;
  dispose: () => void;
}

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export type BlockFaceKind = 'top' | 'side' | 'bottom';

const TILE_PX = 64;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;

type AtlasTileKey =
  | 'grass_top'
  | 'grass_side'
  | 'dirt'
  | 'stone'
  | 'sand'
  | 'wood_top'
  | 'wood_side'
  | 'planks'
  | 'cobblestone'
  | 'water'
  | 'glass'
  | 'leaves'
  | 'tall_grass'
  | 'flower';

const ATLAS_CELLS: Record<AtlasTileKey, { col: number; row: number }> = {
  grass_top: { col: 0, row: 0 },
  grass_side: { col: 1, row: 0 },
  dirt: { col: 2, row: 0 },
  stone: { col: 3, row: 0 },
  sand: { col: 0, row: 1 },
  wood_top: { col: 1, row: 1 },
  wood_side: { col: 2, row: 1 },
  planks: { col: 3, row: 1 },
  cobblestone: { col: 0, row: 2 },
  water: { col: 1, row: 2 },
  glass: { col: 2, row: 2 },
  leaves: { col: 3, row: 2 },
  tall_grass: { col: 0, row: 3 },
  flower: { col: 1, row: 3 }
};

function parseHexRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace(/^#/, '');
  const parsed = Number.parseInt(normalized, 16);
  if (Number.isNaN(parsed)) {
    return [160, 160, 160];
  }
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function clampByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return Math.round(value);
}

function hashTileSeed(baseSeed: number, key: string): number {
  let h = baseSeed >>> 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h ^ key.charCodeAt(i), 0x85ebca6b)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  return h >>> 0;
}

function renderTileRgb(key: AtlasTileKey, baseSeed: number, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const tileSeed = hashTileSeed(baseSeed, key);
  const fineNoise = new Noise2D(tileSeed);
  const broadNoise = new Noise2D((tileSeed ^ 0x27d4eb2d) >>> 0);
  const rng = mulberry32(tileSeed);

  const grassTop = parseHexRgb(getBlockDefinition(BlockId.GRASS).colors.top);
  const dirt = parseHexRgb(getBlockDefinition(BlockId.DIRT).colors.side);
  const stone = parseHexRgb(getBlockDefinition(BlockId.STONE).colors.side);
  const sand = parseHexRgb(getBlockDefinition(BlockId.SAND).colors.top);
  const woodTop = parseHexRgb(getBlockDefinition(BlockId.WOOD).colors.top);
  const woodSide = parseHexRgb(getBlockDefinition(BlockId.WOOD).colors.side);
  const planks = parseHexRgb(getBlockDefinition(BlockId.PLANKS).colors.top);
  const cobble = parseHexRgb(getBlockDefinition(BlockId.COBBLESTONE).colors.top);
  const water = parseHexRgb(getBlockDefinition(BlockId.WATER).colors.top);
  const glass = parseHexRgb(getBlockDefinition(BlockId.GLASS).colors.top);
  const leaves = parseHexRgb(getBlockDefinition(BlockId.LEAVES).colors.top);
  const tallGrass = parseHexRgb(getBlockDefinition(BlockId.TALL_GRASS).colors.top);
  const flower = parseHexRgb(getBlockDefinition(BlockId.FLOWER).colors.top);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = (py * size + px) * 4;
      const u = px / size;
      const v = py / size;
      const n1 = fineNoise.fbm(u * 10, v * 10, 3);
      const n2 = broadNoise.fbm(u * 4.5, v * 4.5, 2);
      const jitter = (rng() - 0.5) * 0.12;

      let r = 160;
      let g = 160;
      let b = 160;
      let a = 255;

      switch (key) {
        case 'grass_top': {
          const mod = n1 * 0.14 + n2 * 0.08 + jitter;
          r = grassTop[0] * (1 + mod * 0.85);
          g = grassTop[1] * (1 + mod * 1.15);
          b = grassTop[2] * (1 + mod * 0.75);
          break;
        }
        case 'grass_side': {
          const grassLine = 0.24 + n2 * 0.06 + Math.sin(u * Math.PI * 4) * 0.025;
          if (v < grassLine) {
            const mod = n1 * 0.13 + jitter;
            r = grassTop[0] * (1 + mod * 0.85);
            g = grassTop[1] * (1 + mod * 1.15);
            b = grassTop[2] * (1 + mod * 0.75);
          } else {
            const rootTendril = v < grassLine + 0.12 && Math.abs(n1) > 0.26 ? -0.14 : 0;
            const mod = n1 * 0.14 + n2 * 0.08 + jitter + rootTendril;
            r = dirt[0] * (1 + mod);
            g = dirt[1] * (1 + mod);
            b = dirt[2] * (1 + mod);
          }
          break;
        }
        case 'dirt': {
          const speck = Math.abs(n1) > 0.36 ? -0.12 : 0;
          const mod = n1 * 0.15 + n2 * 0.09 + jitter + speck;
          r = dirt[0] * (1 + mod);
          g = dirt[1] * (1 + mod);
          b = dirt[2] * (1 + mod);
          break;
        }
        case 'stone': {
          const mineral = Math.abs(Math.sin((u * 5 + n2 * 2.0) * Math.PI)) < 0.07 ? -0.1 : 0;
          const mod = n1 * 0.14 + n2 * 0.09 + jitter + mineral;
          r = stone[0] * (1 + mod);
          g = stone[1] * (1 + mod);
          b = stone[2] * (1 + mod);
          break;
        }
        case 'sand': {
          const grainRipple = Math.sin((u * 3 + v * 2 + n2 * 1.2) * Math.PI * 2) * 0.035;
          const mod = n1 * 0.09 + jitter * 1.2 + grainRipple;
          r = sand[0] * (1 + mod);
          g = sand[1] * (1 + mod);
          b = sand[2] * (1 + mod * 0.92);
          break;
        }
        case 'wood_top': {
          const dx = (u - 0.5) * 2;
          const dy = (v - 0.5) * 2;
          const dist = Math.hypot(dx, dy);
          const growthRing = Math.sin((dist * 12 + n1 * 1.4) * Math.PI) * 0.11;
          const mod = growthRing + n2 * 0.05 + jitter * 0.5;
          r = woodTop[0] * (1 + mod);
          g = woodTop[1] * (1 + mod);
          b = woodTop[2] * (1 + mod);
          break;
        }
        case 'wood_side': {
          const barkRidges = Math.sin((u * 24 + n2 * 3.0) * Math.PI) * 0.13 + n1 * 0.09 + jitter * 0.4;
          r = woodSide[0] * (1 + barkRidges);
          g = woodSide[1] * (1 + barkRidges);
          b = woodSide[2] * (1 + barkRidges);
          break;
        }
        case 'planks': {
          const plankCount = 4;
          const plankIdx = Math.floor(v * plankCount);
          const localV = (v * plankCount) % 1;
          const hSeam = localV < 0.06 || localV > 0.95 ? -0.22 : 0;
          const stagger = (plankIdx % 2) * 0.5;
          const vJoint = Math.abs(((u + stagger) % 1) - 0.5) < 0.014 ? -0.16 : 0;
          const woodGrain = Math.sin((v * 44 + n1 * 2.2) * Math.PI) * 0.045 + (plankIdx - 1.5) * 0.02;
          const mod = hSeam + vJoint + woodGrain + jitter * 0.4;
          r = planks[0] * (1 + mod);
          g = planks[1] * (1 + mod);
          b = planks[2] * (1 + mod);
          break;
        }
        case 'cobblestone': {
          const grid = 4;
          const gx = Math.floor(u * grid);
          const gy = Math.floor(v * grid);
          const fx = (u * grid) % 1;
          const fy = (v * grid) % 1;
          const mortar = fx < 0.09 || fx > 0.91 || fy < 0.09 || fy > 0.91;
          const cobbleTone = (((gx * 7 + gy * 13) % 5) - 2) * 0.055;
          const mod = (mortar ? -0.24 : cobbleTone) + n1 * 0.1 + jitter * 0.5;
          r = cobble[0] * (1 + mod);
          g = cobble[1] * (1 + mod);
          b = cobble[2] * (1 + mod);
          break;
        }
        case 'water': {
          const ripple = Math.sin((u * 5 + n2 * 1.5) * Math.PI * 2) * 0.06 + n1 * 0.06;
          r = water[0] * (1 + ripple * 0.7);
          g = water[1] * (1 + ripple * 0.9);
          b = water[2] * (1 + ripple);
          a = 205;
          break;
        }
        case 'glass': {
          const border = u < 0.06 || u > 0.94 || v < 0.06 || v > 0.94;
          const streak = Math.abs(u + v - 0.6) < 0.022;
          r = border ? 225 : glass[0] + (streak ? 20 : 0);
          g = border ? 242 : glass[1] + (streak ? 20 : 0);
          b = border ? 255 : glass[2] + (streak ? 14 : 0);
          a = border ? 220 : streak ? 155 : 95;
          break;
        }
        case 'leaves': {
          const mod = n1 * 0.18 + n2 * 0.12 + jitter;
          r = leaves[0] * (1 + mod * 0.85);
          g = leaves[1] * (1 + mod * 1.15);
          b = leaves[2] * (1 + mod * 0.7);
          a = n1 < -0.34 && n2 < -0.22 ? 0 : 255;
          break;
        }
        case 'tall_grass': {
          const bladeA = Math.abs(u - 0.34 - Math.sin(v * Math.PI * 2) * 0.07) < 0.045 * (1.2 - v * 0.45);
          const bladeB = Math.abs(u - 0.66 - Math.cos(v * Math.PI * 1.8) * 0.06) < 0.04 * (1.15 - v * 0.45);
          const active = (bladeA || bladeB) && v > 0.1;
          const tipFactor = v > 0.65 ? 1.12 : 0.92;
          r = tallGrass[0] * tipFactor;
          g = tallGrass[1] * tipFactor * 1.05;
          b = tallGrass[2] * tipFactor * 0.75;
          a = active ? 255 : 0;
          break;
        }
        case 'flower': {
          const stem = Math.abs(u - 0.5) < 0.035 && v >= 0.12 && v <= 0.66;
          const dist = Math.hypot((u - 0.5) * 2.4, (v - 0.72) * 2.4);
          if (dist < 0.14) {
            r = 250;
            g = 204;
            b = 21;
            a = 255;
          } else if (dist < 0.42) {
            r = flower[0];
            g = flower[1];
            b = flower[2];
            a = 255;
          } else if (stem) {
            r = 66;
            g = 153;
            b = 44;
            a = 255;
          } else {
            r = 0;
            g = 0;
            b = 0;
            a = 0;
          }
          break;
        }
      }

      out[idx] = clampByte(r);
      out[idx + 1] = clampByte(g);
      out[idx + 2] = clampByte(b);
      out[idx + 3] = clampByte(a);
    }
  }

  return out;
}

function resolveAtlasTileKey(blockId: BlockTypeId | number, faceKind: BlockFaceKind): AtlasTileKey {
  switch (blockId) {
    case BlockId.GRASS:
      if (faceKind === 'top') return 'grass_top';
      if (faceKind === 'side') return 'grass_side';
      return 'dirt';
    case BlockId.DIRT:
      return 'dirt';
    case BlockId.STONE:
      return 'stone';
    case BlockId.SAND:
      return 'sand';
    case BlockId.WOOD:
      return faceKind === 'top' || faceKind === 'bottom' ? 'wood_top' : 'wood_side';
    case BlockId.PLANKS:
      return 'planks';
    case BlockId.COBBLESTONE:
      return 'cobblestone';
    case BlockId.WATER:
      return 'water';
    case BlockId.GLASS:
      return 'glass';
    case BlockId.LEAVES:
      return 'leaves';
    case BlockId.TALL_GRASS:
      return 'tall_grass';
    case BlockId.FLOWER:
      return 'flower';
    default:
      return 'stone';
  }
}

export function getBlockFaceUvRect(blockId: BlockTypeId | number, faceKind: BlockFaceKind): UvRect {
  const tileKey = resolveAtlasTileKey(blockId, faceKind);
  const cell = ATLAS_CELLS[tileKey];
  // Pequeno recuo interno evita sangramento de texels vizinhos em filtragem linear/mipmaps
  const pad = 0.04 / TILE_PX;
  const u0 = cell.col / ATLAS_COLS + pad;
  const u1 = (cell.col + 1) / ATLAS_COLS - pad;
  const vTop = 1 - cell.row / ATLAS_ROWS - pad;
  const vBottom = 1 - (cell.row + 1) / ATLAS_ROWS + pad;

  return {
    u0,
    v0: vBottom,
    u1,
    v1: vTop
  };
}

export function createBlockTextureAtlas(seed = 1337): BlockAtlasResources {
  const atlasWidth = ATLAS_COLS * TILE_PX;
  const atlasHeight = ATLAS_ROWS * TILE_PX;

  const canvas = document.createElement('canvas');
  canvas.width = atlasWidth;
  canvas.height = atlasHeight;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const imageData = ctx.createImageData(atlasWidth, atlasHeight);
    const dst = imageData.data;

    for (const [key, cell] of Object.entries(ATLAS_CELLS) as Array<[AtlasTileKey, { col: number; row: number }]>) {
      const tileData = renderTileRgb(key, seed, TILE_PX);
      const startX = cell.col * TILE_PX;
      const startY = cell.row * TILE_PX;

      for (let ly = 0; ly < TILE_PX; ly++) {
        for (let lx = 0; lx < TILE_PX; lx++) {
          const srcIdx = (ly * TILE_PX + lx) * 4;
          const dstIdx = ((startY + ly) * atlasWidth + (startX + lx)) * 4;
          dst[dstIdx] = tileData[srcIdx];
          dst[dstIdx + 1] = tileData[srcIdx + 1];
          dst[dstIdx + 2] = tileData[srcIdx + 2];
          dst[dstIdx + 3] = tileData[srcIdx + 3];
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;

  return {
    map,
    dispose: () => {
      map.dispose();
    }
  };
}
