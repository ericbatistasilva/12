import * as THREE from 'three';
import {
  BlockId,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  WORLD_HEIGHT,
  getBlockDefinition,
  isBlockTransparent
} from '../core/types.js';
import { BlockFaceKind, getBlockFaceUvRect } from './blockTextureAtlas.js';

export interface WorldBlockLookup {
  getBlockAt(wx: number, wy: number, wz: number): number;
}

export interface ChunkGeometries {
  opaqueGeometry: THREE.BufferGeometry | null;
  transparentGeometry: THREE.BufferGeometry | null;
}

interface FaceDef {
  dir: [number, number, number];
  faceKind: BlockFaceKind;
  corners: ReadonlyArray<[number, number, number]>;
  aoOffsets: ReadonlyArray<ReadonlyArray<[number, number, number]>>;
}

const FACE_DEFS: ReadonlyArray<FaceDef> = [
  {
    dir: [1, 0, 0],
    faceKind: 'side',
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1]
    ],
    aoOffsets: [
      [[1, -1, 0], [1, 0, 1], [1, -1, 1]],
      [[1, -1, 0], [1, 0, -1], [1, -1, -1]],
      [[1, 1, 0], [1, 0, -1], [1, 1, -1]],
      [[1, 1, 0], [1, 0, 1], [1, 1, 1]]
    ]
  },
  {
    dir: [-1, 0, 0],
    faceKind: 'side',
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0]
    ],
    aoOffsets: [
      [[-1, -1, 0], [-1, 0, -1], [-1, -1, -1]],
      [[-1, -1, 0], [-1, 0, 1], [-1, -1, 1]],
      [[-1, 1, 0], [-1, 0, 1], [-1, 1, 1]],
      [[-1, 1, 0], [-1, 0, -1], [-1, 1, -1]]
    ]
  },
  {
    dir: [0, 1, 0],
    faceKind: 'top',
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ],
    aoOffsets: [
      [[-1, 1, 0], [0, 1, 1], [-1, 1, 1]],
      [[1, 1, 0], [0, 1, 1], [1, 1, 1]],
      [[1, 1, 0], [0, 1, -1], [1, 1, -1]],
      [[-1, 1, 0], [0, 1, -1], [-1, 1, -1]]
    ]
  },
  {
    dir: [0, -1, 0],
    faceKind: 'bottom',
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ],
    aoOffsets: [
      [[-1, -1, 0], [0, -1, -1], [-1, -1, -1]],
      [[1, -1, 0], [0, -1, -1], [1, -1, -1]],
      [[1, -1, 0], [0, -1, 1], [1, -1, 1]],
      [[-1, -1, 0], [0, -1, 1], [-1, -1, 1]]
    ]
  },
  {
    dir: [0, 0, 1],
    faceKind: 'side',
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ],
    aoOffsets: [
      [[-1, 0, 1], [0, -1, 1], [-1, -1, 1]],
      [[1, 0, 1], [0, -1, 1], [1, -1, 1]],
      [[1, 0, 1], [0, 1, 1], [1, 1, 1]],
      [[-1, 0, 1], [0, 1, 1], [-1, 1, 1]]
    ]
  },
  {
    dir: [0, 0, -1],
    faceKind: 'side',
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0]
    ],
    aoOffsets: [
      [[1, 0, -1], [0, -1, -1], [1, -1, -1]],
      [[-1, 0, -1], [0, -1, -1], [-1, -1, -1]],
      [[-1, 0, -1], [0, 1, -1], [-1, 1, -1]],
      [[1, 0, -1], [0, 1, -1], [1, 1, -1]]
    ]
  }
];

interface MeshBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  animKinds: number[];
  animWeights: number[];
  indices: number[];
}

function createBuffers(): MeshBuffers {
  return {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    animKinds: [],
    animWeights: [],
    indices: []
  };
}

function blockToneVariation(wx: number, wy: number, wz: number): number {
  const h = Math.sin(wx * 12.9898 + wy * 78.233 + wz * 37.719) * 43758.5453;
  const frac = h - Math.floor(h);
  return 0.94 + frac * 0.12;
}

function vertexAoFactor(
  side1Solid: boolean,
  side2Solid: boolean,
  cornerSolid: boolean
): number {
  const occ = side1Solid && side2Solid ? 3 : (side1Solid ? 1 : 0) + (side2Solid ? 1 : 0) + (cornerSolid ? 1 : 0);
  const factors = [1.0, 0.84, 0.68, 0.52];
  return factors[occ] ?? 1.0;
}

export function computeVertexAnimKindAndWeight(
  blockId: number,
  faceKind: BlockFaceKind,
  localCornerY: number
): { animKind: number; animWeight: number } {
  if (blockId === BlockId.WATER) {
    if (faceKind === 'top') {
      return { animKind: 1.0, animWeight: 1.0 };
    }
    if (faceKind === 'side') {
      return {
        animKind: 1.0,
        animWeight: localCornerY > 0.5 ? 1.0 : 0.0
      };
    }
    return { animKind: 1.0, animWeight: 0.0 };
  }

  if (blockId === BlockId.LEAVES) {
    const clampedY = Math.max(0, Math.min(1, localCornerY));
    return {
      animKind: 2.0,
      animWeight: clampedY
    };
  }

  return { animKind: 0.0, animWeight: 0.0 };
}

function toBufferGeometry(buffers: MeshBuffers): THREE.BufferGeometry | null {
  if (buffers.positions.length === 0 || buffers.indices.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setAttribute('aAnimKind', new THREE.Float32BufferAttribute(buffers.animKinds, 1));
  geometry.setAttribute('aAnimWeight', new THREE.Float32BufferAttribute(buffers.animWeights, 1));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildChunkGeometries(
  cx: number,
  cz: number,
  blocks: Uint8Array,
  worldLookup: WorldBlockLookup
): ChunkGeometries {
  const opaque = createBuffers();
  const transparent = createBuffers();
  const faceColor = new THREE.Color();

  const baseX = cx * CHUNK_SIZE_X;
  const baseZ = cz * CHUNK_SIZE_Z;

  const getLocalOrWorld = (lx: number, wy: number, lz: number): number => {
    if (wy < 0 || wy >= WORLD_HEIGHT) {
      return BlockId.AIR;
    }
    if (lx >= 0 && lx < CHUNK_SIZE_X && lz >= 0 && lz < CHUNK_SIZE_Z) {
      const idx = wy * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;
      return blocks[idx] ?? BlockId.AIR;
    }
    return worldLookup.getBlockAt(baseX + lx, wy, baseZ + lz);
  };

  for (let wy = 0; wy < WORLD_HEIGHT; wy++) {
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const blockId = getLocalOrWorld(lx, wy, lz);
        if (blockId === BlockId.AIR) {
          continue;
        }

        const def = getBlockDefinition(blockId);
        const isTrans = isBlockTransparent(blockId);
        const target = isTrans ? transparent : opaque;
        const tone = blockToneVariation(baseX + lx, wy, baseZ + lz);

        for (const face of FACE_DEFS) {
          const [dx, dy, dz] = face.dir;
          const neighborId = getLocalOrWorld(lx + dx, wy + dy, lz + dz);

          if (neighborId === BlockId.AIR) {
            // render face
          } else if (isTrans) {
            if (neighborId === blockId) {
              continue;
            }
            if (!isBlockTransparent(neighborId) && getBlockDefinition(neighborId).solid) {
              continue;
            }
          } else {
            if (!isBlockTransparent(neighborId) && getBlockDefinition(neighborId).solid) {
              continue;
            }
          }

          const uvRect = getBlockFaceUvRect(blockId, face.faceKind);
          const cornerUvs: ReadonlyArray<[number, number]> = [
            [uvRect.u0, uvRect.v0],
            [uvRect.u1, uvRect.v0],
            [uvRect.u1, uvRect.v1],
            [uvRect.u0, uvRect.v1]
          ];

          const faceHex =
            face.faceKind === 'top'
              ? def.colors.top
              : face.faceKind === 'bottom'
                ? def.colors.bottom
                : def.colors.side;
          faceColor.set(faceHex);

          const baseVertexIndex = target.positions.length / 3;
          const faceAo: number[] = [];

          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c] ?? [0, 0, 0];
            const [cxOff, cyOff, czOff] = corner;
            const wx = baseX + lx + cxOff;
            const wyPos = wy + cyOff;
            const wz = baseZ + lz + czOff;

            target.positions.push(wx, wyPos, wz);
            target.normals.push(dx, dy, dz);

            const uv = cornerUvs[c] ?? [0, 0];
            target.uvs.push(uv[0], uv[1]);

            const aoGroup = face.aoOffsets[c] ?? [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
            const s1Id = getLocalOrWorld(lx + aoGroup[0][0], wy + aoGroup[0][1], lz + aoGroup[0][2]);
            const s2Id = getLocalOrWorld(lx + aoGroup[1][0], wy + aoGroup[1][1], lz + aoGroup[1][2]);
            const crId = getLocalOrWorld(lx + aoGroup[2][0], wy + aoGroup[2][1], lz + aoGroup[2][2]);

            const s1Solid = s1Id !== BlockId.AIR && !isBlockTransparent(s1Id) && getBlockDefinition(s1Id).solid;
            const s2Solid = s2Id !== BlockId.AIR && !isBlockTransparent(s2Id) && getBlockDefinition(s2Id).solid;
            const crSolid = crId !== BlockId.AIR && !isBlockTransparent(crId) && getBlockDefinition(crId).solid;

            const ao = isTrans ? 1.0 : vertexAoFactor(s1Solid, s2Solid, crSolid);
            faceAo.push(ao);

            const shade = ao * tone;
            target.colors.push(faceColor.r * shade, faceColor.g * shade, faceColor.b * shade);

            const animMeta = computeVertexAnimKindAndWeight(blockId, face.faceKind, cyOff);
            target.animKinds.push(animMeta.animKind);
            target.animWeights.push(animMeta.animWeight);
          }

          const ao0 = faceAo[0] ?? 1;
          const ao1 = faceAo[1] ?? 1;
          const ao2 = faceAo[2] ?? 1;
          const ao3 = faceAo[3] ?? 1;

          if (ao0 + ao2 >= ao1 + ao3) {
            target.indices.push(
              baseVertexIndex,
              baseVertexIndex + 1,
              baseVertexIndex + 2,
              baseVertexIndex,
              baseVertexIndex + 2,
              baseVertexIndex + 3
            );
          } else {
            target.indices.push(
              baseVertexIndex + 1,
              baseVertexIndex + 2,
              baseVertexIndex + 3,
              baseVertexIndex + 1,
              baseVertexIndex + 3,
              baseVertexIndex
            );
          }
        }
      }
    }
  }

  return {
    opaqueGeometry: toBufferGeometry(opaque),
    transparentGeometry: toBufferGeometry(transparent)
  };
}
