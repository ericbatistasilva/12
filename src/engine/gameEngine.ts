import * as THREE from 'three';
import { GameSettings } from '../core/gameState.js';
import { TargetBlockHit } from '../building/blockInteraction.js';
import { BlockAtlasResources, createBlockTextureAtlas } from '../world/blockTextureAtlas.js';
import {
  QualityPreset,
  QualityProfile,
  SkyDomeRig,
  applyAnimatedMaterialShader,
  createAtmosphericSkyDome,
  getQualityProfile,
  normalizeQualityPreset
} from './visualPipeline.js';

export class GameEngine {
  public readonly canvas: HTMLCanvasElement;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly atlas: BlockAtlasResources;
  public readonly opaqueMaterial: THREE.MeshStandardMaterial;
  public readonly transparentMaterial: THREE.MeshStandardMaterial;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly fog: THREE.FogExp2;
  private readonly selectionBox: THREE.LineSegments;
  private readonly skyDome: SkyDomeRig;
  private readonly uTime = { value: 0 };
  private readonly uWaterAmp = { value: 0.03 };
  private readonly uWaterSpeed = { value: 1.75 };
  private readonly uFoliageAmp = { value: 0.015 };
  private readonly uFoliageSpeed = { value: 1.45 };
  private activeQuality: QualityPreset = 'balanced';

  constructor(canvas: HTMLCanvasElement, initialSettings: GameSettings, atlasSeed = 1337) {
    this.canvas = canvas;
    const rawQuality = (initialSettings as GameSettings & { quality?: string }).quality;
    this.activeQuality = normalizeQualityPreset(rawQuality);
    const profile = getQualityProfile(this.activeQuality);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = profile.toneMappingExposure;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatioCap));
    this.renderer.setSize(window.innerWidth || 800, window.innerHeight || 600, false);
    this.renderer.shadowMap.enabled = profile.shadowEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(profile.skyHorizonColor);

    this.fog = new THREE.FogExp2(profile.skyHorizonColor, profile.fogEnabled ? profile.fogDensity : 0);
    this.scene.fog = this.fog;

    const width = window.innerWidth || 800;
    const height = window.innerHeight || 600;
    this.camera = new THREE.PerspectiveCamera(initialSettings.fov, width / height, 0.1, 180);

    this.skyDome = createAtmosphericSkyDome(profile);
    this.scene.add(this.skyDome.mesh);

    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x4b5563, profile.hemiIntensity);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffbeb, profile.dirLightIntensity);
    this.dirLight.position.set(28, 46, 22);
    this.dirLight.castShadow = profile.shadowEnabled;
    this.dirLight.shadow.mapSize.width = profile.shadowMapSize;
    this.dirLight.shadow.mapSize.height = profile.shadowMapSize;
    this.dirLight.shadow.radius = profile.shadowRadius;
    this.dirLight.shadow.camera.near = 4;
    this.dirLight.shadow.camera.far = 140;
    const d = 36;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.atlas = createBlockTextureAtlas(atlasSeed);

    this.opaqueMaterial = new THREE.MeshStandardMaterial({
      map: this.atlas.map,
      vertexColors: true,
      roughness: profile.opaqueRoughness,
      metalness: profile.opaqueMetalness
    });

    this.transparentMaterial = new THREE.MeshStandardMaterial({
      map: this.atlas.map,
      vertexColors: true,
      transparent: true,
      opacity: profile.transparentOpacity,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: profile.transparentRoughness,
      metalness: profile.transparentMetalness,
      depthWrite: false
    });

    applyAnimatedMaterialShader(
      this.transparentMaterial,
      this.uTime,
      this.uWaterAmp,
      this.uWaterSpeed,
      this.uFoliageAmp,
      this.uFoliageSpeed,
      'blockworld-transparent-water-foliage-v1'
    );

    const boxGeom = new THREE.BoxGeometry(1.006, 1.006, 1.006);
    const edgesGeom = new THREE.EdgesGeometry(boxGeom);
    boxGeom.dispose();
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x111827 });
    this.selectionBox = new THREE.LineSegments(edgesGeom, edgesMat);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    this.applySettings(initialSettings);
  }

  public getQualityPreset(): QualityPreset {
    return this.activeQuality;
  }

  public setQualityPreset(preset: QualityPreset): void {
    this.activeQuality = preset;
    this.applyProfile(getQualityProfile(preset));
  }

  private applyProfile(profile: QualityProfile): void {
    this.uWaterAmp.value = profile.waterWaveAmplitude;
    this.uWaterSpeed.value = profile.waterWaveSpeed;
    this.uFoliageAmp.value = profile.foliageSwayAmplitude;
    this.uFoliageSpeed.value = profile.foliageSwaySpeed;

    this.renderer.toneMappingExposure = profile.toneMappingExposure;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatioCap));
    this.renderer.shadowMap.enabled = profile.shadowEnabled;

    if (this.dirLight.shadow.mapSize.width !== profile.shadowMapSize) {
      this.dirLight.shadow.mapSize.width = profile.shadowMapSize;
      this.dirLight.shadow.mapSize.height = profile.shadowMapSize;
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        this.dirLight.shadow.map = null;
      }
    }
    this.dirLight.shadow.radius = profile.shadowRadius;
    this.dirLight.castShadow = profile.shadowEnabled;
    this.dirLight.intensity = profile.dirLightIntensity;
    this.hemiLight.intensity = profile.hemiIntensity;

    this.scene.background = new THREE.Color(profile.skyHorizonColor);
    this.fog.color.setHex(profile.skyHorizonColor);
    this.fog.density = profile.fogEnabled ? profile.fogDensity : 0;

    this.skyDome.uniforms.uZenithColor.value.setHex(profile.skyZenithColor);
    this.skyDome.uniforms.uHorizonColor.value.setHex(profile.skyHorizonColor);
    this.skyDome.uniforms.uSunIntensity.value = profile.sunDiscIntensity;

    this.opaqueMaterial.roughness = profile.opaqueRoughness;
    this.opaqueMaterial.metalness = profile.opaqueMetalness;
    this.opaqueMaterial.needsUpdate = true;

    this.transparentMaterial.opacity = profile.transparentOpacity;
    this.transparentMaterial.roughness = profile.transparentRoughness;
    this.transparentMaterial.metalness = profile.transparentMetalness;
    this.transparentMaterial.needsUpdate = true;
  }

  applySettings(settings: GameSettings): void {
    const rawQuality = (settings as GameSettings & { quality?: string }).quality;
    if (rawQuality !== undefined) {
      this.activeQuality = normalizeQualityPreset(rawQuality);
    }
    const profile = getQualityProfile(this.activeQuality);
    this.applyProfile(profile);

    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.fog.density = settings.fog ? profile.fogDensity : 0;
    this.renderer.shadowMap.enabled = settings.shadows && profile.shadowEnabled;
    this.dirLight.castShadow = settings.shadows && profile.shadowEnabled;
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

  syncSunWithPlayer(playerX: number, playerZ: number): void {
    this.dirLight.position.set(playerX + 28, 46, playerZ + 22);
    this.dirLight.target.position.set(playerX, 10, playerZ);
    this.dirLight.target.updateMatrixWorld();
    this.skyDome.mesh.position.set(playerX, 0, playerZ);
    this.skyDome.uniforms.uSunDirection.value
      .copy(this.dirLight.position)
      .sub(this.dirLight.target.position)
      .normalize();
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  render(deltaSeconds = 1 / 60): void {
    this.uTime.value += Math.max(0, Math.min(deltaSeconds, 0.1));
    this.skyDome.uniforms.uTime.value = this.uTime.value;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.opaqueMaterial.dispose();
    this.transparentMaterial.dispose();
    this.skyDome.dispose();
    this.atlas.dispose();
    this.selectionBox.geometry.dispose();
    (this.selectionBox.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
