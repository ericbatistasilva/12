import * as THREE from 'three';
import { BlockId, BlockTypeId, getBlockDefinition } from '../core/types.js';
import { Noise2D, mulberry32 } from '../world/noise.js';

export interface ProceduralTextureSet {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  alphaMap: THREE.CanvasTexture;
  dispose: () => void;
}

const TILE_SIZE = 64;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;

// Índices de célula (col, row) no atlas 4x4 (256x256)
interface TileCoord {
  col: number;
  row: number;
}

const TILE_MAP: Record<string, TileCoord> = {
  grass_top: { col: 0, row: 0 },
  grass_side: { col: 1, row: 0 },
  dirt: { col: 2, row: 0 },
  stone: { col: 3, row: 0 },
  sand: { col: 0, row: 1 },
  water: { col: 1, row: 1 },
  wood_top: { col: 2, row: 1 },
  wood_side: { col: 3, row: 1 },
  planks: { col: 0, row: 2 },
  cobblestone: { col: 1, row: 2 },
  glass: { col: 2, row: 2 },
  leaves: { col: 3, row: 2 },
  tall_grass: { col: 0, row: 3 },
  flower: { col: 1, row: 3 }
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = Number.parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function generateTilePixels(
  key: string,
  seed: number,
  size: number
): {
  rgb: Uint8Array;
  roughness: Uint8Array;
  alpha: Uint8Array;
} {
  const rgb = new Uint8Array(size * size * 3);
  const roughness = new Uint8Array(size * size);
  const alpha = new Uint8Array(size * size);
  alpha.fill(255);

  const keyHash = key.split('').reduce((acc, ch) => (Math.imul(acc, 31) + ch.charCodeAt(0)) >>> 0, seed);
  const nFine = new Noise2D(keyHash);
  const nCoarse = new Noise2D((keyHash ^ 0x5bd1e995) >>> 0);
  const rng = mulberry32(keyHash);

  const grassTopRgb = hexToRgb(getBlockDefinition(BlockId.GRASS).colors.top);
  const dirtRgb = hexToRgb(getBlockDefinition(BlockId.DIRT).colors.side);
  const stoneRgb = hexToRgb(getBlockDefinition(BlockId.STONE).colors.side);
  const sandRgb = hexToRgb(getBlockDefinition(BlockId.SAND).colors.top);
  const waterRgb = hexToRgb(getBlockDefinition(BlockId.WATER).colors.top);
  const woodTopRgb = hexToRgb(getBlockDefinition(BlockId.WOOD).colors.top);
  const woodSideRgb = hexToRgb(getBlockDefinition(BlockId.WOOD).colors.side);
  const planksRgb = hexToRgb(getBlockDefinition(BlockId.PLANKS).colors.top);
  const cobbleRgb = hexToRgb(getBlockDefinition(BlockId.COBBLESTONE).colors.top);
  const glassRgb = hexToRgb(getBlockDefinition(BlockId.GLASS).colors.top);
  const leavesRgb = hexToRgb(getBlockDefinition(BlockId.LEAVES).colors.top);
  const grassBladeRgb = hexToRgb(getBlockDefinition(BlockId.TALL_GRASS).colors.top);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = py * size + px;
      const p3 = idx * 3;
      const u = px / size;
      const v = py / size;

      const f1 = nFine.fbm(u * 12, v * 12, 3);
      const f2 = nCoarse.fbm(u * 5, v * 5, 2);
      const grain = (rng() - 0.5) * 0.14;

      let r = 180;
      let g = 180;
      let b = 180;
      let rough = 0.85;
      let a = 255;

      switch (key) {
        case 'grass_top': {
          const patch = f1 * 0.14 + f2 * 0.08 + grain;
          r = grassTopRgb[0] * (1 + patch);
          g = grassTopRgb[1] * (1 + patch * 1.15);
          b = grassTopRgb[2] * (1 + patch * 0.6);
          rough = 0.86 - f1 * 0.06;
          break;
        }
        case 'grass_side': {
          const skirt = 0.22 + f2 * 0.07 + Math.sin(u * Math.PI * 6) * 0.03;
          if (v < skirt) {
            const patch = f1 * 0.13 + grain;
            r = grassTopRgb[0] * (1 + patch);
            g = grassTopRgb[1] * (1 + patch * 1.15);
            b = grassTopRgb[2] * (1 + patch * 0.6);
            rough = 0.85;
          } else {
            const rootStreak = v < skirt + 0.14 && Math.abs(f1) > 0.24 ? 0.84 : 1.0;
            const dVar = (f1 * 0.15 + f2 * 0.08 + grain) * rootStreak;
            r = dirtRgb[0] * (1 + dVar);
            g = dirtRgb[1] * (1 + dVar);
            b = dirtRgb[2] * (1 + dVar);
            rough = 0.92;
          }
          break;
        }
        case 'dirt': {
          const pebble = Math.abs(f1) > 0.34 ? 0.12 : 0;
          const dVar = f1 * 0.16 + f2 * 0.09 + grain - pebble;
          r = dirtRgb[0] * (1 + dVar);
          g = dirtRgb[1] * (1 + dVar);
          b = dirtRgb[2] * (1 + dVar);
          rough = 0.93 + pebble * 0.2;
          break;
        }
        case 'stone': {
          const vein = Math.abs(Math.sin((u * 6 + f2 * 2.2) * Math.PI)) < 0.08 ? -0.11 : 0;
          const sVar = f1 * 0.15 + f2 * 0.1 + grain + vein;
          r = stoneRgb[0] * (1 + sVar);
          g = stoneRgb[1] * (1 + sVar);
          b = stoneRgb[2] * (1 + sVar);
          rough = 0.88 - vein * 0.4;
          break;
        }
        case 'sand': {
          const ripple = Math.sin((u * 4 + v * 2 + f2 * 1.4) * Math.PI * 2) * 0.04;
          const sdVar = f1 * 0.09 + grain * 1.3 + ripple;
          r = sandRgb[0] * (1 + sdVar);
          g = sandRgb[1] * (1 + sdVar);
          b = sandRgb[2] * (1 + sdVar * 0.9);
          rough = 0.91;
          break;
        }
        case 'water': {
          const wave = Math.sin((u * 6 + f2 * 1.8) * Math.PI * 2) * 0.08 + f1 * 0.08;
          r = waterRgb[0] * (1 + wave * 0.7);
          g = waterRgb[1] * (1 + wave * 0.9);
          b = waterRgb[2] * (1 + wave * 1.1);
          rough = 0.12;
          a = 192;
          break;
        }
        case 'wood_top': {
          const cx = u - 0.5;
          const cy = v - 0.5;
          const dist = Math.hypot(cx, cy) * 2;
          const ring = Math.sin((dist * 14 + f1 * 1.5) * Math.PI) * 0.1;
          r = woodTopRgb[0] * (1 + ring + grain * 0.5);
          g = woodTopRgb[1] * (1 + ring + grain * 0.5);
          b = woodTopRgb[2] * (1 + ring + grain * 0.5);
          rough = 0.78;
          break;
        }
        case 'wood_side': {
          const bark = Math.sin((u * 26 + f2 * 3.5) * Math.PI) * 0.12 + f1 * 0.1;
          r = woodSideRgb[0] * (1 + bark + grain * 0.4);
          g = woodSideRgb[1] * (1 + bark + grain * 0.4);
          b = woodSideRgb[2] * (1 + bark + grain * 0.4);
          rough = 0.89;
          break;
        }
        case 'planks': {
          const plankIndex = Math.floor(v * 4);
          const plankY = (v * 4) % 1;
          const seam = plankY < 0.06 || plankY > 0.96 ? -0.24 : 0;
          const jointOffset = (plankIndex % 2) * 0.5;
          const joint = Math.abs(((u + jointOffset) % 1) - 0.5) < 0.015 ? -0.18 : 0;
          const fiber = Math.sin((v * 48 + f1 * 2.5) * Math.PI) * 0.05 + (plankIndex - 1.5) * 0.025;
          const pVar = seam + joint + fiber + grain * 0.4;
          r = planksRgb[0] * (1 + pVar);
          g = planksRgb[1] * (1 + pVar);
          b = planksRgb[2] * (1 + pVar);
          rough = 0.76 - seam * 0.4;
          break;
        }
        case 'cobblestone': {
          const cellX = Math.floor(u * 4);
          const cellY = Math.floor(v * 4);
          const fx = (u * 4) % 1;
          const fy = (v * 4) % 1;
          const border = fx < 0.09 || fx > 0.91 || fy < 0.09 || fy > 0.91;
          const stoneShade = (((cellX * 7 + cellY * 13) % 5) - 2) * 0.05;
          const cVar = (border ? -0.22 : stoneShade) + f1 * 0.11 + grain * 0.6;
          r = cobbleRgb[0] * (1 + cVar);
          g = cobbleRgb[1] * (1 + cVar);
          b = cobbleRgb[2] * (1 + cVar);
          rough = border ? 0.95 : 0.84;
          break;
        }
        case 'glass': {
          const frame = u < 0.06 || u > 0.94 || v < 0.06 || v > 0.94;
          const diag = Math.abs((u + v) - 0.55) < 0.025 || Math.abs((u + v) - 1.35) < 0.015;
          r = frame ? 235 : glassRgb[0] + (diag ? 24 : 0);
          g = frame ? 248 : glassRgb[1] + (diag ? 24 : 0);
          b = frame ? 255 : glassRgb[2] + (diag ? 16 : 0);
          rough = 0.08;
          a = frame ? 215 : diag ? 145 : 78;
          break;
        }
        case 'leaves': {
          const leafCluster = f1 * 0.22 + f2 * 0.14 + grain;
          const gap = f1 < -0.28 && f2 < -0.16;
          r = leavesRgb[0] * (1 + leafCluster * 0.85);
          g = leavesRgb[1] * (1 + leafCluster * 1.15);
          b = leavesRgb[2] * (1 + leafCluster * 0.65);
          rough = 0.72;
          a = gap ? 0 : 255;
          break;
        }
        case 'tall_grass': {
          const blade1 = Math.abs(u - 0.32 - Math.sin(v * Math.PI * 2) * 0.08) < 0.045 * (1.25 - v * 0.5);
          const blade2 = Math.abs(u - 0.65 - Math.cos(v * Math.PI * 1.8) * 0.07) < 0.04 * (1.2 - v * 0.5);
          const hit = (blade1 || blade2) && v > 0.12;
          const tipBoost = v > 0.65 ? 1.12 : 0.92;
          r = grassBladeRgb[0] * tipBoost;
          g = grassBladeRgb[1] * tipBoost * 1.05;
          b = grassBladeRgb[2] * tipBoost * 0.7;
          rough = 0.75;
          a = hit ? 255 : 0;
          break;
        }
        case 'flower': {
          const stem = Math.abs(u - 0.5) < 0.035 && v >= 0.15 && v <= 0.65;
          const petalDist = Math.hypot((u - 0.5) * 2.4, (v - 0.72) * 2.4);
          const petal = petalDist < 0.42;
          const center = petalDist < 0.14;
          if (center) {
            r = 250;
            g = 204;
            b = 21;
            a = 255;
          } else if (petal) {
            r = 244;
            g = 63;
            b = 94;
            a = 255;
          } else if (stem) {
            r = 68;
            g = 158;
            b = 46;
            a = 255;
          } else {
            r = 68;
            g = 158;
            b = 46;
            a = 0;
          }
          rough = 0.68;
          break;
        }
        default: {
          r = 180;
          g = 180;
          b = 180;
          rough = 0.85;
          break;
        }
      }

      rgb[p3] = clampByte(r);
      rgb[p3 + 1] = clampByte(g);
      rgb[p3 + 2] = clampByte(b);
      roughness[idx] = clampByte(Math.max(0.05, Math.min(1.0, rough)) * 255);
      alpha[idx] = clampByte(a);
    }
  }

  return { rgb, roughness, alpha };
}

function buildNormalFromHeight(heightMap: Float32Array, width: number, height: number, strength = 2.4): Uint8Array {
  const normalBytes = new Uint8Array(width * height * 4);
  const sample = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    return heightMap[cy * width + cx];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hL = sample(x - 1, y);
      const hR = sample(x + 1, y);
      const hD = sample(x, y - 1);
      const hU = sample(x, y + 1);

      const dx = (hL - hR) * strength;
      const dy = (hD - hU) * strength;
      const dz = 1.0;
      const len = Math.hypot(dx, dy, dz) || 1;

      const nx = dx / len;
      const ny = dy / len;
      const nz = dz / len;

      const outIdx = (y * width + x) * 4;
      normalBytes[outIdx] = clampByte((nx * 0.5 + 0.5) * 255);
      normalBytes[outIdx + 1] = clampByte((ny * 0.5 + 0.5) * 255);
      normalBytes[outIdx + 2] = clampByte((nz * 0.5 + 0.5) * 255);
      normalBytes[outIdx + 3] = 255;
    }
  }
  return normalBytes;
}

export function createProceduralVoxelTextures(seed: number): ProceduralTextureSet {
  const atlasW = ATLAS_COLS * TILE_SIZE;
  const atlasH = ATLAS_ROWS * TILE_SIZE;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = atlasW;
  colorCanvas.height = atlasH;
  const colorCtx = colorCanvas.getContext('2d')!;
  const colorImg = colorCtx.createImageData(atlasW, atlasH);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = atlasW;
  roughCanvas.height = atlasH;
  const roughCtx = roughCanvas.getContext('2d')!;
  const roughImg = roughCtx.createImageData(atlasW, atlasH);

  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = atlasW;
  alphaCanvas.height = atlasH;
  const alphaCtx = alphaCanvas.getContext('2d')!;
  const alphaImg = alphaCtx.createImageData(atlasW, atlasH);

  const heightMap = new Float32Array(atlasW * atlasH);

  for (const [tileKey, coord] of Object.entries(TILE_MAP)) {
    const tile = generateTilePixels(tileKey, seed, TILE_SIZE);
    const ox = coord.col * TILE_SIZE;
    const oy = coord.row * TILE_SIZE;

    for (let ly = 0; ly < TILE_SIZE; ly++) {
      for (let lx = 0; lx < TILE_SIZE; lx++) {
        const lIdx = ly * TILE_SIZE + lx;
        const l3 = lIdx * 3;
        const gx = ox + lx;
        const gy = oy + ly;
        const gIdx = gy * atlasW + gx;
        const g4 = gIdx * 4;

        const r = tile.rgb[l3];
        const g = tile.rgb[l3 + 1];
        const b = tile.rgb[l3 + 2];
        const roughByte = tile.roughness[lIdx];
        const alphaByte = tile.alpha[lIdx];

        colorImg.data[g4] = r;
        colorImg.data[g4 + 1] = g;
        colorImg.data[g4 + 2] = b;
        colorImg.data[g4 + 3] = 255;

        roughImg.data[g4] = roughByte;
        roughImg.data[g4 + 1] = roughByte;
        roughImg.data[g4 + 2] = roughByte;
        roughImg.data[g4 + 3] = 255;

        alphaImg.data[g4] = alphaByte;
        alphaImg.data[g4 + 1] = alphaByte;
        alphaImg.data[g4 + 2] = alphaByte;
        alphaImg.data[g4 + 3] = 255;

        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        heightMap[gIdx] = lum * 0.7 + (1 - roughByte / 255) * 0.3;
      }
    }
  }

  colorCtx.putImageData(colorImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);
  alphaCtx.putImageData(alphaImg, 0, 0);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = atlasW;
  normalCanvas.height = atlasH;
  const normalCtx = normalCanvas.getContext('2d')!;
  const normalImg = normalCtx.createImageData(atlasW, atlasH);
  normalImg.data.set(buildNormalFromHeight(heightMap, atlasW, atlasH, 2.2));
  normalCtx.putImageData(normalImg, 0, 0);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.magFilter = THREE.NearestFilter;
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.generateMipmaps = true;
  roughnessMap.anisotropy = 4;
  roughnessMap.needsUpdate = true;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.magFilter = THREE.NearestFilter;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.generateMipmaps = true;
  normalMap.anisotropy = 4;
  normalMap.needsUpdate = true;

  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.colorSpace = THREE.NoColorSpace;
  alphaMap.magFilter = THREE.NearestFilter;
  alphaMap.minFilter = THREE.LinearMipmapLinearFilter;
  alphaMap.generateMipmaps = true;
  alphaMap.anisotropy = 4;
  alphaMap.needsUpdate = true;

  return {
    map,
    roughnessMap,
    normalMap,
    alphaMap,
    dispose: () => {
      map.dispose();
      roughnessMap.dispose();
      normalMap.dispose();
      alphaMap.dispose();
    }
  };
}

export function getAtlasUvRect(
  blockId: BlockTypeId | number,
  faceKey: 'top' | 'side' | 'bottom'
): { u0: number; v0: number; u1: number; v1: number } {
  let tileKey = 'stone';

  switch (blockId) {
    case BlockId.GRASS:
      tileKey = faceKey === 'top' ? 'grass_top' : faceKey === 'side' ? 'grass_side' : 'dirt';
      break;
    case BlockId.DIRT:
      tileKey = 'dirt';
      break;
    case BlockId.STONE:
      tileKey = 'stone';
      break;
    case BlockId.SAND:
      tileKey = 'sand';
      break;
    case BlockId.WATER:
      tileKey = 'water';
      break;
    case BlockId.WOOD:
      tileKey = faceKey === 'top' || faceKey === 'bottom' ? 'wood_top' : 'wood_side';
      break;
    case BlockId.PLANKS:
      tileKey = 'planks';
      break;
    case BlockId.COBBLESTONE:
      tileKey = 'cobblestone';
      break;
    case BlockId.GLASS:
      tileKey = 'glass';
      break;
    case BlockId.LEAVES:
      tileKey = 'leaves';
      break;
    case BlockId.TALL_GRASS:
      tileKey = 'tall_grass';
      break;
    case BlockId.FLOWER:
      tileKey = 'flower';
      break;
    default:
      tileKey = 'stone';
      break;
  }

  const coord = TILE_MAP[tileKey] ?? TILE_MAP.stone;
  const inset = 0.03 / TILE_SIZE;
  const u0 = coord.col / ATLAS_COLS + inset;
  const u1 = (coord.col + 1) / ATLAS_COLS - inset;

  // Em CanvasTexture com flipY padrão (true), row=0 fica no topo (v -> 1)
  const vTop = 1 - coord.row / ATLAS_ROWS - inset;
  const vBottom = 1 - (coord.row + 1) / ATLAS_ROWS + inset;

  return {
    u0,
    v0: vBottom,
    u1,
    v1: vTop
  };
}
