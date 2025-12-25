import * as THREE from "three";
import { WebGLRenderer, PerspectiveCamera, Vector3 } from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import { convertArrIntoRad, convertUnit, resizeKeepingAspect } from "../../../utils/utils";
import { readImage } from "../../../utils/domUtils";
import { OrbitControls } from "./OrbitControls";
import TileCanvas from "../../../tilecanvasnew";
import { createCanvas } from "../../../utils/canvasutils";
import { CDN_domain } from "../../../api/appProvider";
let width = 1920,
  height = 1080;
const config = {
  modelUrl: CDN_domain + "v3assets/InteractivePerspectiveView/perspectiveobject1.FBX",
  objects3d: ["Floor", "carpet"],
  surfaces: {
    front: "carpet"
  },
  carpet: {
    position: [0, 79, 0],
    rotation: [-90, 0, 0],
    scale: [9, 12, 2.5],
    resizable: true,
    defaultScale: [9, 12]
  },
  designScale: 4,
  Floor: {
    position: [0, -46.408, 0],
    rotation: [-90, 0, 0],
    scale: [1, 1, 1],
    defaultScale: [1, 1],
    preset: true,
    defaultTexture: {
      path: CDN_domain + "v3assets/InteractivePerspectiveView/floor.jpg",
      width: 0.05,
      height: 0.05
    }
  },
  Shot_1: {
    fov: 38,
    position: [-1876.6531829931546, 764.6775630840232, -1903.2382640347757],
    rotation: [-101.65, -52.11, -104.65],
    target: [-1107.856873942984, -1.3943702736085503e-14, -1404.028818178769],
    enableRotate: false,
    panSpeed: 0.6,
    autoRotate: false,
    autoRotateSpeed: 0.8,
    boundingBox: true,
    enableDamping: false
  }
};
const tileCanvas = new TileCanvas();
export default class PerspectiveView {
  constructor() {
    this.scene = new THREE.Scene();
  }
  init() {
    if (this.initiated) return;
    this.fbxLoader = new FBXLoader();
    this.w = width;
    this.h = height;
    this.sceneConfig = config;
    const { Shot_1: shot1 } = this.sceneConfig;
    this.renderer = new WebGLRenderer({
      preserveDrawingBuffer: true,
      alpha: true,
      antialias: false
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.w, this.h);
    this.camera = perspectiveCamera({ ...shot1, width, height });
    this.orbit = addOrbitControl(this.renderer, this.scene, this.camera, shot1);
    this.orbit.enabled = true;

    let ambient = new THREE.AmbientLight(0xffffff, 0.3);
    ambient.name = "amblight";
    if (!this.scene.getObjectByName("amblight")) this.scene.add(ambient);

    this.light = new THREE.DirectionalLight(0xffffff, 1);

    this.light.castShadow = true;
    this.light.name = "dirlight";
    if (!this.scene.getObjectByName("dirlight")) this.scene.add(this.light);
    this.initiated = true;
  }
  setup3dObject({ fbxUrl }) {
    return new Promise((resolve, reject) => {
      if (!this.sceneConfig) return;
      const { objects3d, surfaces } = this.sceneConfig;
      const setupObjects = () => {
        let objectsLoaded = 0;
        objects3d.forEach(object3d => {
          if (
            window.flags &&
            window.flags.perspectiveView &&
            !window.flags.perspectiveView.renderDefaultFloor
          ) {
            if (object3d.toLowerCase() === "floor") {
              this.render();

              objectsLoaded++;
              if (objectsLoaded === objects3d.length) {
                this.objectLoaded = true;
                resolve();
              }
              return;
            }
          }
          const object = this.objectFbx.getObjectByName(object3d);
          if (!object) {
            console.warn("PHOTOGRAPHIC VIEW: object", object3d, "does not exist");
            return;
          }

          this.scene.add(object);
          const objectConfig = this.sceneConfig[object3d];
          const {
            position = [0, 0, 0],
            rotation = [90, 0, 0],
            scale = [1, 1, 1],
            preset = false
          } = objectConfig;
          this.light.position.set(position[0] - 3000, position[1] + 3000, position[2] + 1000);
          var targetObject = new THREE.Object3D();
          targetObject.name = "TargetObject";
          targetObject.position.set(...position);
          this.scene.add(targetObject);
          this.light.target = targetObject;

          object.position.fromArray(position);
          object.scale.fromArray(scale);
          object.rotation.fromArray(convertArrIntoRad(rotation));
          if (!preset) {
            this.objProps = objectConfig;
            if (surfaces) {
              const { back, front } = surfaces;
              if (window.flags.removeBgForCustomDesign) {
                object.scale.fromArray([scale[0], scale[1], 0.5]);
              }
              this.object = object.getObjectByName(front);
              if (back) {
                this.objectBack = object.getObjectByName(back);
                this.hasBackSurface = true;
              } else {
                this.hasBackSurface = false;
              }
            } else {
              this.object = object;
            }
            if (this.material) {
              this.object.material = this.material;
              this.object.material.needsUpdate = true;
              this.render();
            }
            objectsLoaded++;

            if (objectsLoaded === objects3d.length) {
              resolve();
              this.objectLoaded = true;
            }
          } else {
            const { defaultTexture, defaultScale = [9, 12] } = objectConfig;
            const { width: texWidth = 9, height: texHeight = 12, path } = defaultTexture;
            const textureUrl = path;
            let repeat = [1, 1];
            const rx = defaultScale[0] / texWidth;
            const ry = defaultScale[1] / texHeight;
            repeat = [rx, ry];
            readImage(textureUrl).then(image => {
              const { width, height } = image;
              const canv = createCanvas(width, height);
              canv.getContext("2d").drawImage(image, 0, 0, width, height);

              const texture = new THREE.CanvasTexture(canv);
              texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
              texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
              texture.colorSpace = THREE.SRGBColorSpace;
              texture.repeat.fromArray(repeat);

              let material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                side: THREE.DoubleSide,
                needsUpdate: true
              });

              object.material = material;
              object.material.needsUpdate = true;
              this.render();

              objectsLoaded++;

              if (objectsLoaded === objects3d.length) {
                resolve();
                this.objectLoaded = true;
              }
            });
          }
        });
      };
      if (!this.objectLoaded)
        this.fbxLoader.load(
          fbxUrl,
          obj => {
            this.objectFbx = obj;
            setupObjects();
          },
          undefined,
          console.error
        );
      else setupObjects();
    });
  }
  setObjectTexture({ designDetails, designCanvas, backDesignCanvas, normapCanvas }) {
    // document.body.appendChild(designCanvas)
    return new Promise((resolve, reject) => {
      const { surfaceUnit = "in" } = this.objProps;
      const PhysicalWidth = convertUnit(
        designDetails.Unit,
        surfaceUnit,
        designDetails.PhysicalWidth
      );
      const PhysicalHeight = convertUnit(
        designDetails.Unit,
        surfaceUnit,
        designDetails.PhysicalHeight
      );
      this.designDetails = {
        ...designDetails,
        PhysicalHeight,
        PhysicalWidth,
        Unit: surfaceUnit
      };
      const designTexture = new THREE.CanvasTexture(designCanvas);
      let normalTexture;
      if (normapCanvas) {
        normalTexture = new THREE.CanvasTexture(normapCanvas);
        normalTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
      }
      designTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      designTexture.wrapS = designTexture.wrapT = THREE.RepeatWrapping;
      designTexture.colorSpace = THREE.SRGBColorSpace;
      // designTexture.flipY = false;
      this.material = new THREE.MeshStandardMaterial({
        map: designTexture,
        normalMap: normalTexture,
        roughness: 1,
        metalness: 0.1,
        needsUpdate: true,
        transparent: true,
        side: THREE.DoubleSide
      });
      if (!this.object) {
        console.error("could not find the object");
        resolve();
        return;
      }
      this.object.material = this.material;
      this.object.material.needsUpdate = true;
      if (this.hasBackSurface && backDesignCanvas) {
        const designTextureBack = new THREE.CanvasTexture(designCanvas);
        designTextureBack.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        designTextureBack.wrapS = designTextureBack.wrapT = THREE.RepeatWrapping;
        designTextureBack.colorSpace = THREE.SRGBColorSpace;
        this.materialBack = new THREE.MeshStandardMaterial({
          map: designTextureBack,
          transparent: true,
          side: THREE.DoubleSide,
          needsUpdate: true
        });
        this.objectBack.material = this.material;
        this.objectBack.material.needsUpdate = true;
      }
      this.render();
      resolve();
    });
  }
  getRenderedDesignImage({ designDetails, designPath, hash }) {
    const { IsIrregular } = designDetails;
    let zoom = 4;
    if (window.InterfaceElements.IsJpeg) zoom = 1;
    return new Promise(async (resolve, reject) => {
      if (!this.objectLoaded) await this.setup3dObject({ fbxUrl: this.sceneConfig.modelUrl });
      if (IsIrregular || window.flags.ordersheet.repeatRugInArea) {
        this.object.visible = false;
        this.render();
        resolve(this.renderer.domElement.toDataURL());
        return;
      } else {
        this.object.visible = true;
      }
      if (!designDetails.DesignColors) {
        reject();
      } else {
        tileCanvas.init({
          designDetails,
          tileSize: 256,
          zoom,
          canvasSize: { width: 3600, height: 4800 },
          renderBounds: { p1: { x: 0, y: 0 }, p2: { x: 1800, y: 2312 } }
        });
        this.setObjectTexture({
          designDetails,
          designCanvas: tileCanvas.canvas,
          normapCanvas: tileCanvas.canvasNorm
        });
        const drawNormap = !designDetails.DesignColors.every(
          color => color.PileHeight === designDetails.DesignColors[0].PileHeight && !color.Carving
        );
        tileCanvas.drawCanvasTiles(
          { designDetails, designPath, hash, drawNormap },
          undefined,
          () => {
            this.updateMap();
            resolve(this.renderer.domElement.toDataURL());
          }
        );
      }
    });
  }

  getRenderedDesignFromCustomUrl({ customUrl, physicalWidth, physicalHeight, unit = "cm" }) {
    return new Promise(async (resolve, reject) => {
      if (!this.objectLoaded) await this.setup3dObject({ fbxUrl: this.sceneConfig.modelUrl });
      this.object.visible = true;
      readImage(customUrl)
        .then(image => {
          const { width, height } = image;
          const designCanvas = createCanvas(width, height);
          const ctx = designCanvas.getContext("2d");
          ctx.drawImage(image, 0, 0, width, height);

          let PhysicalWidth, PhysicalHeight;
          if (!physicalWidth || !physicalHeight) {
            const maxDims = { width: 1200, height: 1500 };
            const { width: newWidth, height: newHeight } = resizeKeepingAspect(
              { width, height },
              maxDims,
              "fit_inside"
            );
            PhysicalWidth = convertUnit("in", "ft", newWidth / 10);
            PhysicalHeight = convertUnit("in", "ft", newHeight / 10);
          } else {
            PhysicalWidth = convertUnit(unit, "ft", physicalWidth);
            PhysicalHeight = convertUnit(unit, "ft", physicalHeight);
          }
          const designDetails = {
            Width: width,
            Height: height,
            PhysicalWidth,
            PhysicalHeight,
            Unit: "ft"
          };
          this.setObjectTexture({ designDetails, designCanvas });
          this.updateMap();
          resolve(this.renderer.domElement.toDataURL());
        })
        .catch(err => {
          reject(err);
        });
    });
  }

  updateMap() {
    if (this.object && this.object.material.map) {
      this.object.material.map.needsUpdate = true;
      if (this.object.material.normalMap) this.object.material.normalMap.needsUpdate = true;
      this.object.material.needsUpdate = true;
    }
    if (this.objectBack && this.objectBack.material.map) {
      this.objectBack.material.needsUpdate = true;
      this.objectBack.material.map.needsUpdate = true;
    }
    this.render();
  }
  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Dispose of all Three.js resources to prevent memory leaks
   * Call this when component unmounts
   */
  dispose() {
    // Dispose materials
    if (this.material) {
      if (this.material.map) this.material.map.dispose();
      if (this.material.normalMap) this.material.normalMap.dispose();
      this.material.dispose();
      this.material = null;
    }

    if (this.materialBack) {
      if (this.materialBack.map) this.materialBack.map.dispose();
      this.materialBack.dispose();
      this.materialBack = null;
    }

    // Dispose geometries and materials in scene
    this.scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(material => {
            if (material.map) material.map.dispose();
            if (material.normalMap) material.normalMap.dispose();
            material.dispose();
          });
        } else {
          if (object.material.map) object.material.map.dispose();
          if (object.material.normalMap) object.material.normalMap.dispose();
          object.material.dispose();
        }
      }
    });

    // Remove orbit control event listeners and dispose
    if (this.orbit) {
      this.orbit.removeEventListener("change", this.render);
      this.orbit.dispose();
      this.orbit = null;
    }

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    // Clear scene
    if (this.scene) {
      this.scene.clear();
      this.scene = null;
    }

    // Clear references
    this.object = null;
    this.objectBack = null;
    this.objectFbx = null;
    this.camera = null;
    this.light = null;
    this.initiated = false;
    this.objectLoaded = false;
  }
}
const addOrbitControl = (renderer, scene, camera, config = {}) => {
  let { target = [0, 0, 0] } = config;
  const control = new OrbitControls(camera, renderer.domElement);
  control.enableKeys = false;
  control.target = new Vector3(...target);
  control.addEventListener("change", () => {
    renderer.render(scene, camera);
  });
  control.update();
  return control;
};
const perspectiveCamera = (config = {}) => {
  const { innerWidth, innerHeight } = window;
  let {
    fov = 40,
    near = 0.1,
    far = 100000,
    height = innerHeight,
    width = innerWidth,
    position = [0, 200, 500],
    target = [0, 0, 0],
    rotation = [0, 0, 0]
  } = config;
  const aspect = width / height;
  const camera = new PerspectiveCamera(fov, aspect, near, far);
  camera.lookAt(new Vector3(...target)); // This seems to be disabled by OrbitControls
  camera.position.set(...position);
  camera.rotation.set(...convertArrIntoRad(rotation));
  return camera;
};
