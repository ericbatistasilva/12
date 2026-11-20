import * as THREE from 'three';
import { GameSettings } from '../core/gameState.js';
import { TargetBlockHit } from '../building/blockInteraction.js';
import { BlockAtlasResources, createBlockTextureAtlas } from '../world/blockTextureAtlas.js';

export class GameEngine {
  public readonly canvas: HTMLCanvasElement;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly atlas: BlockAtlasResources;
  public readonly opaqueMaterial: THREE.MeshStandardMaterial;
  public readonly transparentMaterial: THREE.MeshStandardMaterial;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly fog: THREE.FogExp2;
  private readonly selectionBox: THREE.LineSegments;

  constructor(canvas: HTMLCanvasElement, initialSettings: GameSettings, atlasSeed = 1337) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth || 800, window.innerHeight || 600, false);
    this.renderer.shadowMap.enabled = initialSettings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ec5e8);

    this.fog = new THREE.FogExp2(0x9ec5e8, initialSettings.fog ? 0.012 : 0);
    this.scene.fog = this.fog;

    const width = window.innerWidth || 800;
    const height = window.innerHeight || 600;
    this.camera = new THREE.PerspectiveCamera(initialSettings.fov, width / height, 0.1, 180);

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x4b5563, 0.9);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
    this.dirLight.position.set(28, 46, 22);
    this.dirLight.castShadow = initialSettings.shadows;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
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
      roughness: 0.86,
      metalness: 0.04
    });

    this.transparentMaterial = new THREE.MeshStandardMaterial({
      map: this.atlas.map,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.52,
      metalness: 0.05,
      depthWrite: false
    });

    const boxGeom = new THREE.BoxGeometry(1.006, 1.006, 1.006);
    const edgesGeom = new THREE.EdgesGeometry(boxGeom);
    boxGeom.dispose();
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x111827 });
    this.selectionBox = new THREE.LineSegments(edgesGeom, edgesMat);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    this.applySettings(initialSettings);
  }

  applySettings(settings: GameSettings): void {
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.fog.density = settings.fog ? 0.012 : 0;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.dirLight.castShadow = settings.shadows;
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
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.opaqueMaterial.dispose();
    this.transparentMaterial.dispose();
    this.atlas.dispose();
    this.selectionBox.geometry.dispose();
    (this.selectionBox.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
