import * as THREE from 'three';
import {
  BlockId,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  SerialChunk,
  WORLD_HEIGHT,
  isBlockSolid
} from '../core/types.js';
import { buildChunkGeometries } from './chunkMeshBuilder.js';
import { WorldGenerator } from './worldGenerator.js';

export interface ChunkRecord {
  cx: number;
  cz: number;
  key: string;
  blocks: Uint8Array;
  modified: boolean;
  dirtyMesh: boolean;
  opaqueMesh: THREE.Mesh | null;
  transparentMesh: THREE.Mesh | null;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function worldToChunkCoords(wx: number, wz: number): { cx: number; cz: number; lx: number; lz: number } {
  const fx = Math.floor(wx);
  const fz = Math.floor(wz);
  const cx = Math.floor(fx / CHUNK_SIZE_X);
  const cz = Math.floor(fz / CHUNK_SIZE_Z);
  const lx = ((fx % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
  const lz = ((fz % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
  return { cx, cz, lx, lz };
}

export class ChunkManager {
  public readonly generator: WorldGenerator;
  private readonly chunks: Map<string, ChunkRecord> = new Map();
  private readonly scene: THREE.Scene | null;
  private readonly opaqueMaterial: THREE.Material | null;
  private readonly transparentMaterial: THREE.Material | null;

  constructor(
    generator: WorldGenerator,
    scene: THREE.Scene | null = null,
    opaqueMaterial: THREE.Material | null = null,
    transparentMaterial: THREE.Material | null = null
  ) {
    this.generator = generator;
    this.scene = scene;
    this.opaqueMaterial = opaqueMaterial;
    this.transparentMaterial = transparentMaterial;
  }

  getLoadedChunkCount(): number {
    return this.chunks.size;
  }

  getChunk(cx: number, cz: number): ChunkRecord | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  loadSavedChunks(savedChunks: SerialChunk[]): void {
    for (const sc of savedChunks) {
      const key = chunkKey(sc.cx, sc.cz);
      const blocks = new Uint8Array(CHUNK_SIZE_X * WORLD_HEIGHT * CHUNK_SIZE_Z);
      const len = Math.min(blocks.length, sc.blocks.length);
      for (let i = 0; i < len; i++) {
        blocks[i] = sc.blocks[i];
      }
      const existing = this.chunks.get(key);
      if (existing) {
        existing.blocks = blocks;
        existing.modified = true;
        existing.dirtyMesh = true;
      } else {
        this.chunks.set(key, {
          cx: sc.cx,
          cz: sc.cz,
          key,
          blocks,
          modified: true,
          dirtyMesh: true,
          opaqueMesh: null,
          transparentMesh: null
        });
      }
    }
  }

  ensureChunk(cx: number, cz: number): ChunkRecord {
    const key = chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) {
      return existing;
    }
    const blocks = this.generator.generateChunkBlocks(cx, cz);
    const record: ChunkRecord = {
      cx,
      cz,
      key,
      blocks,
      modified: false,
      dirtyMesh: true,
      opaqueMesh: null,
      transparentMesh: null
    };
    this.chunks.set(key, record);
    return record;
  }

  getBlockAt(wx: number, wy: number, wz: number): number {
    const y = Math.floor(wy);
    if (y < 0 || y >= WORLD_HEIGHT) {
      return BlockId.AIR;
    }
    const { cx, cz, lx, lz } = worldToChunkCoords(wx, wz);
    const existing = this.chunks.get(chunkKey(cx, cz));
    if (!existing) {
      const generated = this.generator.generateChunkBlocks(cx, cz);
      const idx = y * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;
      return generated[idx];
    }
    const idx = y * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;
    return existing.blocks[idx];
  }

  isSolidAt(wx: number, wy: number, wz: number): boolean {
    return isBlockSolid(this.getBlockAt(wx, wy, wz));
  }

  setBlockAt(wx: number, wy: number, wz: number, blockId: number): boolean {
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    const z = Math.floor(wz);
    if (y < 0 || y >= WORLD_HEIGHT) {
      return false;
    }

    const { cx, cz, lx, lz } = worldToChunkCoords(x, z);
    const chunk = this.ensureChunk(cx, cz);
    const idx = y * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;

    if (chunk.blocks[idx] === blockId) {
      return false;
    }

    chunk.blocks[idx] = blockId;
    chunk.modified = true;
    chunk.dirtyMesh = true;

    // Marca chunks vizinhos se o bloco alterado estiver na borda do chunk
    if (lx === 0) this.markDirtyIfLoaded(cx - 1, cz);
    if (lx === CHUNK_SIZE_X - 1) this.markDirtyIfLoaded(cx + 1, cz);
    if (lz === 0) this.markDirtyIfLoaded(cx, cz - 1);
    if (lz === CHUNK_SIZE_Z - 1) this.markDirtyIfLoaded(cx, cz + 1);

    return true;
  }

  private markDirtyIfLoaded(cx: number, cz: number): void {
    const neighbor = this.chunks.get(chunkKey(cx, cz));
    if (neighbor) {
      neighbor.dirtyMesh = true;
    }
  }

  updateAroundPosition(posX: number, posZ: number, renderDistance: number, maxMeshRebuildsPerFrame = 3): void {
    const center = worldToChunkCoords(posX, posZ);
    const desiredKeys = new Set<string>();

    for (let dz = -renderDistance; dz <= renderDistance; dz++) {
      for (let dx = -renderDistance; dx <= renderDistance; dx++) {
        const cx = center.cx + dx;
        const cz = center.cz + dz;
        const key = chunkKey(cx, cz);
        desiredKeys.add(key);
        this.ensureChunk(cx, cz);
      }
    }

    // Descarrega chunks distantes (preservando os modificados na memória até salvar)
    for (const [key, record] of this.chunks.entries()) {
      if (!desiredKeys.has(key)) {
        this.disposeChunkMesh(record);
        if (!record.modified) {
          this.chunks.delete(key);
        }
      }
    }

    // Reconstrói malhas pendentes de forma fatiada para manter fluidez
    let rebuilt = 0;
    for (const record of this.chunks.values()) {
      if (record.dirtyMesh && desiredKeys.has(record.key)) {
        this.rebuildChunkMesh(record);
        rebuilt++;
        if (rebuilt >= maxMeshRebuildsPerFrame) {
          break;
        }
      }
    }
  }

  rebuildAllDirtyMeshes(): void {
    for (const record of this.chunks.values()) {
      if (record.dirtyMesh) {
        this.rebuildChunkMesh(record);
      }
    }
  }

  rebuildChunkMesh(record: ChunkRecord): void {
    this.disposeChunkMesh(record);
    record.dirtyMesh = false;

    if (!this.scene || !this.opaqueMaterial || !this.transparentMaterial) {
      return;
    }

    const built = buildChunkGeometries(record.cx, record.cz, record.blocks, this);

    if (built.opaqueGeometry) {
      const mesh = new THREE.Mesh(built.opaqueGeometry, this.opaqueMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      record.opaqueMesh = mesh;
    }

    if (built.transparentGeometry) {
      const mesh = new THREE.Mesh(built.transparentGeometry, this.transparentMaterial);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      record.transparentMesh = mesh;
    }
  }

  private disposeChunkMesh(record: ChunkRecord): void {
    if (record.opaqueMesh) {
      this.scene?.remove(record.opaqueMesh);
      record.opaqueMesh.geometry.dispose();
      record.opaqueMesh = null;
    }
    if (record.transparentMesh) {
      this.scene?.remove(record.transparentMesh);
      record.transparentMesh.geometry.dispose();
      record.transparentMesh = null;
    }
  }

  getModifiedChunksSerialized(): SerialChunk[] {
    const result: SerialChunk[] = [];
    for (const record of this.chunks.values()) {
      if (record.modified) {
        result.push({
          cx: record.cx,
          cz: record.cz,
          blocks: Array.from(record.blocks)
        });
      }
    }
    return result;
  }

  disposeAll(): void {
    for (const record of this.chunks.values()) {
      this.disposeChunkMesh(record);
    }
    this.chunks.clear();
  }
}
