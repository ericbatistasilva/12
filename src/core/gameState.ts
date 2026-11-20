export type GraphicsQualityMode = 'performance' | 'balanced' | 'ultra';

export interface QualityModePreset {
  mode: GraphicsQualityMode;
  label: string;
  renderDistance: number;
  shadowMapSize: number;
  pixelRatioCap: number;
  shadows: boolean;
  fog: boolean;
  aoStrength: number;
  waterAnimated: boolean;
  foliageWind: boolean;
  skyAtmosphere: boolean;
}

export const GRAPHICS_QUALITY_PRESETS: Record<GraphicsQualityMode, QualityModePreset> = {
  performance: {
    mode: 'performance',
    label: 'Performance',
    renderDistance: 2,
    shadowMapSize: 512,
    pixelRatioCap: 1.0,
    shadows: false,
    fog: true,
    aoStrength: 0.35,
    waterAnimated: false,
    foliageWind: false,
    skyAtmosphere: false
  },
  balanced: {
    mode: 'balanced',
    label: 'Balanced',
    renderDistance: 4,
    shadowMapSize: 1024,
    pixelRatioCap: 1.5,
    shadows: true,
    fog: true,
    aoStrength: 0.52,
    waterAnimated: true,
    foliageWind: true,
    skyAtmosphere: true
  },
  ultra: {
    mode: 'ultra',
    label: 'Ultra',
    renderDistance: 6,
    shadowMapSize: 2048,
    pixelRatioCap: 2.0,
    shadows: true,
    fog: true,
    aoStrength: 0.65,
    waterAnimated: true,
    foliageWind: true,
    skyAtmosphere: true
  }
};

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
  qualityMode: GraphicsQualityMode;
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

export function detectRecommendedQualityMode(): GraphicsQualityMode {
  if (typeof navigator === 'undefined') {
    return 'balanced';
  }
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores <= 2 || mem <= 2) {
    return 'performance';
  }
  if (cores >= 8 && mem >= 8) {
    return 'ultra';
  }
  return 'balanced';
}

export function createSettingsForMode(
  mode: GraphicsQualityMode,
  base?: Partial<GameSettings>
): GameSettings {
  const preset = GRAPHICS_QUALITY_PRESETS[mode];
  return {
    qualityMode: mode,
    renderDistance: preset.renderDistance,
    fov: base?.fov ?? 75,
    mouseSensitivity: base?.mouseSensitivity ?? 1.0,
    shadows: preset.shadows,
    fog: preset.fog,
    sfxVolume: base?.sfxVolume ?? 0.6,
    muted: base?.muted ?? false
  };
}

export const DEFAULT_GAME_SETTINGS: GameSettings = createSettingsForMode('balanced');
