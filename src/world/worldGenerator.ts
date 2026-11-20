import { BlockId, getBlockDefinition, isBlockSolid } from '../core/types.js';
import { Chunk, CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, chunkKey } from './chunk.js';
import { Noise2D, hashStringToSeed, mulberry32 } from './noise.js';

export const SEA_LEVEL = 14;

export type BiomeType = 'plains' | 'forest' | 'desert' | 'mountains';

export interface ColumnProfile {
  height: number;
  biome: BiomeType;
  moisture: number;
}

export class WorldGenerator {
  public readonly seedString: string;
  public readonly seedNumber: number;
  private readonly continentNoise: Noise2D;
  private readonly ridgeNoise: Noise2D;
  private readonly moistureNoise: Noise2D;
  private readonly detailNoise: Noise2D;

  constructor(seedString: string) {
    this.seedString = seedString;
    this.seedNumber = hashStringToSeed(seedString || 'blockworld');
    this.continentNoise = new Noise2D(this.seedNumber);
    this.ridgeNoise = new Noise2D((this.seedNumber ^ 0x9e3779b9) >>> 0);
    this.moistureNoise = new Noise2D((this.seedNumber ^ 0x85ebca6b) >>> 0);
    this.detailNoise = new Noise2D((this.seedNumber ^ 0xc2b2ae35) >>> 0);
  }

  getBiomeAt(wx: number, wz: number): BiomeType {
    const moisture = this.moistureNoise.fbm(wx * 0.0085, wz * 0.0085, 3);
    const elevation = this.continentNoise.fbm(wx * 0.011, wz * 0.011, 3);
    const ridge = 1.0 - Math.abs(this.ridgeNoise.noise2D(wx * 0.018, wz * 0.018));

    if (elevation > 0.24 || ridge > 0.84) {
      return 'mountains';
    }
    if (moisture < -0.16) {
      return 'desert';
    }
    if (moisture > 0.14) {
      return 'forest';
    }
    return 'plains';
  }

  getColumnProfile(wx: number, wz: number): ColumnProfile {
    const biome = this.getBiomeAt(wx, wz);
    const moisture = this.moistureNoise.fbm(wx * 0.0085, wz * 0.0085, 3);
    const baseCont = this.continentNoise.fbm(wx * 0.012, wz * 0.012, 4);
    const detail = this.detailNoise.fbm(wx * 0.055, wz * 0.055, 2);
    const ridgeRaw = 1.0 - Math.abs(this.ridgeNoise.noise2D(wx * 0.022, wz * 0.022));
    const ridgePeak = Math.pow(Math.max(0, ridgeRaw), 2.2);

    // Calha fluvial sutil em áreas baixas/úmida
    const riverWave = Math.abs(this.detailNoise.noise2D(wx * 0.016 + 17.3, wz * 0.016 - 9.1));
    const riverCarve = riverWave < 0.055 && baseCont < 0.12 ? (0.055 - riverWave) * 52 : 0;

    let h = SEA_LEVEL + 2 + baseCont * 7.5 + detail * 2.1 - riverCarve;

    if (biome === 'mountains') {
      h += 5 + ridgePeak * 15.5 + Math.max(0, detail) * 3.0;
    } else if (biome === 'forest') {
      h += 1.5 + detail * 1.4;
    } else if (biome === 'desert') {
      const dune = Math.sin((wx * 0.14 + wz * 0.09 + baseCont * 4.0) * Math.PI) * 1.4;
      h += dune + detail * 0.8;
    }

    const height = Math.max(4, Math.min(CHUNK_SIZE_Y - 12, Math.round(h)));
    return { height, biome, moisture };
  }

  getHeightAt(wx: number, wz: number): number {
    return this.getColumnProfile(wx, wz).height;
  }

  getBlockAt(wx: number, wy: number, wz: number): number {
    const fx = Math.floor(wx);
    const fy = Math.floor(wy);
    const fz = Math.floor(wz);

    if (fy < 0 || fy >= CHUNK_SIZE_Y) {
      return BlockId.AIR;
    }
    if (fy === 0) {
      return BlockId.STONE;
    }

    const { height, biome } = this.getColumnProfile(fx, fz);

    if (fy > height) {
      return fy <= SEA_LEVEL ? BlockId.WATER : BlockId.AIR;
    }

    // Cavernas suaves no subsolo
    if (fy < height - 4 && fy > 2) {
      const caveVal = this.detailNoise.noise2D(fx * 0.065 + fy * 0.09, fz * 0.065 - fy * 0.07);
      if (caveVal > 0.62) {
        return BlockId.AIR;
      }
    }

    const nearWater = height <= SEA_LEVEL + 1;

    if (biome === 'desert') {
      if (fy >= height - 3) return BlockId.SAND;
      if (fy >= height - 6) return BlockId.STONE;
      return BlockId.STONE;
    }

    if (biome === 'mountains') {
      if (height >= SEA_LEVEL + 11) {
        return BlockId.STONE;
      }
      if (fy === height) {
        return nearWater ? BlockId.SAND : BlockId.GRASS;
      }
      if (fy >= height - 2) {
        return BlockId.DIRT;
      }
      return BlockId.STONE;
    }

    if (fy === height) {
      if (nearWater) {
        return BlockId.SAND;
      }
      return BlockId.GRASS;
    }

    if (fy >= height - 3) {
      return nearWater && fy === height - 1 ? BlockId.SAND : BlockId.DIRT;
    }

    return BlockId.STONE;
  }

  generateChunk(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const worldBaseX = cx * CHUNK_SIZE_X;
    const worldBaseZ = cz * CHUNK_SIZE_Z;

    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      const wz = worldBaseZ + z;
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const wx = worldBaseX + x;
        for (let y = 0; y < CHUNK_SIZE_Y; y++) {
          chunk.setBlock(x, y, z, this.getBlockAt(wx, y, wz));
        }
      }
    }

    // Árvores e vegetação determinística por coluna
    for (let z = 2; z < CHUNK_SIZE_Z - 2; z++) {
      const wz = worldBaseZ + z;
      for (let x = 2; x < CHUNK_SIZE_X - 2; x++) {
        const wx = worldBaseX + x;
        const { height, biome } = this.getColumnProfile(wx, wz);
        if (height <= SEA_LEVEL + 1 || height >= CHUNK_SIZE_Y - 10) {
          continue;
        }

        const surfaceBlock = chunk.getBlock(x, height, z);
        if (surfaceBlock !== BlockId.GRASS) {
          continue;
        }

        const colSeed = (this.seedNumber ^ Math.imul(wx, 374761393) ^ Math.imul(wz, 668265263)) >>> 0;
        const rng = mulberry32(colSeed);
        const roll = rng();

        const treeChance = biome === 'forest' ? 0.085 : biome === 'plains' ? 0.018 : 0.01;

        if (roll < treeChance) {
          const trunkHeight = biome === 'forest' ? 5 : 4;
          for (let ty = 1; ty <= trunkHeight; ty++) {
            chunk.setBlock(x, height + ty, z, BlockId.WOOD);
          }

          const crownBase = height + trunkHeight - 1;
          for (let ly = 0; ly <= 3; ly++) {
            const radius = ly === 3 ? 1 : 2;
            for (let dz = -radius; dz <= radius; dz++) {
              for (let dx = -radius; dx <= radius; dx++) {
                if (Math.abs(dx) === radius && Math.abs(dz) === radius && (ly === 0 || ly === 3)) {
                  continue;
                }
                const lx = x + dx;
                const lyPos = crownBase + ly;
                const lz = z + dz;
                if (chunk.getBlock(lx, lyPos, lz) === BlockId.AIR) {
                  chunk.setBlock(lx, lyPos, lz, BlockId.LEAVES);
                }
              }
            }
          }
        } else if (chunk.getBlock(x, height + 1, z) === BlockId.AIR) {
          if (roll < treeChance + 0.035) {
            chunk.setBlock(x, height + 1, z, BlockId.FLOWER);
          } else if (roll < treeChance + 0.17) {
            chunk.setBlock(x, height + 1, z, BlockId.TALL_GRASS);
          }
        }
      }
    }

    return chunk;
  }

  findSafeSpawn(x = 0, z = 0): { x: number; y: number; z: number } {
    const startX = Math.floor(x);
    const startZ = Math.floor(z);
    for (let r = 0; r <= 12; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const wx = startX + dx;
          const wz = startZ + dz;
          const h = this.getHeightAt(wx, wz);
          if (h >= SEA_LEVEL + 1) {
            const groundId = this.getBlockAt(wx, h, wz);
            const head1 = this.getBlockAt(wx, h + 1, wz);
            const head2 = this.getBlockAt(wx, h + 2, wz);
            if (isBlockSolid(groundId) && !isBlockSolid(head1) && !isBlockSolid(head2)) {
              return { x: wx + 0.5, y: h + 1.05, z: wz + 0.5 };
            }
          }
        }
      }
    }
    const fallbackH = this.getHeightAt(startX, startZ);
    return { x: startX + 0.5, y: Math.max(SEA_LEVEL + 2, fallbackH + 2), z: startZ + 0.5 };
  }

  getBlockLabel(blockId: number): string {
    return getBlockDefinition(blockId).name;
  }
}

export { chunkKey };
