import * as THREE from 'three';
import { BlockId } from '../core/types.js';
import {
  Chunk,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  chunkKey,
  parseChunkKey,
  worldToChunkCoord,
  worldToLocalCoord
} from './chunk.js';
import { WorldGenerator } from './worldGenerator.js';
import { buildChunkMesh, ChunkMeshData } from './chunkMeshBuilder.js';

interface ChunkRecord {
  chunk: Chunk;
  meshData: ChunkMeshData;
  group: THREE.Group;
  dirty: boolean;
}

export class ChunkManager {
  private readonly scene: THREE.Scene;
  private readonly generator: WorldGenerator;
  private readonly materials: {
    opaqueMaterial: THREE.Material;
    foliageMaterial: THREE.Material;
    glassMaterial: THREE.Material;
    waterMaterial: THREE.Material;
  };
  private readonly records = new Map<string, ChunkRecord>();
  private readonly buildQueue: string[] = [];
  private readonly queuedSet = new Set<string>();
  private aoStrength = 0.55;
  private shadowsEnabled = true;

  constructor(
    scene: THREE.Scene,
    generator: WorldGenerator,
    materials: {
      opaqueMaterial: THREE.Material;
      foliageMaterial: THREE.Material;
      glassMaterial: THREE.Material;
      waterMaterial: THREE.Material;
    },
    options?: {
      aoStrength?: number;
      shadowsEnabled?: boolean;
    }
  ) {
    this.scene = scene;
    this.generator = generator;
    this.materials = materials;
    this.aoStrength = options?.aoStrength ?? 0.55;
    this.shadowsEnabled = options?.shadowsEnabled ?? true;
  }

  setVisualOptions(options: { aoStrength: number; shadowsEnabled: boolean }): void {
    const aoChanged = Math.abs(this.aoStrength - options.aoStrength) > 0.001;
    const shadowChanged = this.shadowsEnabled !== options.shadowsEnabled;
    this.aoStrength = options.aoStrength;
    this.shadowsEnabled = options.shadowsEnabled;

    if (aoChanged || shadowChanged) {
      for (const rec of this.records.values()) {
        rec.dirty = true;
        this.enqueueKey(chunkKey(rec.chunk.cx, rec.chunk.cz));
      }
    }
  }

  private enqueueKey(key: string): void {
    if (this.queuedSet.has(key)) {
      return;
    }
    this.queuedSet.add(key);
    this.buildQueue.push(key);
  }

  getOrCreateChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    const existing = this.records.get(key);
    if (existing) {
      return existing.chunk;
    }

    const chunk = this.generator.generateChunk(cx, cz);
    const group = new THREE.Group();
    this.scene.add(group);

    const meshData = buildChunkMesh(chunk, this.getBlockWorld.bind(this), this.materials, {
      aoStrength: this.aoStrength,
      castShadow: this.shadowsEnabled,
      receiveShadow: this.shadowsEnabled
    });
    this.attachMeshesToGroup(group, meshData);

    this.records.set(key, {
      chunk,
      meshData,
      group,
      dirty: false
    });

    return chunk;
  }

  private attachMeshesToGroup(group: THREE.Group, meshData: ChunkMeshData): void {
    group.clear();
    if (meshData.opaqueMesh) group.add(meshData.opaqueMesh);
    if (meshData.foliageMesh) group.add(meshData.foliageMesh);
    if (meshData.glassMesh) group.add(meshData.glassMesh);
    if (meshData.waterMesh) group.add(meshData.waterMesh);
  }

  rebuildChunkMesh(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const record = this.records.get(key);
    if (!record) {
      return;
    }

    const nextMeshData = buildChunkMesh(record.chunk, this.getBlockWorld.bind(this), this.materials, {
      aoStrength: this.aoStrength,
      castShadow: this.shadowsEnabled,
      receiveShadow: this.shadowsEnabled
    });
    this.attachMeshesToGroup(record.group, nextMeshData);
    record.meshData.dispose();
    record.meshData = nextMeshData;
    record.dirty = false;
  }

  getBlockWorld(wx: number, wy: number, wz: number): number {
    const fx = Math.floor(wx);
    const fy = Math.floor(wy);
    const fz = Math.floor(wz);
    const { cx, cz } = worldToChunkCoord(fx, fz);
    const key = chunkKey(cx, cz);
    const existing = this.records.get(key);
    if (existing) {
      const { lx, lz } = worldToLocalCoord(fx, fz);
      return existing.chunk.getBlock(lx, fy, lz);
    }
    return this.generator.getBlockAt(fx, fy, fz);
  }

  setBlockWorld(wx: number, wy: number, wz: number, blockId: number): boolean {
    const fx = Math.floor(wx);
    const fy = Math.floor(wy);
    const fz = Math.floor(wz);
    const { cx, cz } = worldToChunkCoord(fx, fz);
    const chunk = this.getOrCreateChunk(cx, cz);
    const { lx, lz } = worldToLocalCoord(fx, fz);

    if (!chunk.setBlock(lx, fy, lz, blockId)) {
      return false;
    }

    this.rebuildChunkMesh(cx, cz);

    if (lx === 0) this.markDirtyAndQueue(cx - 1, cz);
    if (lx === CHUNK_SIZE_X - 1) this.markDirtyAndQueue(cx + 1, cz);
    if (lz === 0) this.markDirtyAndQueue(cx, cz - 1);
    if (lz === CHUNK_SIZE_Z - 1) this.markDirtyAndQueue(cx, cz + 1);

    return true;
  }

  private markDirtyAndQueue(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const rec = this.records.get(key);
    if (rec) {
      rec.dirty = true;
      this.enqueueKey(key);
    }
  }

  updateAroundPlayer(
    playerX: number,
    playerZ: number,
    renderDistance: number,
    maxChunkOperationsPerFrame = 3
  ): void {
    const center = worldToChunkCoord(Math.floor(playerX), Math.floor(playerZ));
    const candidates: Array<{ cx: number; cz: number; distSq: number }> = [];

    for (let dz = -renderDistance; dz <= renderDistance; dz++) {
      for (let dx = -renderDistance; dx <= renderDistance; dx++) {
        const distSq = dx * dx + dz * dz;
        if (distSq > renderDistance * renderDistance + 1) {
          continue;
        }
        const cx = center.cx + dx;
        const cz = center.cz + dz;
        const key = chunkKey(cx, cz);
        if (!this.records.has(key)) {
          candidates.push({ cx, cz, distSq });
        }
      }
    }

    candidates.sort((a, b) => a.distSq - b.distSq);

    let ops = 0;
    for (const c of candidates) {
      if (ops >= maxChunkOperationsPerFrame) break;
      this.getOrCreateChunk(c.cx, c.cz);
      ops++;
    }

    while (ops < maxChunkOperationsPerFrame && this.buildQueue.length > 0) {
      const nextKey = this.buildQueue.shift()!;
      this.queuedSet.delete(nextKey);
      const rec = this.records.get(nextKey);
      if (rec && rec.dirty) {
        this.rebuildChunkMesh(rec.chunk.cx, rec.chunk.cz);
        ops++;
      }
    }

    const unloadRadiusSq = (renderDistance + 2) * (renderDistance + 2);
    for (const [key, rec] of this.records.entries()) {
      const parsed = parseChunkKey(key);
      const dx = parsed.cx - center.cx;
      const dz = parsed.cz - center.cz;
      if (dx * dx + dz * dz > unloadRadiusSq) {
        this.scene.remove(rec.group);
        rec.meshData.dispose();
        this.records.delete(key);
      }
    }
  }

  getLoadedChunkCount(): number {
    return this.records.size;
  }

  exportModifiedChunks(
    isModified: (cx: number, cz: number, chunk: Chunk) => boolean
  ): Array<{ cx: number; cz: number; blocks: number[] }> {
    const out: Array<{ cx: number; cz: number; blocks: number[] }> = [];
    for (const rec of this.records.values()) {
      if (isModified(rec.chunk.cx, rec.chunk.cz, rec.chunk)) {
        out.push({
          cx: rec.chunk.cx,
          cz: rec.chunk.cz,
          blocks: Array.from(rec.chunk.blocks)
        });
      }
    }
    return out;
  }

  applySavedChunk(cx: number, cz: number, blocks: number[]): void {
    const chunk = this.getOrCreateChunk(cx, cz);
    chunk.blocks.set(blocks.slice(0, chunk.blocks.length));
    this.rebuildChunkMesh(cx, cz);
  }

  dispose(): void {
    for (const rec of this.records.values()) {
      this.scene.remove(rec.group);
      rec.meshData.dispose();
    }
    this.records.clear();
    this.buildQueue.length = 0;
    this.queuedSet.clear();
  }
}

export { BlockId };
