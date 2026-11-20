import * as THREE from 'three';
import {
  GRAPHICS_QUALITY_PRESETS,
  GameSettings,
  QualityModePreset
} from '../core/gameState.js';
import { TargetBlockHit } from '../building/blockInteraction.js';
import { createProceduralVoxelTextures, ProceduralTextureSet } from './proceduralTextures.js';
import { createAtmosphereRig, AtmosphereRig } from './atmosphere.js';

const SKY_HORIZON_COLOR = 0xc8e4f8;

export class GameEngine {
  public readonly canvas: HTMLCanvasElement;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly textures: ProceduralTextureSet;

  // Materiais PBR separados por classe física de superfície
  public readonly opaqueMaterial: THREE.MeshStandardMaterial;
  public readonly foliageMaterial: THREE.MeshStandardMaterial;
  public readonly glassMaterial: THREE.MeshPhysicalMaterial;
  public readonly waterMaterial: THREE.MeshPhysicalMaterial;

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly fog: THREE.FogExp2;
  private readonly selectionBox: THREE.LineSegments;
  private readonly atmosphere: AtmosphereRig;
  private activePreset: QualityModePreset;

  constructor(canvas: HTMLCanvasElement, initialSettings: GameSettings, textureSeed = 1337) {
    this.canvas = canvas;
    this.activePreset = GRAPHICS_QUALITY_PRESETS[initialSettings.qualityMode ?? 'balanced'];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = initialSettings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_HORIZON_COLOR);

    this.fog = new THREE.FogExp2(SKY_HORIZON_COLOR, initialSettings.fog ? 0.0115 : 0);
    this.scene.fog = this.fog;

    const width = window.innerWidth || 800;
    const height = window.innerHeight || 600;
    this.camera = new THREE.PerspectiveCamera(initialSettings.fov, width / height, 0.1, 240);

    // Iluminação indireta e solar fisicamente plausível
    this.hemiLight = new THREE.HemisphereLight(0xd9eeff, 0x495b38, 0.92);
    this.scene.add(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight(0xe6f0fa, 0.18);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xfff4d6, 2.25);
    this.dirLight.position.set(42, 72, 32);
    this.dirLight.castShadow = initialSettings.shadows;
    this.dirLight.shadow.mapSize.width = this.activePreset.shadowMapSize;
    this.dirLight.shadow.mapSize.height = this.activePreset.shadowMapSize;
    this.dirLight.shadow.bias = -0.00045;
    this.dirLight.shadow.normalBias = 0.032;
    this.dirLight.shadow.camera.near = 6;
    this.dirLight.shadow.camera.far = 210;
    const frustumRadius = 46;
    this.dirLight.shadow.camera.left = -frustumRadius;
    this.dirLight.shadow.camera.right = frustumRadius;
    this.dirLight.shadow.camera.top = frustumRadius;
    this.dirLight.shadow.camera.bottom = -frustumRadius;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.textures = createProceduralVoxelTextures(textureSeed);

    // 1. Blocos sólidos opacos (terra, pedra, grama, madeira, tábuas, areia, pedregulho)
    this.opaqueMaterial = new THREE.MeshStandardMaterial({
      map: this.textures.map,
      roughnessMap: this.textures.roughnessMap,
      normalMap: this.textures.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.04
    });

    // 2. Folhagem e plantas com alpha test definido (evita transparência plástica genérica)
    this.foliageMaterial = new THREE.MeshStandardMaterial({
      map: this.textures.map,
      alphaMap: this.textures.alphaMap,
      roughnessMap: this.textures.roughnessMap,
      vertexColors: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.76,
      metalness: 0.0
    });

    // 3. Vidro com reflexão física e transparência controlada
    this.glassMaterial = new THREE.MeshPhysicalMaterial({
      map: this.textures.map,
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      roughness: 0.08,
      metalness: 0.05,
      reflectivity: 0.9,
      ior: 1.52,
      depthWrite: false
    });

    // 4. Água com resposta especular, Fresnel/reflexo e transparência natural
    this.waterMaterial = new THREE.MeshPhysicalMaterial({
      map: this.textures.map,
      vertexColors: true,
      transparent: true,
      opacity: 0.76,
      roughness: 0.14,
      metalness: 0.12,
      reflectivity: 0.88,
      ior: 1.333,
      clearcoat: 0.45,
      clearcoatRoughness: 0.18,
      depthWrite: false
    });

    this.atmosphere = createAtmosphereRig(this.scene);

    const boxGeom = new THREE.BoxGeometry(1.008, 1.008, 1.008);
    const edgesGeom = new THREE.EdgesGeometry(boxGeom);
    boxGeom.dispose();
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x0f172a });
    this.selectionBox = new THREE.LineSegments(edgesGeom, edgesMat);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    this.applySettings(initialSettings);
  }

  getActivePreset(): QualityModePreset {
    return this.activePreset;
  }

  applySettings(settings: GameSettings): void {
    const preset = GRAPHICS_QUALITY_PRESETS[settings.qualityMode ?? 'balanced'];
    this.activePreset = preset;

    const dpr = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth || 800, window.innerHeight || 600, false);

    this.camera.fov = settings.fov;
    this.camera.far = Math.max(180, settings.renderDistance * 36 + 60);
    this.camera.updateProjectionMatrix();

    const fogDensity = settings.fog
      ? settings.qualityMode === 'ultra'
        ? 0.0085
        : settings.qualityMode === 'performance'
          ? 0.016
          : 0.0115
      : 0;
    this.fog.density = fogDensity;

    const shadowsEnabled = Boolean(settings.shadows && preset.shadows);
    this.renderer.shadowMap.enabled = shadowsEnabled;
    this.dirLight.castShadow = shadowsEnabled;

    if (this.dirLight.shadow.mapSize.width !== preset.shadowMapSize) {
      this.dirLight.shadow.mapSize.width = preset.shadowMapSize;
      this.dirLight.shadow.mapSize.height = preset.shadowMapSize;
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        this.dirLight.shadow.map = null;
      }
    }

    this.renderer.shadowMap.needsUpdate = true;
  }

  updateTargetHighlight(target: TargetBlockHit | null): void {
    if (!target) {
      this.selectionBox.visible = false;
      return;
    }
    this.selectionBox.visible = true;
    this.selectionBox.position.set(
      target.blockPos.x + 0.5,
      target.blockPos.y + 0.5,
      target.blockPos.z + 0.5
    );
  }

  syncSunAndAtmosphere(playerX: number, playerZ: number, elapsedSec: number, fogEnabled: boolean): void {
    this.dirLight.position.set(playerX + 38, 72, playerZ + 28);
    this.dirLight.target.position.set(playerX, 12, playerZ);
    this.dirLight.target.updateMatrixWorld();

    this.atmosphere.update(
      elapsedSec,
      playerX,
      playerZ,
      this.activePreset.skyAtmosphere && fogEnabled
    );
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const dpr = Math.min(window.devicePixelRatio || 1, this.activePreset.pixelRatioCap);
    this.renderer.setPixelRatio(dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.atmosphere.dispose();
    this.opaqueMaterial.dispose();
    this.foliageMaterial.dispose();
    this.glassMaterial.dispose();
    this.waterMaterial.dispose();
    this.textures.dispose();
    this.selectionBox.geometry.dispose();
    (this.selectionBox.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
