import * as THREE from 'three';
import { BlockId, getBlockDefinition, isBlockOpaque, isPlantBlock } from '../core/types.js';
import { Chunk, CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from './chunk.js';
import { BlockFaceKind, getBlockFaceUvRect, UvRect } from './blockTextureAtlas.js';

interface FaceSpec {
  dir: [number, number, number];
  faceKind: BlockFaceKind;
  // Ordem anti-horária (CCW) vista de fora da face para normais e winding corretos
  corners: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ];
}

const CUBE_FACES: FaceSpec[] = [
  {
    dir: [0, 1, 0],
    faceKind: 'top',
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
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0]
    ]
  }
];

function pushFaceQuad(
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
  indices: number[],
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  corners: FaceSpec['corners'],
  uv: UvRect,
  color: THREE.Color
): void {
  const baseVertex = positions.length / 3;
  // Mapeia (0,1,2,3) dos cantos para (u0,v0), (u1,v0), (u1,v1), (u0,v1)
  const faceUvs: [number, number][] = [
    [uv.u0, uv.v0],
    [uv.u1, uv.v0],
    [uv.u1, uv.v1],
    [uv.u0, uv.v1]
  ];

  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    positions.push(x + c[0], y + c[1], z + c[2]);
    normals.push(nx, ny, nz);
    colors.push(color.r, color.g, color.b);
    uvs.push(faceUvs[i][0], faceUvs[i][1]);
  }

  indices.push(baseVertex, baseVertex + 1, baseVertex + 2);
  indices.push(baseVertex, baseVertex + 2, baseVertex + 3);
}

function pushCrossPlantGeometry(
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
  indices: number[],
  x: number,
  y: number,
  z: number,
  uv: UvRect,
  color: THREE.Color
): void {
  const diagonals: [[number, number], [number, number]][] = [
    [
      [0.15, 0.15],
      [0.85, 0.85]
    ],
    [
      [0.85, 0.15],
      [0.15, 0.85]
    ]
  ];

  for (const [[x0, z0], [x1, z1]] of diagonals) {
    const baseVertex = positions.length / 3;
    const dx = z1 - z0;
    const dz = -(x1 - x0);
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;

    const quadVerts: [number, number, number, number, number][] = [
      [x + x0, y, z + z0, uv.u0, uv.v0],
      [x + x1, y, z + z1, uv.u1, uv.v0],
      [x + x1, y + 0.9, z + z1, uv.u1, uv.v1],
      [x + x0, y + 0.9, z + z0, uv.u0, uv.v1]
    ];

    for (const [vx, vy, vz, vu, vv] of quadVerts) {
      positions.push(vx, vy, vz);
      normals.push(nx, 0.2, nz);
      colors.push(color.r, color.g, color.b);
      uvs.push(vu, vv);
    }

    indices.push(baseVertex, baseVertex + 1, baseVertex + 2);
    indices.push(baseVertex, baseVertex + 2, baseVertex + 3);
  }
}

export function buildChunkGeometry(
  chunk: Chunk,
  getBlockWorld: (wx: number, wy: number, wz: number) => number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const worldOriginX = chunk.cx * CHUNK_SIZE_X;
  const worldOriginZ = chunk.cz * CHUNK_SIZE_Z;
  const tempColor = new THREE.Color();

  for (let y = 0; y < CHUNK_SIZE_Y; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      const wz = worldOriginZ + z;
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const blockId = chunk.getBlock(x, y, z);
        if (blockId === BlockId.AIR) {
          continue;
        }

        const wx = worldOriginX + x;
        const def = getBlockDefinition(blockId);

        if (isPlantBlock(blockId)) {
          const uv = getBlockFaceUvRect(blockId, 'top');
          tempColor.set(def.colors.top);
          pushCrossPlantGeometry(positions, normals, colors, uvs, indices, wx, y, wz, uv, tempColor);
          continue;
        }

        for (const face of CUBE_FACES) {
          const [nx, ny, nz] = face.dir;
          const neighborId = getBlockWorld(wx + nx, y + ny, wz + nz);

          if (blockId === BlockId.WATER || blockId === BlockId.GLASS || blockId === BlockId.LEAVES) {
            if (neighborId === blockId || isBlockOpaque(neighborId)) {
              continue;
            }
          } else if (isBlockOpaque(neighborId)) {
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

          // Variação leve e determinística por coordenada mundial reduz repetição visual
          const hash = Math.abs(Math.sin(wx * 12.9898 + y * 78.233 + wz * 37.719));
          const tonalScale = 0.95 + (hash % 0.1);
          tempColor.multiplyScalar(tonalScale);

          pushFaceQuad(
            positions,
            normals,
            colors,
            uvs,
            indices,
            wx,
            y,
            wz,
            nx,
            ny,
            nz,
            face.corners,
            uv,
            tempColor
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
