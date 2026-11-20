import * as THREE from 'three';

export interface AtmosphereRig {
  skyMesh: THREE.Mesh;
  sunMesh: THREE.Mesh;
  cloudGroup: THREE.Group;
  update: (elapsedSec: number, playerX: number, playerZ: number, enabled: boolean) => void;
  dispose: () => void;
}

export function createAtmosphereRig(scene: THREE.Scene): AtmosphereRig {
  const skyUniforms = {
    uTopColor: { value: new THREE.Color(0x2d74c4) },
    uHorizonColor: { value: new THREE.Color(0xc8e4f8) },
    uSunDir: { value: new THREE.Vector3(0.45, 0.72, 0.35).normalize() },
    uSunColor: { value: new THREE.Color(0xfff2cc) }
  };

  const skyGeo = new THREE.SphereGeometry(155, 32, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(worldPos.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      varying vec3 vWorldDir;
      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, 0.0, 1.0);
        float horizonBlend = pow(1.0 - h, 2.35);
        vec3 col = mix(uTopColor, uHorizonColor, horizonBlend);

        float sunAmt = max(dot(dir, normalize(uSunDir)), 0.0);
        col += uSunColor * pow(sunAmt, 36.0) * 0.35;
        col += uSunColor * smoothstep(0.9985, 0.9996, sunAmt) * 1.4;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });

  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);

  const sunGeo = new THREE.BoxGeometry(6.5, 6.5, 6.5);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff5d6, fog: false });
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunMesh.frustumCulled = false;
  scene.add(sunMesh);

  const cloudGroup = new THREE.Group();
  cloudGroup.frustumCulled = false;
  const cloudGeo = new THREE.BoxGeometry(14, 1.8, 9);
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,
    opacity: 0.72
  });

  const offsets: Array<[number, number, number]> = [
    [-42, 42, -36],
    [18, 44, -52],
    [54, 41, -14],
    [-24, 43, 28],
    [32, 42, 44],
    [-60, 44, 8]
  ];

  for (const [cx, cy, cz] of offsets) {
    const puff = new THREE.Mesh(cloudGeo, cloudMat);
    puff.position.set(cx, cy, cz);
    cloudGroup.add(puff);
  }
  scene.add(cloudGroup);

  const update = (elapsedSec: number, playerX: number, playerZ: number, enabled: boolean) => {
    skyMesh.visible = enabled;
    sunMesh.visible = enabled;
    cloudGroup.visible = enabled;
    if (!enabled) return;

    skyMesh.position.set(playerX, 0, playerZ);
    sunMesh.position.set(playerX + 62, 102, playerZ + 46);
    cloudGroup.position.set(playerX + ((elapsedSec * 1.2) % 36) - 18, 0, playerZ);
  };

  const dispose = () => {
    scene.remove(skyMesh);
    scene.remove(sunMesh);
    scene.remove(cloudGroup);
    skyGeo.dispose();
    skyMat.dispose();
    sunGeo.dispose();
    sunMat.dispose();
    cloudGeo.dispose();
    cloudMat.dispose();
  };

  return { skyMesh, sunMesh, cloudGroup, update, dispose };
}
