export interface PlayerPosition {
  x: number;
  y: number;
  z: number;
}

export interface PlayerVelocity {
  x: number;
  y: number;
  z: number;
}

export interface GameSettings {
  renderDistance: number;
  fov: number;
  mouseSensitivity: number;
  shadows: boolean;
  fog: boolean;
  sfxVolume: number;
  muted: boolean;
}

export interface InventorySlot {
  blockId: number;
  count: number;
}

export interface WorldMetadata {
  id: string;
  name: string;
  seed: string;
  createdAt: string;
  updatedAt: string;
  playerPosition: PlayerPosition;
  yaw: number;
  pitch: number;
}

export interface SerializedChunk {
  cx: number;
  cz: number;
  blocks: number[];
}

export interface SavedWorldData {
  version: number;
  meta: WorldMetadata;
  inventory: InventorySlot[];
  hotbarBlockIds: number[];
  selectedHotbarIndex: number;
  modifiedChunks: SerializedChunk[];
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  renderDistance: 3,
  fov: 75,
  mouseSensitivity: 1.0,
  shadows: true,
  fog: true,
  sfxVolume: 0.6,
  muted: false
};
