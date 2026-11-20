import * as THREE from 'three';
import { BlockId, getBlockDefinition, isBlockOpaque, isPlantBlock } from '../core/types.js';
import { Chunk, CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from './chunk.js';
import { getAtlasUvRect } from '../engine/proceduralTextures.js';

export interface ChunkMeshData {
  opaqueMesh: THREE.Mesh | null;
  foliageMesh: THREE.Mesh | null;
  glassMesh: THREE.Mesh | null;
  waterMesh: THREE.Mesh | null;
  dispose: () => void;
}

interface FaceDefinition {
  dir: [number, number, number];
  faceKey: 'top' | 'side' | 'bottom';
  aoStrengthFactor: number;
  corners: Array<[number, number, number]>;
}

const FACES: FaceDefinition[] = [
  {
    dir: [0, 1, 0],
    faceKey: 'top',
    aoStrengthFactor: 0.72,
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ]
  },
  {
    dir: [0, -1, 0],
    faceKey: 'bottom',
    aoStrengthFactor: 1.0,
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ]
  },
  {
    dir: [1, 0, 0],
    faceKey: 'side',
    aoStrengthFactor: 0.92,
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1]
    ]
  },
  {
    dir: [-1, 0, 0],
    faceKey: 'side',
    aoStrengthFactor: 0.92,
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0]
    ]
  },
  {
    dir: [0, 0, 1],
    faceKey: 'side',
    aoStrengthFactor: 0.92,
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ]
  },
  {
    dir: [0, 0, -1],
    faceKey: 'side',
    aoStrengthFactor: 0.92,
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0]
    ]
  }
];

interface GeometryBucket {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

function createBucket(): GeometryBucket {
  return {
    positions: [],
    normals: [],
    colors: [],
    uvs: [],
    indices: []
  };
}

function computeCornerAo(
  isOccludingAt: (x: number, y: number, z: number) => boolean,
  nx: number,
  ny: number,
  nz: number,
  corner: [number, number, number],
  aoStrength: number
): number {
  // Ponto base adjacente à face no plano da vizinhança
  const bx = corner[0] > 0.5 ? 1 : -1;
  const by = corner[1] > 0.5 ? 1 : -1;
  const bz = corner[2] > 0.5 ? 1 : -1;

  let side1 = false;
  let side2 = false;
  let cornerBlock = false;

  if (ny !== 0) {
    side1 = isOccludingAt(bx, ny, 0);
    side2 = isOccludingAt(0, ny, bz);
    cornerBlock = isOccludingAt(bx, ny, bz);
  } else if (nx !== 0) {
    side1 = isOccludingAt(nx, by, 0);
    side2 = isOccludingAt(nx, 0, bz);
    cornerBlock = isOccludingAt(nx, by, bz);
  } else {
    side1 = isOccludingAt(bx, 0, nz);
    side2 = isOccludingAt(0, by, nz);
    cornerBlock = isOccludingAt(bx, by, nz);
  }

  const occlusionCount = side1 && side2 ? 3 : (side1 ? 1 : 0) + (side2 ? 1 : 0) + (cornerBlock ? 1 : 0);
  const factor = 1.0 - (occlusionCount / 3.0) * aoStrength;
  return Math.max(0.28, Math.min(1.0, factor));
}

function pushQuad(
  bucket: GeometryBucket,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  corners: Array<[number, number, number]>,
  uvRect: { u0: number; v0: number; u1: number; v1: number },
  baseColor: THREE.Color,
  cornerAo: [number, number, number, number],
  yOffset = 0
): void {
  const baseVertex = bucket.positions.length / 3;
  const uvCoords: Array<[number, number]> = [
    [uvRect.u0, uvRect.v0],
    [uvRect.u1, uvRect.v0],
    [uvRect.u1, uvRect.v1],
    [uvRect.u0, uvRect.v1]
  ];

  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const ao = cornerAo[i];
    bucket.positions.push(x + c[0], y + c[1] + yOffset, z + c[2]);
    bucket.normals.push(nx, ny, nz);
    bucket.colors.push(
      Math.min(1, baseColor.r * ao),
      Math.min(1, baseColor.g * ao),
      Math.min(1, baseColor.b * ao)
    );
    bucket.uvs.push(uvCoords[i][0], uvCoords[i][1]);
  }

  // Flip diagonal quando AO favorece suavidade para evitar artefatos de triangulação
  if (cornerAo[0] + cornerAo[2] > cornerAo[1] + cornerAo[3]) {
    bucket.indices.push(baseVertex, baseVertex + 1, baseVertex + 2);
    bucket.indices.push(baseVertex, baseVertex + 2, baseVertex + 3);
  } else {
    bucket.indices.push(baseVertex + 1, baseVertex + 2, baseVertex + 3);
    bucket.indices.push(baseVertex + 1, baseVertex + 3, baseVertex);
  }
}

function pushCrossPlant(
  bucket: GeometryBucket,
  x: number,
  y: number,
  z: number,
  uvRect: { u0: number; v0: number; u1: number; v1: number },
  baseColor: THREE.Color,
  aoFactor: number
): void {
  const planes: Array<[[number, number], [number, number]]> = [
    [
      [0.14, 0.14],
      [0.86, 0.86]
    ],
    [
      [0.86, 0.14],
      [0.14, 0.86]
    ]
  ];

  for (const [[x0, z0], [x1, z1]] of planes) {
    const baseVertex = bucket.positions.length / 3;
    const dx = z1 - z0;
    const dz = -(x1 - x0);
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;

    const verts: Array<[number, number, number, number, number]> = [
      [x + x0, y, z + z0, uvRect.u0, uvRect.v0],
      [x + x1, y, z + z1, uvRect.u1, uvRect.v0],
      [x + x1, y + 0.92, z + z1, uvRect.u1, uvRect.v1],
      [x + x0, y + 0.92, z + z0, uvRect.u0, uvRect.v1]
    ];

    for (let i = 0; i < 4; i++) {
      const v = verts[i];
      const heightShade = i >= 2 ? 1.05 : Math.max(0.45, aoFactor);
      bucket.positions.push(v[0], v[1], v[2]);
      bucket.normals.push(nx, 0.25, nz);
      bucket.colors.push(
        Math.min(1, baseColor.r * heightShade),
        Math.min(1, baseColor.g * heightShade),
        Math.min(1, baseColor.b * heightShade)
      );
      bucket.uvs.push(v[3], v[4]);
    }

    bucket.indices.push(baseVertex, baseVertex + 1, baseVertex + 2);
    bucket.indices.push(baseVertex, baseVertex + 2, baseVertex + 3);
  }
}

function buildGeometryFromBucket(bucket: GeometryBucket): THREE.BufferGeometry | null {
  if (bucket.indices.length === 0) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
  geometry.setIndex(bucket.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildChunkMesh(
  chunk: Chunk,
  getBlockWorld: (wx: number, wy: number, wz: number) => number,
  materials: {
    opaqueMaterial: THREE.Material;
    foliageMaterial: THREE.Material;
    glassMaterial: THREE.Material;
    waterMaterial: THREE.Material;
  },
  options?: {
    aoStrength?: number;
    castShadow?: boolean;
    receiveShadow?: boolean;
  }
): ChunkMeshData {
  const aoStrength = options?.aoStrength ?? 0.55;
  const castShadow = options?.castShadow ?? true;
  const receiveShadow = options?.receiveShadow ?? true;

  const opaqueBucket = createBucket();
  const foliageBucket = createBucket();
  const glassBucket = createBucket();
  const waterBucket = createBucket();

  const worldBaseX = chunk.cx * CHUNK_SIZE_X;
  const worldBaseZ = chunk.cz * CHUNK_SIZE_Z;
  const tempColor = new THREE.Color();

  for (let y = 0; y < CHUNK_SIZE_Y; y++) {
    const wy = y;
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      const wz = worldBaseZ + z;
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const blockId = chunk.getBlock(x, y, z);
        if (blockId === BlockId.AIR) {
          continue;
        }

        const wx = worldBaseX + x;
        const def = getBlockDefinition(blockId);

        if (isPlantBlock(blockId)) {
          const uvRect = getAtlasUvRect(blockId, 'top');
          tempColor.set(def.colors.top);
          const belowSolid = isBlockOpaque(getBlockWorld(wx, wy - 1, wz));
          const plantAo = belowSolid ? 1.0 - aoStrength * 0.25 : 1.0;
          pushCrossPlant(foliageBucket, wx, wy, wz, uvRect, tempColor, plantAo);
          continue;
        }

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const nwx = wx + dx;
          const nwy = wy + dy;
          const nwz = wz + dz;
          const neighborId = getBlockWorld(nwx, nwy, nwz);

          if (blockId === BlockId.WATER) {
            if (neighborId === BlockId.WATER || isBlockOpaque(neighborId)) {
              continue;
            }
          } else if (blockId === BlockId.GLASS) {
            if (neighborId === BlockId.GLASS || isBlockOpaque(neighborId)) {
              continue;
            }
          } else if (blockId === BlockId.LEAVES) {
            if (isBlockOpaque(neighborId)) {
              continue;
            }
          } else {
            if (isBlockOpaque(neighborId)) {
              continue;
            }
          }

          const uvRect = getAtlasUvRect(blockId, face.faceKey);
          const hexColor =
            face.faceKey === 'top'
              ? def.colors.top
              : face.faceKey === 'bottom'
                ? def.colors.bottom
                : def.colors.side;
          tempColor.set(hexColor);

          // Micro-variação determinística por coordenada mundial
          const hash = Math.abs(Math.sin(wx * 12.9898 + wy * 78.233 + wz * 37.719 + face.faceKey.length * 19.13));
          const tonalJitter = 0.94 + (hash % 0.12);
          tempColor.multiplyScalar(tonalJitter);

          const effectiveAoStrength = aoStrength * face.aoStrengthFactor;
          const cornerAo: [number, number, number, number] = [1, 1, 1, 1];

          if (blockId !== BlockId.WATER && blockId !== BlockId.GLASS) {
            const isOccluding = (ox: number, oy: number, oz: number): boolean =>
              isBlockOpaque(getBlockWorld(nwx + ox, nwy + oy, nwz + oz));

            for (let c = 0; c < 4; c++) {
              cornerAo[c] = computeCornerAo(
                isOccluding,
                dx,
                dy,
                dz,
                face.corners[c],
                effectiveAoStrength
              );
            }
          }

          if (blockId === BlockId.WATER) {
            const waterDrop = face.faceKey === 'top' ? -0.11 : 0;
            pushQuad(waterBucket, wx, wy, wz, dx, dy, dz, face.corners, uvRect, tempColor, cornerAo, waterDrop);
          } else if (blockId === BlockId.GLASS) {
            pushQuad(glassBucket, wx, wy, wz, dx, dy, dz, face.corners, uvRect, tempColor, cornerAo);
          } else if (blockId === BlockId.LEAVES) {
            pushQuad(foliageBucket, wx, wy, wz, dx, dy, dz, face.corners, uvRect, tempColor, cornerAo);
          } else {
            pushQuad(opaqueBucket, wx, wy, wz, dx, dy, dz, face.corners, uvRect, tempColor, cornerAo);
          }
        }
      }
    }
  }

  const opaqueGeo = buildGeometryFromBucket(opaqueBucket);
  const foliageGeo = buildGeometryFromBucket(foliageBucket);
  const glassGeo = buildGeometryFromBucket(glassBucket);
  const waterGeo = buildGeometryFromBucket(waterBucket);

  const opaqueMesh = opaqueGeo ? new THREE.Mesh(opaqueGeo, materials.opaqueMaterial) : null;
  if (opaqueMesh) {
    opaqueMesh.castShadow = castShadow;
    opaqueMesh.receiveShadow = receiveShadow;
  }

  const foliageMesh = foliageGeo ? new THREE.Mesh(foliageGeo, materials.foliageMaterial) : null;
  if (foliageMesh) {
    foliageMesh.castShadow = castShadow;
    foliageMesh.receiveShadow = receiveShadow;
  }

  const glassMesh = glassGeo ? new THREE.Mesh(glassGeo, materials.glassMaterial) : null;
  if (glassMesh) {
    glassMesh.castShadow = false;
    glassMesh.receiveShadow = false;
    glassMesh.renderOrder = 2;
  }

  const waterMesh = waterGeo ? new THREE.Mesh(waterGeo, materials.waterMaterial) : null;
  if (waterMesh) {
    waterMesh.castShadow = false;
    waterMesh.receiveShadow = receiveShadow;
    waterMesh.renderOrder = 3;
  }

  return {
    opaqueMesh,
    foliageMesh,
    glassMesh,
    waterMesh,
    dispose: () => {
      opaqueGeo?.dispose();
      foliageGeo?.dispose();
      glassGeo?.dispose();
      waterGeo?.dispose();
    }
  };
}
