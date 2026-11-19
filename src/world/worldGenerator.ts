import {
  BlockId,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  SEA_LEVEL,
  WORLD_HEIGHT
} from '../core/types.js';
import { Noise2D, Noise3D, hashSeed, mulberry32 } from './noise.js';

export type BiomeType = 'Planície' | 'Floresta' | 'Montanhas' | 'Costa / Praia' | 'Vale Fluvial';

export interface ColumnSample {
  height: number;
  biome: BiomeType;
  moisture: number;
  mountainFactor: number;
}

export class WorldGenerator {
  public readonly seedString: string;
  public readonly numericSeed: number;
  private readonly continentNoise: Noise2D;
  private readonly hillNoise: Noise2D;
  private readonly mountainNoise: Noise2D;
  private readonly moistureNoise: Noise2D;
  private readonly caveNoise: Noise3D;

  constructor(seedInput: string) {
    this.seedString = seedInput.trim() || 'blockworld-default';
    this.numericSeed = hashSeed(this.seedString);
    this.continentNoise = new Noise2D((this.numericSeed ^ 0x1234567) >>> 0);
    this.hillNoise = new Noise2D((this.numericSeed ^ 0x89abcdef) >>> 0);
    this.mountainNoise = new Noise2D((this.numericSeed ^ 0x55aa55aa) >>> 0);
    this.moistureNoise = new Noise2D((this.numericSeed ^ 0xa55aa55a) >>> 0);
    this.caveNoise = new Noise3D((this.numericSeed ^ 0x2468ace0) >>> 0);
  }

  sampleColumn(worldX: number, worldZ: number): ColumnSample {
    const cont = this.continentNoise.fbm(worldX * 0.0045, worldZ * 0.0045, 4);
    const hills = this.hillNoise.fbm(worldX * 0.018, worldZ * 0.018, 3);
    const ridgeRaw = Math.abs(this.mountainNoise.fbm(worldX * 0.011, worldZ * 0.011, 4));
    const ridge = Math.pow(1.0 - Math.min(1.0, ridgeRaw * 1.35), 2.0);
    const moisture = (this.moistureNoise.fbm(worldX * 0.008, worldZ * 0.008, 3) + 1) * 0.5;

    const mountainFactor = Math.max(0, Math.min(1, (cont + 0.15) * 1.4)) * ridge;

    let height = SEA_LEVEL + cont * 7.5 + hills * 4.2 + mountainFactor * 18.0;
    height = Math.max(4, Math.min(WORLD_HEIGHT - 8, Math.floor(height)));

    let biome: BiomeType = 'Planície';
    if (height <= SEA_LEVEL + 1) {
      biome = 'Costa / Praia';
    } else if (mountainFactor > 0.42 || height >= SEA_LEVEL + 13) {
      biome = 'Montanhas';
    } else if (moisture > 0.54) {
      biome = 'Floresta';
    } else if (Math.abs(height - SEA_LEVEL) <= 2 && moisture > 0.45) {
      biome = 'Vale Fluvial';
    }

    return { height, biome, moisture, mountainFactor };
  }

  getBiomeAt(worldX: number, worldZ: number): BiomeType {
    return this.sampleColumn(worldX, worldZ).biome;
  }

  private isCaveCarved(worldX: number, y: number, worldZ: number, surfaceHeight: number): boolean {
    if (y <= 1 || y >= surfaceHeight - 2) {
      return false;
    }
    const c1 = this.caveNoise.noise(worldX * 0.055, y * 0.085, worldZ * 0.055);
    const c2 = this.caveNoise.noise(worldX * 0.025 + 31.7, y * 0.045 - 14.2, worldZ * 0.025 + 9.4);
    const tunnelStrength = Math.abs(c1) + Math.abs(c2) * 0.5;
    return tunnelStrength < 0.155;
  }

  generateChunkBlocks(cx: number, cz: number): Uint8Array {
    const blocks = new Uint8Array(CHUNK_SIZE_X * WORLD_HEIGHT * CHUNK_SIZE_Z);
    const baseX = cx * CHUNK_SIZE_X;
    const baseZ = cz * CHUNK_SIZE_Z;

    const indexOf = (lx: number, y: number, lz: number): number =>
      y * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;

    const surfaceHeights = new Int32Array(CHUNK_SIZE_X * CHUNK_SIZE_Z);
    const biomes: BiomeType[] = new Array(CHUNK_SIZE_X * CHUNK_SIZE_Z);

    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const sample = this.sampleColumn(wx, wz);
        const colIdx = lz * CHUNK_SIZE_X + lx;
        surfaceHeights[colIdx] = sample.height;
        biomes[colIdx] = sample.biome;

        for (let y = 0; y < WORLD_HEIGHT; y++) {
          let blockId: number = BlockId.AIR;

          if (y === 0) {
            blockId = BlockId.STONE;
          } else if (y < sample.height - 3) {
            blockId = BlockId.STONE;
          } else if (y < sample.height) {
            if (sample.biome === 'Costa / Praia' || sample.height <= SEA_LEVEL + 1) {
              blockId = BlockId.SAND;
            } else if (sample.biome === 'Montanhas' && y > SEA_LEVEL + 11) {
              blockId = BlockId.STONE;
            } else {
              blockId = BlockId.DIRT;
            }
          } else if (y === sample.height) {
            if (sample.height < SEA_LEVEL - 1) {
              blockId = sample.biome === 'Costa / Praia' ? BlockId.SAND : BlockId.DIRT;
            } else if (sample.height <= SEA_LEVEL + 1) {
              blockId = BlockId.SAND;
            } else if (sample.biome === 'Montanhas' && sample.height >= SEA_LEVEL + 14) {
              blockId = BlockId.STONE;
            } else {
              blockId = BlockId.GRASS;
            }
          } else if (y <= SEA_LEVEL) {
            blockId = BlockId.WATER;
          }

          if (blockId !== BlockId.AIR && blockId !== BlockId.WATER && this.isCaveCarved(wx, y, wz, sample.height)) {
            blockId = BlockId.AIR;
          }

          blocks[indexOf(lx, y, lz)] = blockId;
        }
      }
    }

    // Árvores e vegetação superficial em colunas fora da água
    const chunkRng = mulberry32((this.numericSeed ^ Math.imul(cx, 374761393) ^ Math.imul(cz, 668265263)) >>> 0);

    for (let lz = 2; lz < CHUNK_SIZE_Z - 2; lz++) {
      for (let lx = 2; lx < CHUNK_SIZE_X - 2; lx++) {
        const colIdx = lz * CHUNK_SIZE_X + lx;
        const groundY = surfaceHeights[colIdx];
        const biome = biomes[colIdx];
        const groundBlock = blocks[indexOf(lx, groundY, lz)];

        if (groundY <= SEA_LEVEL + 1 || groundBlock !== BlockId.GRASS) {
          continue;
        }

        const aboveBlock = blocks[indexOf(lx, groundY + 1, lz)];
        if (aboveBlock !== BlockId.AIR) {
          continue;
        }

        const roll = chunkRng();
        const treeThreshold = biome === 'Floresta' ? 0.085 : biome === 'Planície' ? 0.016 : 0.006;

        if (roll < treeThreshold) {
          this.placeTree(blocks, lx, groundY + 1, lz, chunkRng);
        } else if (roll < treeThreshold + (biome === 'Floresta' ? 0.14 : 0.09)) {
          blocks[indexOf(lx, groundY + 1, lz)] =
            chunkRng() < 0.2 ? BlockId.FLOWER : BlockId.TALL_GRASS;
        }
      }
    }

    return blocks;
  }

  private placeTree(
    blocks: Uint8Array,
    lx: number,
    baseY: number,
    lz: number,
    rng: () => number
  ): void {
    const trunkHeight = 4 + (rng() < 0.35 ? 1 : 0);
    const indexOf = (x: number, y: number, z: number): number =>
      y * CHUNK_SIZE_X * CHUNK_SIZE_Z + z * CHUNK_SIZE_X + x;

    for (let dy = 0; dy < trunkHeight; dy++) {
      const y = baseY + dy;
      if (y < WORLD_HEIGHT) {
        blocks[indexOf(lx, y, lz)] = BlockId.WOOD;
      }
    }

    const canopyStart = baseY + trunkHeight - 2;
    const canopyTop = baseY + trunkHeight + 1;

    for (let y = canopyStart; y <= canopyTop; y++) {
      if (y < 0 || y >= WORLD_HEIGHT) continue;
      const radius = y === canopyTop ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = lx + dx;
          const nz = lz + dz;
          if (nx < 0 || nx >= CHUNK_SIZE_X || nz < 0 || nz >= CHUNK_SIZE_Z) {
            continue;
          }
          const isCorner = Math.abs(dx) === radius && Math.abs(dz) === radius;
          if (isCorner && y === canopyTop && rng() < 0.7) {
            continue;
          }
          if (dx === 0 && dz === 0 && y < baseY + trunkHeight) {
            continue;
          }
          const idx = indexOf(nx, y, nz);
          if (blocks[idx] === BlockId.AIR) {
            blocks[idx] = BlockId.LEAVES;
          }
        }
      }
    }
  }

  findSafeSpawn(startX = 0, startZ = 0): { x: number; y: number; z: number } {
    const offsets = [
      [0, 0],
      [4, 0],
      [-4, 0],
      [0, 4],
      [0, -4],
      [8, 8],
      [-8, 8],
      [8, -8],
      [-8, -8]
    ];

    for (const [ox, oz] of offsets) {
      const x = startX + ox;
      const z = startZ + oz;
      const sample = this.sampleColumn(x, z);
      if (sample.height >= SEA_LEVEL + 1) {
        return {
          x: x + 0.5,
          y: sample.height + 1.05,
          z: z + 0.5
        };
      }
    }

    const fallback = this.sampleColumn(startX, startZ);
    return {
      x: startX + 0.5,
      y: Math.max(SEA_LEVEL + 2, fallback.height + 1.05),
      z: startZ + 0.5
    };
  }
}
