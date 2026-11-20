import * as THREE from 'three';
import {
  BlockId,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  WORLD_HEIGHT,
  getBlockDefinition,
  isBlockSolid,
  isBlockTransparent
} from '../core/types.js';

interface FaceSpec {
  dir: [number, number, number];
  corners: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ];
  faceKey: 'top' | 'side' | 'bottom';
  shade: number;
  tangentAxes: [number, number];
}

const FACES: FaceSpec[] = [
  // +X (Direita)
  {
    dir: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1]
    ],
    faceKey: 'side',
    shade: 0.86,
    tangentAxes: [1, 2]
  },
  // -X (Esquerda)
  {
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0]
    ],
    faceKey: 'side',
    shade: 0.82,
    tangentAxes: [1, 2]
  },
  // +Y (Topo)
  {
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ],
    faceKey: 'top',
    shade: 1.0,
    tangentAxes: [0, 2]
  },
  // -Y (Baixo)
  {
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ],
    faceKey: 'bottom',
    shade: 0.65,
    tangentAxes: [0, 2]
  },
  // +Z (Frente)
  {
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ],
    faceKey: 'side',
    shade: 0.92,
    tangentAxes: [0, 1]
  },
  // -Z (Trás)
  {
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0]
    ],
    faceKey: 'side',
    shade: 0.78,
    tangentAxes: [0, 1]
  }
];

export interface BlockLookup {
  getBlockAt(wx: number, wy: number, wz: number): number;
}

export interface BuiltChunkGeometries {
  opaqueGeometry: THREE.BufferGeometry | null;
  transparentGeometry: THREE.BufferGeometry | null;
}

interface MeshAccumulator {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

function createAccumulator(): MeshAccumulator {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function toBufferGeometry(acc: MeshAccumulator): THREE.BufferGeometry | null {
  if (acc.positions.length === 0 || acc.indices.length === 0) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(acc.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(acc.colors, 3));
  geometry.setIndex(acc.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const colorCache = new Map<string, THREE.Color>();
function getShadedColor(hex: string, shade: number): THREE.Color {
  const key = `${hex}_${shade.toFixed(2)}`;
  let cached = colorCache.get(key);
  if (!cached) {
    cached = new THREE.Color(hex).multiplyScalar(shade);
    colorCache.set(key, cached);
  }
  return cached;
}

function calculateVertexAo(
  wx: number,
  y: number,
  wz: number,
  face: FaceSpec,
  corner: [number, number, number],
  worldLookup: BlockLookup
): number {
  const [uAxis, vAxis] = face.tangentAxes;
  const uSign = corner[uAxis] === 0 ? -1 : 1;
  const vSign = corner[vAxis] === 0 ? -1 : 1;
  const faceX = wx + face.dir[0];
  const faceY = y + face.dir[1];
  const faceZ = wz + face.dir[2];

  const side1 = worldLookup.getBlockAt(
    faceX + (uAxis === 0 ? uSign : 0),
    faceY + (uAxis === 1 ? uSign : 0),
    faceZ + (uAxis === 2 ? uSign : 0)
  );
  const side2 = worldLookup.getBlockAt(
    faceX + (vAxis === 0 ? vSign : 0),
    faceY + (vAxis === 1 ? vSign : 0),
    faceZ + (vAxis === 2 ? vSign : 0)
  );
  const cornerBlock = worldLookup.getBlockAt(
    faceX + (uAxis === 0 ? uSign : 0) + (vAxis === 0 ? vSign : 0),
    faceY + (uAxis === 1 ? uSign : 0) + (vAxis === 1 ? vSign : 0),
    faceZ + (uAxis === 2 ? uSign : 0) + (vAxis === 2 ? vSign : 0)
  );

  const side1Occludes = isBlockSolid(side1);
  const side2Occludes = isBlockSolid(side2);
  const cornerOccludes = isBlockSolid(cornerBlock);

  // Duas laterais sólidas fecham a quina e produzem a sombra mais forte.
  if (side1Occludes && side2Occludes) return 0.58;
  const occluderCount =
    Number(side1Occludes) + Number(side2Occludes) + Number(cornerOccludes);
  return 1 - occluderCount * 0.13;
}

export function buildChunkGeometries(
  cx: number,
  cz: number,
  blocks: Uint8Array,
  worldLookup: BlockLookup
): BuiltChunkGeometries {
  const opaque = createAccumulator();
  const transparent = createAccumulator();

  const baseX = cx * CHUNK_SIZE_X;
  const baseZ = cz * CHUNK_SIZE_Z;
  const vertexColor = new THREE.Color();

  const localIndex = (lx: number, y: number, lz: number): number =>
    y * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const blockId = blocks[localIndex(lx, y, lz)];
        if (blockId === BlockId.AIR) {
          continue;
        }

        const def = getBlockDefinition(blockId);
        const isTrans = isBlockTransparent(blockId);
        const target = isTrans ? transparent : opaque;

        const wx = baseX + lx;
        const wz = baseZ + lz;
        const heightOffset = blockId === BlockId.WATER ? -0.14 : 0;

        for (const face of FACES) {
          const nx = wx + face.dir[0];
          const ny = y + face.dir[1];
          const nz = wz + face.dir[2];

          const neighborId = worldLookup.getBlockAt(nx, ny, nz);

          // Culling de faces ocultas:
          // - Bloco opaco esconde face adjacente de qualquer bloco
          // - Bloco transparente esconde face adjacente de mesmo tipo ou de bloco opaco
          if (neighborId !== BlockId.AIR) {
            if (!isTrans && !isBlockTransparent(neighborId)) {
              continue;
            }
            if (isTrans && neighborId === blockId) {
              continue;
            }
            if (isTrans && !isBlockTransparent(neighborId)) {
              continue;
            }
          }

          const baseVertexIndex = target.positions.length / 3;
          const hexColor = def.colors[face.faceKey];
          const col = getShadedColor(hexColor, face.shade);

          for (const corner of face.corners) {
            const py =
              corner[1] === 1 && blockId === BlockId.WATER
                ? y + 1 + heightOffset
                : y + corner[1];
            target.positions.push(wx + corner[0], py, wz + corner[2]);
            target.normals.push(face.dir[0], face.dir[1], face.dir[2]);

            const ao = calculateVertexAo(wx, y, wz, face, corner, worldLookup);
            vertexColor.copy(col).multiplyScalar(ao);
            target.colors.push(vertexColor.r, vertexColor.g, vertexColor.b);
          }

          target.indices.push(
            baseVertexIndex,
            baseVertexIndex + 1,
            baseVertexIndex + 2,
            baseVertexIndex,
            baseVertexIndex + 2,
            baseVertexIndex + 3
          );
        }
      }
    }
  }

  return {
    opaqueGeometry: toBufferGeometry(opaque),
    transparentGeometry: toBufferGeometry(transparent)
  };
}
