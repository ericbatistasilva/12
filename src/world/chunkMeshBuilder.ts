import * as THREE from 'three';
import {
  BlockId,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  WORLD_HEIGHT,
  getBlockDefinition,
  isBlockSolid
} from '../core/types.js';
import { BlockFaceKind, getBlockFaceUvRect, UvRect } from './blockTextureAtlas.js';

export interface BlockLookup {
  getBlockAt(wx: number, wy: number, wz: number): number;
}

export interface ChunkRecord {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  opaqueMesh: THREE.Mesh | null;
  transparentMesh: THREE.Mesh | null;
  dirty: boolean;
}

export interface ChunkGeometries {
  opaqueGeometry: THREE.BufferGeometry | null;
  transparentGeometry: THREE.BufferGeometry | null;
}

interface FaceSpec {
  dir: [number, number, number];
  faceKind: BlockFaceKind;
  aoWeights: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ];
  corners: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ];
}

const FACES: FaceSpec[] = [
  {
    dir: [0, 1, 0],
    faceKind: 'top',
    aoWeights: [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1]
    ],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ]
  },
  {
    dir: [0, -1, 0],
    faceKind: 'bottom',
    aoWeights: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1]
    ],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ]
  },
  {
    dir: [1, 0, 0],
    faceKind: 'side',
    aoWeights: [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1]
    ],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1]
    ]
  },
  {
    dir: [-1, 0, 0],
    faceKind: 'side',
    aoWeights: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1]
    ],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0]
    ]
  },
  {
    dir: [0, 0, 1],
    faceKind: 'side',
    aoWeights: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1]
    ],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ]
  },
  {
    dir: [0, 0, -1],
    faceKind: 'side',
    aoWeights: [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1]
    ],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0]
    ]
  }
];

interface MeshBuffers {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  animKinds: number[];
  indices: number[];
}

function createMeshBuffers(): MeshBuffers {
  return {
    positions: [],
    normals: [],
    colors: [],
    uvs: [],
    animKinds: [],
    indices: []
  };
}

function isOccluding(getBlockWorld: BlockLookup, wx: number, wy: number, wz: number): boolean {
  const id = getBlockWorld.getBlockAt(wx, wy, wz);
  if (id === BlockId.AIR || id === BlockId.WATER || id === BlockId.GLASS || id === BlockId.LEAVES) {
    return false;
  }
  return isBlockSolid(id);
}

function computeCornerAo(
  getBlockWorld: BlockLookup,
  nx: number,
  ny: number,
  nz: number,
  wx: number,
  wy: number,
  wz: number,
  weight: [number, number, number]
): number {
  const [sx, sy, sz] = weight;
  let side1 = false;
  let side2 = false;
  let corner = false;

  if (ny !== 0) {
    side1 = isOccluding(getBlockWorld, wx + sx, wy + ny, wz);
    side2 = isOccluding(getBlockWorld, wx, wy + ny, wz + sz);
    corner = isOccluding(getBlockWorld, wx + sx, wy + ny, wz + sz);
  } else if (nx !== 0) {
    side1 = isOccluding(getBlockWorld, wx + nx, wy + sy, wz);
    side2 = isOccluding(getBlockWorld, wx + nx, wy, wz + sz);
    corner = isOccluding(getBlockWorld, wx + nx, wy + sy, wz + sz);
  } else {
    side1 = isOccluding(getBlockWorld, wx + sx, wy, wz + nz);
    side2 = isOccluding(getBlockWorld, wx, wy + sy, wz + nz);
    corner = isOccluding(getBlockWorld, wx + sx, wy + sy, wz + nz);
  }

  const occ = side1 && side2 ? 3 : (side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0);
  return Math.max(0.35, 1.0 - occ * 0.18);
}

function getBlockAnimKind(blockId: number): number {
  if (blockId === BlockId.WATER) return 1.0;
  if (blockId === BlockId.LEAVES) return 2.0;
  return 0.0;
}

function pushQuad(
  buf: MeshBuffers,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  corners: FaceSpec['corners'],
  uv: UvRect,
  baseColor: THREE.Color,
  aoValues: [number, number, number, number],
  animKind: number,
  yOffset = 0
): void {
  const baseIndex = buf.positions.length / 3;
  const quadUvs: [number, number][] = [
    [uv.u0, uv.v0],
    [uv.u1, uv.v0],
    [uv.u1, uv.v1],
    [uv.u0, uv.v1]
  ];

  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const ao = aoValues[i];
    buf.positions.push(x + c[0], y + c[1] + yOffset, z + c[2]);
    buf.normals.push(nx, ny, nz);
    buf.colors.push(
      Math.min(1, baseColor.r * ao),
      Math.min(1, baseColor.g * ao),
      Math.min(1, baseColor.b * ao)
    );
    buf.uvs.push(quadUvs[i][0], quadUvs[i][1]);
    buf.animKinds.push(animKind);
  }

  if (aoValues[0] + aoValues[2] > aoValues[1] + aoValues[3]) {
    buf.indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    buf.indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
  } else {
    buf.indices.push(baseIndex + 1, baseIndex + 2, baseIndex + 3);
    buf.indices.push(baseIndex + 1, baseIndex + 3, baseIndex);
  }
}

function finalizeGeometry(buf: MeshBuffers): THREE.BufferGeometry | null {
  if (buf.indices.length === 0) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
  geometry.setAttribute('aAnimKind', new THREE.Float32BufferAttribute(buf.animKinds, 1));
  geometry.setIndex(buf.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function isTransparentBlock(blockId: number): boolean {
  return blockId === BlockId.WATER || blockId === BlockId.GLASS || blockId === BlockId.LEAVES;
}

export function buildChunkGeometries(
  cx: number,
  cz: number,
  blocks: Uint8Array,
  getBlockWorld: BlockLookup
): ChunkGeometries {
  const opaqueBuf = createMeshBuffers();
  const transparentBuf = createMeshBuffers();
  const originX = cx * CHUNK_SIZE_X;
  const originZ = cz * CHUNK_SIZE_Z;
  const tempColor = new THREE.Color();

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      const wz = originZ + z;
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const idx = y * CHUNK_SIZE_X * CHUNK_SIZE_Z + z * CHUNK_SIZE_X + x;
        const blockId = blocks[idx];
        if (blockId === BlockId.AIR) {
          continue;
        }

        const wx = originX + x;
        const def = getBlockDefinition(blockId);
        const isTransp = isTransparentBlock(blockId);
        const targetBuf = isTransp ? transparentBuf : opaqueBuf;
        const animKind = getBlockAnimKind(blockId);

        for (const face of FACES) {
          const [nx, ny, nz] = face.dir;
          const neighborId = getBlockWorld.getBlockAt(wx + nx, y + ny, wz + nz);

          if (isTransp) {
            if (neighborId === blockId) {
              continue;
            }
            if (blockId === BlockId.WATER && isBlockSolid(neighborId)) {
              continue;
            }
            if (blockId !== BlockId.WATER && isBlockSolid(neighborId) && !isTransparentBlock(neighborId)) {
              continue;
            }
          } else if (isBlockSolid(neighborId) && !isTransparentBlock(neighborId)) {
            continue;
          }

          const uv = getBlockFaceUvRect(blockId, face.faceKind);
          const hex =
            face.faceKind === 'top'
              ? def.colors.top
              : face.faceKind === 'bottom'
                ? def.colors.bottom
                : def.colors.side;
          tempColor.set(hex);

          const hash = Math.abs(Math.sin(wx * 12.9898 + y * 78.233 + wz * 37.719));
          const tonalScale = 0.95 + (hash % 0.1);
          tempColor.multiplyScalar(tonalScale);

          const ao: [number, number, number, number] = isTransp
            ? [1, 1, 1, 1]
            : [
                computeCornerAo(getBlockWorld, nx, ny, nz, wx, y, wz, face.aoWeights[0]),
                computeCornerAo(getBlockWorld, nx, ny, nz, wx, y, wz, face.aoWeights[1]),
                computeCornerAo(getBlockWorld, nx, ny, nz, wx, y, wz, face.aoWeights[2]),
                computeCornerAo(getBlockWorld, nx, ny, nz, wx, y, wz, face.aoWeights[3])
              ];

          const yOffset = blockId === BlockId.WATER && face.faceKind === 'top' ? -0.1 : 0;

          pushQuad(
            targetBuf,
            wx,
            y,
            wz,
            nx,
            ny,
            nz,
            face.corners,
            uv,
            tempColor,
            ao,
            animKind,
            yOffset
          );
        }
      }
    }
  }

  return {
    opaqueGeometry: finalizeGeometry(opaqueBuf),
    transparentGeometry: finalizeGeometry(transparentBuf)
  };
}
