import * as THREE from "three";
import { OrbitControls } from "./OrbitControls";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import {
  convertArrIntoRad,
  areaOfellipse,
  createVector,
  resizeKeepingAspect
} from "../../../utils/utils";
import { readImage } from "../../../utils/domUtils";
import { clearCanvas, canvasToBlobPromise, createCanvas } from "../../../utils/canvasutils";
import { convertUnit } from "../../../utils/utils";
import AppProvider from "../../../api/appProvider";
import { Box3 } from "three";
const raycaster = new THREE.Raycaster();
const fbxLoader = new FBXLoader();

export default class MyRoomHelper {
  constructor() {
    this.scene = new THREE.Scene();
    this.textureLoader = new THREE.TextureLoader();
    this.offset = new THREE.Vector3();
    this.fbxLoaded = false;
    this.surfaceName = "Box002";
    this.scene = new THREE.Scene();

    this.zoomCarpetStep = 0.05;
    this.maxZoom = 2;
    this.minZoom = 0.5;
    // this.carpetRatio = 1;
    this.carpetRatio = { w: 1, h: 1 };
    this.origCarpetDims = { w: 10, h: 10 };
    this.scaleFactor = { x: 0, y: 0 };
    this.pileHeight = 0.25;
    this.myRoomPointsOBJ = {
      floorpoints: [],
      notfloorpoints: [],
      carpetpoints: []
    };
    //window.myRoomPointsOBJ = this.myRoomPointsOBJ;

    this.pointsHistory = {
      floorpoints: "",
      notfloorpoints: "",
      inputSelected: ""
    };
    this.pointsHistoryArray = [];

    this.constraints = window.constraints = {
      audio: false,
      video: true
    };
    this.initCarpetPos = null;
    this.initCarpetRot = null;
    this.initCarpetScale = null;
    this.designDetails = null;
    this.designPath = null;
    this.canvasInitiated = false;
    this.roomAnalysisData = null;

    // Performance optimization: Object pools to reduce GC pressure
    this._vector3Pool = {
      v1: new THREE.Vector3(),
      v2: new THREE.Vector3(),
      v3: new THREE.Vector3(),
      v4: new THREE.Vector3()
    };
    this._vector2Pool = {
      v1: new THREE.Vector2(),
      v2: new THREE.Vector2()
    };
    this._raycaster = new THREE.Raycaster();

    // Caching for expensive calculations
    this._cachedFloorBounds = null;
    this._cachedCarpetDims = null;
    this._cacheInvalidated = true;
  }
  initCanvas({ bgCanvas, rendererCanvas, maskCanvas, gizmoCanvas, inputCanvas, container }) {
    this.canvasInitiated = true;
    this.designPath = null;
    this.bgCanvas = bgCanvas;
    this.rendererCanvas = rendererCanvas;
    this.maskCanvas = maskCanvas;
    this.gizmoCanvas = gizmoCanvas;
    this.inputCanvas = inputCanvas;

  }
  updateBackground({ bgImage, width, height }) {
    this.bgImage = bgImage;
    const bgCtx = this.bgCanvas.getContext("2d");
    this.bgCanvas.width = width;
    this.bgCanvas.height = height;
    this.origWid = width;
    this.origHgt = height;

    this.scaleFactor = { x: 0, y: 0 };

    clearCanvas(this.bgCanvas, width, height);
    bgCtx.drawImage(bgImage, 0, 0, width, height);
  }

  initScene({ dims, sceneConfig }) {
    this.dims = dims;
    const { width, height } = this.dims;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.rendererCanvas,
      preserveDrawingBuffer: true,
      alpha: true,
      antialias: false
    });
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.setSize(width, height);
    this.camera = new THREE.PerspectiveCamera(this.fov, width / height, 0.1, 10000);
    this.camera.position.set(0, 160, 386);

    let target = [0, 0, 0];
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.screenSpacePanning = true;
    this.orbit.enabled = true;
    this.orbit.minPolarAngle = -0.3490658503988659;
    this.orbit.maxPolarAngle = 1.7453292519943295;
    // this.orbit.object.position.set(0, 160, 400)
    this.orbit.target = new THREE.Vector3(...target);
    this.orbit.addEventListener("change", () => {
      this.render();
    });
    return Promise.resolve();
  }
  setRoomAnalysis(analysisData) {
    this.roomAnalysisData = analysisData;
    this._invalidateCache();
  }
  _invalidateCache() {
    // Invalidate cached calculations when room or design changes
    this._cachedFloorBounds = null;
    this._cachedCarpetDims = null;
    this._cacheInvalidated = true;
  }
  render() {
    this.renderer.render(this.scene, this.camera);
  }
  setupCarpet(fbxUrl, shouldSetPosition) { }
  setCarpetVisibility(visible) {
    if (this.carpetMesh) this.carpetMesh.visible = visible;
    this.render();
  }
  loadDesignCanvas({
    designCanvas,
    fbxUrl,
    designDetails,
    designPath,
    customWid,
    customHgt,
    unit
  }) {
    const shouldResetPosRot = this.designDetails === null;
    const shouldResetScale = this.designPath !== designPath || (customWid && customHgt);

    // Invalidate cache if design changes
    if (this.designDetails !== designDetails || this.designPath !== designPath) {
      this._invalidateCache();
    }

    this.designDetails = designDetails;
    this.designPath = designPath;
    return new Promise((resolve, reject) => {
      const designTexture = new THREE.CanvasTexture(designCanvas);
      designTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      // designTexture.needsUpdate = true;
      designTexture.colorSpace = THREE.SRGBColorSpace;
      let position = [0, 0, 0],
        rotation = [-90, 0, 90];

      // Use room analysis data if available
      if (this.roomAnalysisData && this.roomAnalysisData.floor_center) {
        position = this.calculateCarpetPosition(this.roomAnalysisData);
        rotation = this.calculateCarpetRotation(this.roomAnalysisData);
      }

      let repeat = [1, 1];

      // Calculate bounds for all carpets (not just wall-to-wall)
      const floorBounds = this._getFloorBoundsCached();
      if (floorBounds) {
        const fac = 1;
        const min = new THREE.Vector3(
          floorBounds.minX / fac,
          position[1] - 30,
          floorBounds.minZ / fac
        );
        const max = new THREE.Vector3(
          floorBounds.maxX / fac,
          position[1] + 30,
          floorBounds.maxZ / fac
        );
        this.bounds = new Box3(min, max);
        console.log('Set bounds for carpet dragging:', this.bounds);
      }

      if (window.InterfaceElements.IsWallToWall) {
        const walltowalldims = [50, 50];
        if (this.designDetails.Unit != "ft") {
          //if in cm change it to ft, done for endlessknot
          const convertedUnitWidth = convertUnit(
            this.designDetails.Unit,
            "ft",
            this.designDetails.PhysicalWidth,
            2
          );
          const convertedUnitHeight = convertUnit(
            this.designDetails.Unit,
            "ft",
            this.designDetails.PhysicalHeight,
            2
          );
          repeat = [
            walltowalldims[0] / convertedUnitWidth,
            walltowalldims[1] / convertedUnitHeight
          ];
        } else {
          repeat = [
            walltowalldims[0] / this.designDetails.PhysicalWidth,
            walltowalldims[1] / this.designDetails.PhysicalHeight
          ];
        }
        let offsetX = 0;
        let offsetY = 0;
        if (window.flags.visualizations?.wallToWallCenterRepeat?.x) {
          let halfRepeatX = repeat[0] / 2;
          offsetX = 0.5 - (halfRepeatX - Math.floor(halfRepeatX)); //offset to center the tile center as canvas center horizontally
        }
        if (window.flags.visualizations?.wallToWallCenterRepeat?.y) {
          let halfRepeatY = repeat[0] / 2;
          offsetY = 0.5 - (halfRepeatY - Math.floor(halfRepeatY)); //offset to center the tile center as canvas center vertically
        }
        designTexture.offset.fromArray([offsetX, offsetY]);
        designTexture.wrapS = designTexture.wrapT = THREE.RepeatWrapping;
        designTexture.repeat.fromArray([repeat[0], repeat[1]]);
        designTexture.colorSpace = THREE.SRGBColorSpace;
        //take it from props/parameteres
        const z =
          (1.25 *
            107.6 *
            10 *
            convertUnit(this.designDetails.Unit, "ft", this.designDetails.PhysicalHeight) *
            (1 + this.scaleFactor.y)) /
          walltowalldims[1]; //107.6 = half of the rug.fbx which is 215 units (check in blender) (215 units = 1 ft)
        const x =
          (1.25 *
            107.6 *
            10 *
            convertUnit(this.designDetails.Unit, "ft", this.designDetails.PhysicalWidth) *
            (1 + this.scaleFactor.x)) /
          walltowalldims[0];
        let fac = 1;
        const min = new THREE.Vector3(
          (position[0] - x) / fac,
          position[1] - 30,
          (position[2] - z) / fac
        );
        const max = new THREE.Vector3(
          (position[0] + x) / fac,
          position[1] + 30,
          (position[2] + z) / fac
        );
        // Override general bounds with wall-to-wall specific bounds
        this.bounds = new Box3(min, max);
        console.log('Set wall-to-wall specific bounds:', this.bounds);
      }

      this.material = new THREE.MeshBasicMaterial({
        map: designTexture,
        transparent: true,
        needsUpdate: true
      });
      let IsIrregular;
      if (this.designDetails) {
        const PhysicalWidth =
          convertUnit(this.designDetails.Unit, "ft", this.designDetails.PhysicalWidth) * repeat[0];
        const PhysicalHeight =
          convertUnit(this.designDetails.Unit, "ft", this.designDetails.PhysicalHeight) * repeat[1];
        IsIrregular = this.designDetails.IsIrregular;

        if (
          this.fbxLoaded &&
          (this.origCarpetDims.w !== PhysicalWidth || this.origCarpetDims.h !== PhysicalHeight)
        ) {
          // if (this.fbxLoaded && (this.carpetRatio !== (PhysicalWidth / PhysicalHeight))) {
          // this.carpetRatioNew = PhysicalWidth / PhysicalHeight;
          this.carpetRatioNew = {
            w: PhysicalWidth / this.origCarpetDims.w,
            h: PhysicalHeight / this.origCarpetDims.h
          };
          if (!shouldResetScale) {
            this.initCarpetScale = [
              this.carpetRatioNew.w + this.scaleFactor.x * this.carpetRatioNew.w,
              this.carpetRatioNew.h + this.scaleFactor.y * this.carpetRatioNew.h,
              IsIrregular ? 0.1 : this.pileHeight
            ];
            this.carpetMesh.scale.set(...this.initCarpetScale);
          }
        }
        this.carpetRatio = {
          w: PhysicalWidth / this.origCarpetDims.w,
          h: PhysicalHeight / this.origCarpetDims.h
        };
      }
      const setup = () => {
        if (shouldResetPosRot) {
          this.initCarpetPos = position;
          this.initCarpetRot = rotation;
          this.carpetMesh.position.fromArray(position);
          this.carpetMesh.rotation.fromArray(convertArrIntoRad(rotation));
        }
        if (shouldResetScale) {
          this.initCarpetScale = [
            this.carpetRatio.w + this.scaleFactor.x * this.carpetRatio.w,
            this.carpetRatio.h + this.scaleFactor.y * this.carpetRatio.h,
            IsIrregular ? 0.1 : this.pileHeight
          ];

          if (customWid && customHgt) {
            customWid = convertUnit(unit, "ft", customWid);
            customHgt = convertUnit(unit, "ft", customHgt);
            this.carpetMesh.scale.set(
              customWid / 10,
              customHgt / 10,
              IsIrregular ? 0.1 : this.pileHeight
            );
          } else {
            this.carpetMesh.scale.set(...this.initCarpetScale);
          }
        }
        var material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        this.carpetMesh.material = material;
        if (this.material) {
          this.carpetMesh.material = this.material;
          this.carpetMesh.material.needsUpdate = true;
          this.render();
        }
        this.fbxLoaded = true;
        this.render();
        resolve();
      };
      if (!this.fbxLoaded)
        fbxLoader.load(
          fbxUrl,
          obj => {
            this.carpetMesh = obj.getObjectByName(this.surfaceName);
            this.scene.add(this.carpetMesh);
            this.setCarpetVisibility(false);
            setup();
          },
          undefined,
          console.error
        );
      else setup();
    });
  }
  updateMap() {
    this.carpetMesh.material.map.needsUpdate = true;
    this.render();
  }
  calculateCarpetPosition(analysisData) {
    // Validate input
    if (!analysisData || !analysisData.floor_center) {
      console.warn('Room analysis data incomplete, using default position');
      return [0, 0, 0];
    }

    const { floor_center } = analysisData;

    // Handle no floor detected (ceiling shots)
    if (floor_center.no_floor) {
      console.warn('No floor detected in image, using default position');
      return [0, 0, 0];
    }

    // Handle very small floor areas (likely false detections)
    if (floor_center.area && parseInt(floor_center.area) < 10000) {
      console.warn('Floor area too small, may be false detection');
      return [0, 0, 0];
    }

    // If camera not initialized yet, return default
    if (!this.camera || !this.renderer || !this.origWid || !this.origHgt) {
      console.warn('Camera not initialized, using default position');
      return [0, 0, 0];
    }

    try {
      // Convert pixel coordinates to normalized device coordinates (NDC)
      // floor_center.x and floor_center.y are in pixel space of the original image
      const normalizedX = (parseFloat(floor_center.x) / this.origWid) * 2 - 1;
      const normalizedY = -(parseFloat(floor_center.y) / this.origHgt) * 2 + 1;

      // Use pooled raycaster to reduce GC pressure
      const normVec = this._vector2Pool.v1.set(normalizedX, normalizedY);
      this._raycaster.setFromCamera(normVec, this.camera);

      // Create a floor plane at y=0 (using pooled vector for normal)
      const floorNormal = this._vector3Pool.v1.set(0, 1, 0);
      const floorPlane = new THREE.Plane(floorNormal, 0);

      // Reuse pooled vector for intersection point
      const intersectionPoint = this._vector3Pool.v2;
      const hasIntersection = this._raycaster.ray.intersectPlane(floorPlane, intersectionPoint);

      if (hasIntersection) {
        // Use cached floor bounds and carpet dimensions
        const floorBounds = this._getFloorBoundsCached();
        const carpetDims = this._getCarpetDimensionsCached();

        // Reuse pooled vector for final position
        const finalPosition = this._vector3Pool.v3.copy(intersectionPoint);

        if (floorBounds && carpetDims) {
          // Calculate carpet half-dimensions (with safety margin)
          const safetyMargin = 1.05; // 5% safety margin (reduced from 10%)
          const halfWidth = (carpetDims.width / 2) * safetyMargin;
          const halfDepth = (carpetDims.depth / 2) * safetyMargin;

          // Clamp position to keep carpet fully within bounds
          finalPosition.x = Math.max(
            floorBounds.minX + halfWidth,
            Math.min(floorBounds.maxX - halfWidth, finalPosition.x)
          );
          finalPosition.z = Math.max(
            floorBounds.minZ + halfDepth,
            Math.min(floorBounds.maxZ - halfDepth, finalPosition.z)
          );

          console.log('Carpet position adjusted to fit within bounds:', {
            original: [intersectionPoint.x, intersectionPoint.y, intersectionPoint.z],
            adjusted: [finalPosition.x, finalPosition.y, finalPosition.z],
            bounds: floorBounds,
            carpetDims
          });
        } else {
          // If we can't determine bounds, use safer fallback: place closer to camera center
          console.warn('Could not determine floor bounds, using centered fallback position');

          // Get the center of the view on the floor plane
          const centerPoint = this._vector3Pool.v4;
          this._raycaster.setFromCamera(this._vector2Pool.v2.set(0, 0), this.camera);
          const centerIntersection = this._raycaster.ray.intersectPlane(
            new THREE.Plane(this._vector3Pool.v1.set(0, 1, 0), 0),
            centerPoint
          );

          if (centerIntersection) {
            // Use center position, but slightly offset forward if needed
            finalPosition.copy(centerPoint);
            console.log('Using view center position as fallback:', [finalPosition.x, finalPosition.y, finalPosition.z]);
          } else {
            // Last resort: use intersection point with minimal offset
            console.warn('Center raycasting also failed, using minimal offset');
          }
        }

        // Final validation: ensure position is reasonable relative to camera
        const distanceToCamera = Math.sqrt(
          Math.pow(finalPosition.x - this.camera.position.x, 2) +
          Math.pow(finalPosition.z - this.camera.position.z, 2)
        );

        // If carpet is too far from camera view (more than 500 units), use center fallback
        if (distanceToCamera > 500) {
          console.warn('Calculated position too far from camera, using center fallback');
          const centerPoint = this._vector3Pool.v4;
          this._raycaster.setFromCamera(this._vector2Pool.v2.set(0, 0), this.camera);
          if (this._raycaster.ray.intersectPlane(new THREE.Plane(this._vector3Pool.v1.set(0, 1, 0), 0), centerPoint)) {
            console.log('Using centered position:', [centerPoint.x, centerPoint.y, centerPoint.z]);
            return [centerPoint.x, 0, centerPoint.z];
          }
        }

        console.log('Carpet final position:', [finalPosition.x, finalPosition.y, finalPosition.z]);
        return [finalPosition.x, 0, finalPosition.z];
      }

      // Fallback if raycasting fails
      console.warn('Raycasting failed to find floor intersection, using center of view');
      // Try to use center of view as fallback
      const centerPoint = this._vector3Pool.v2;
      this._raycaster.setFromCamera(this._vector2Pool.v1.set(0, 0), this.camera);
      // Create a new floor plane for center fallback (reuse floorPlane variable from above)
      const fallbackPlane = new THREE.Plane(this._vector3Pool.v3.set(0, 1, 0), 0);
      if (this._raycaster.ray.intersectPlane(fallbackPlane, centerPoint)) {
        console.log('Using fallback center position:', [centerPoint.x, centerPoint.y, centerPoint.z]);
        return [centerPoint.x, 0, centerPoint.z];
      }
      return [0, 0, 0];
    } catch (error) {
      console.error('Error calculating carpet position:', error);
      return [0, 0, 0];
    }
  }
  _getFloorBoundsCached() {
    // Return cached bounds if available
    if (this._cachedFloorBounds && !this._cacheInvalidated) {
      return this._cachedFloorBounds;
    }
    // Calculate and cache
    this._cachedFloorBounds = this._estimateFloorBounds();
    return this._cachedFloorBounds;
  }
  _getCarpetDimensionsCached() {
    // Return cached dimensions if available
    if (this._cachedCarpetDims && !this._cacheInvalidated) {
      return this._cachedCarpetDims;
    }
    // Calculate and cache
    this._cachedCarpetDims = this._estimateCarpetDimensions();
    this._cacheInvalidated = false;
    return this._cachedCarpetDims;
  }
  _estimateFloorBounds() {
    // Estimate floor boundaries by raycasting at the frustum edges
    if (!this.camera || !this.renderer) return null;

    try {
      // Reuse pooled raycaster and vectors
      const floorNormal = this._vector3Pool.v1.set(0, 1, 0);
      const floorPlane = new THREE.Plane(floorNormal, 0);

      // Test more points and use wider coverage for better bounds estimation
      const testPointsData = [
        -0.9, -0.9,  // bottom-left (wider)
        0.9, -0.9,   // bottom-right (wider)
        -0.9, 0.9,   // top-left (wider)
        0.9, 0.9,    // top-right (wider)
        0, -0.9,     // bottom-center
        -0.9, 0,     // left-center
        0.9, 0,      // right-center
        0, 0,        // center
        -0.5, -0.5,  // intermediate points
        0.5, -0.5,
        -0.5, 0.5,
        0.5, 0.5
      ];

      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let validIntersections = 0;

      const testPoint = this._vector2Pool.v2;
      const intersection = this._vector3Pool.v2;

      for (let i = 0; i < testPointsData.length; i += 2) {
        testPoint.set(testPointsData[i], testPointsData[i + 1]);
        this._raycaster.setFromCamera(testPoint, this.camera);

        if (this._raycaster.ray.intersectPlane(floorPlane, intersection)) {
          minX = Math.min(minX, intersection.x);
          maxX = Math.max(maxX, intersection.x);
          minZ = Math.min(minZ, intersection.z);
          maxZ = Math.max(maxZ, intersection.z);
          validIntersections++;
        }
      }

      // Require at least 1 valid intersection (reduced from 3)
      if (validIntersections < 1) return null;

      // Add conservative padding to bounds (20% inset from edges)
      const paddingX = (maxX - minX) * 0.2;
      const paddingZ = (maxZ - minZ) * 0.2;

      return {
        minX: minX + paddingX,
        maxX: maxX - paddingX,
        minZ: minZ + paddingZ,
        maxZ: maxZ - paddingZ
      };
    } catch (error) {
      console.warn('Failed to estimate floor bounds:', error);
      return null;
    }
  }
  _estimateCarpetDimensions() {
    // Estimate carpet dimensions in world space based on design details
    if (!this.designDetails) return null;

    try {
      const PhysicalWidth = convertUnit(
        this.designDetails.Unit,
        'ft',
        this.designDetails.PhysicalWidth
      );
      const PhysicalHeight = convertUnit(
        this.designDetails.Unit,
        'ft',
        this.designDetails.PhysicalHeight
      );

      // Convert feet to world units (assuming 10 world units = 1 foot based on scale calculation)
      // From line 275: customWid / 10, meaning world_units = feet * 10
      return {
        width: PhysicalWidth * 10,
        depth: PhysicalHeight * 10
      };
    } catch (error) {
      console.warn('Failed to estimate carpet dimensions:', error);
      return null;
    }
  }
  calculateCarpetRotation(analysisData) {
    // Default rotation: lays carpet flat and rotates 90 degrees
    const defaultRotation = [-90, 0, 90];

    // Validate input
    if (!analysisData || !analysisData.orientation) {
      console.warn('Room orientation data incomplete, using default rotation');
      return defaultRotation;
    }

    const { orientation } = analysisData;

    // If orientation detection failed, use default
    if (orientation.exception) {
      console.warn('Orientation detection failed, using default rotation');
      return defaultRotation;
    }

    try {
      // Base rotation to lay carpet flat on floor
      const rotX = -90;

      // Y-axis rotation (around vertical) - keeps carpet aligned with room
      let rotY = 0;

      // Z-axis rotation - align with room's horizontal orientation
      // The horizontal orientation (hor) tells us the room's left/right tilt
      // We adjust the carpet rotation to align naturally with the room
      const horAngle = parseFloat(orientation.hor);

      // Convert horizontal angle to carpet rotation
      // Add 90 degrees base rotation and adjust based on room orientation
      let rotZ = 90 - horAngle;

      // Apply flag correction if needed (180-degree rooms)
      if (!orientation.flag) {
        rotZ += 90;
      }

      // Normalize rotation to -180 to 180 range
      while (rotZ > 180) rotZ -= 360;
      while (rotZ < -180) rotZ += 360;

      console.log('Carpet rotation calculated:', {
        horAngle,
        flag: orientation.flag,
        rotation: [rotX, rotY, rotZ]
      });

      return [rotX, rotY, rotZ];
    } catch (error) {
      console.error('Error calculating carpet rotation:', error);
      return defaultRotation;
    }
  }
  uploadRoom({ bgCanvas }) {
    return canvasToBlobPromise(bgCanvas).then(bgBlob => {
      return AppProvider.uploadMyRoom(bgBlob).then(roomId => {
        if (roomId === "" || roomId === "maxsize") {
          //TODO:handle error in room id
          return roomId;
        }
        return { roomId };
      });
    });
  }
  updateMask = async ({ maskUrl, maskImage, maskCanvas, bgCanvas, width, height }) => {
    const maskRoomImage = maskUrl ? await readImage(maskUrl) : maskImage;
    width = width || maskCanvas.width;
    height = height || maskCanvas.height;
    maskCanvas.width = width;
    maskCanvas.height = height;
    clearCanvas(maskCanvas, width, height);
    const tmpCanvas = createCanvas(width, height);
    tmpCanvas.getContext("2d").drawImage(bgCanvas, 0, 0, width, height);
    this.makeMask(tmpCanvas, width, height, maskRoomImage);
    maskCanvas.getContext("2d").drawImage(tmpCanvas, 0, 0, width, height);
  };
  makeMask(canvas, w, h, maskImg, flag = false) {
    const tCanvas = createCanvas(w, h);
    const shCtx = canvas.getContext("2d");
    const tmpCtx = tCanvas.getContext("2d");
    tmpCtx.drawImage(maskImg, 0, 0, w, h);
    let imgData = shCtx.getImageData(0, 0, w, h);
    let maskData = tmpCtx.getImageData(0, 0, w, h);
    for (let i = 0; i < maskData.data.length; i += 4) {
      if (flag) {
        imgData.data[i + 3] = maskData.data[i];
      } else {
        imgData.data[i + 3] = 255 - maskData.data[i];
      }
    }
    shCtx.putImageData(imgData, 0, 0);
    this.roomdataurl = canvas.toDataURL("image/png");
    return maskData;
  }
  async uploadMask({ maskUrl, roomId }) {
    if (!maskUrl || !roomId) return;
    return new Promise((resolve, reject) => {
      readImage(maskUrl).then(maskImage512 => {
        const tmpCanvas = createCanvas(maskImage512.width, maskImage512.height);

        tmpCanvas.getContext("2d").drawImage(maskImage512, 0, 0);
        canvasToBlobPromise(tmpCanvas).then(mask512Blob => {
          AppProvider.uploadMyRoomMask({ maskUrl: mask512Blob, roomId }).then(() => {
            resolve();
          });
        });
      });
    });
  }
  resetCarpetTransform() {
    if (!this.carpetMesh || !this.initCarpetPos) return;
    this.carpetMesh.position.fromArray(this.initCarpetPos);
    this.carpetMesh.rotation.fromArray(convertArrIntoRad(this.initCarpetRot));
    this.carpetMesh.scale.set(...this.initCarpetScale);
    this.render();
  }
  rotateCarpet(angleinDeg) {
    this.carpetMesh.rotation.z += (angleinDeg * Math.PI) / 180;
    this.render();
  }
  scaleUpCarpet() {
    const step = this.zoomCarpetStep;
    this.scaleCarpet(step);
  }
  scaleDownCarpet() {
    const step = -this.zoomCarpetStep;
    this.scaleCarpet(step);
  }
  scaleCarpet(step) {
    const newValue = (this.carpetMesh.scale.x + step * this.carpetRatio.w) / this.carpetRatio.w;
    if (this.maxZoom >= newValue && newValue >= this.minZoom) {
      this.carpetMesh.scale.x += step * this.carpetRatio.w;
      this.carpetMesh.scale.y += step * this.carpetRatio.h;
      this.scaleFactor.x += step;
      this.scaleFactor.y += step;
      // this.roomData.scale_factor.x += step;
      // this.roomData.scale_factor.y += step;
      this.render();
    }
  }
  adjustPlaneHeight(increaseBool, step = 5) {
    const deltaY = !increaseBool ? +step : -step;
    this.orbit.pan(0, deltaY);
    this.orbit.update();
  }
  adjustCameraAngle(increaseBool, step = 2) {
    var delta = increaseBool ? +step : -step;
    delta *= Math.PI / 180;
    this.orbit.rotateUp(delta);
    this.orbit.update();
  }
  mouseDownTouchStart(e) {
    if (!this.carpetMesh) return;
    this.intersectsGizmo = this.findGizmoIntersection(e);
    this.prev = { ...e };
    if (!this.intersectsGizmo) {
      const intersect = this.raycastMouseOnObject(e);
      if (!intersect) return;
      const objPos = this.carpetMesh.position.clone();
      this.offset.copy(intersect.point).sub(objPos);
      this.render();
    }
  }
  mouseTouchMove(e, translateCarpetMode) {
    if (!this.carpetMesh) return;
    if (translateCarpetMode) {
      if (!this.intersectsGizmo) {
        const intersect = this.raycastMouseOnObject(e);
        if (!intersect) return;
        const objPos = this.carpetMesh.position.clone();
        const sub = intersect.point.sub(this.offset);
        sub.y = objPos.y;
        const subClamped = sub.clone();
        if (this.bounds) {
          this.bounds.clampPoint(sub, subClamped);
        }
        this.carpetMesh.position.copy(subClamped);
        this.render();
        this.updateGizmo();
      } else {
        const difference = this.prev.x - e.x;
        //console.log(difference)
        this.carpetMesh.rotation.z -= (difference * Math.PI) / 180;
        this.prev = { ...e };
        this.render();
      }
    } else {
      const difference = this.prev.y - e.y;
      this.adjustCameraAngle(false, difference);
      this.prev = { ...e };
    }
  }
  getRendererOffset() {
    var offsetY = this.renderer.domElement.offsetTop;
    var offsetX = this.renderer.domElement.offsetLeft;
    return { offsetX, offsetY };
  }
  raycastMouseOnObject(e) {
    const mouse = this.convMouseCord(e);
    raycaster.setFromCamera(mouse, this.camera);
    var intersects = raycaster.intersectObject(this.carpetMesh);
    return intersects[0];
  }
  convMouseCord(e) {
    const vec = new THREE.Vector2();
    this.renderer.getSize(vec);
    const { x, y } = vec;
    // const { offsetX, offsetY } = this.getRendererOffset();
    const mouseX = (e.x / x) * 2 - 1;
    const mouseY = -(e.y / y) * 2 + 1;
    return new THREE.Vector2(mouseX, mouseY);
  }
  getCarpetPositions() {
    this.carpetMesh.geometry.computeBoundingBox();
    const box = this.carpetMesh.geometry.boundingBox;

    // Use pooled vectors to avoid allocations
    const vertex1 = this._vector3Pool.v1.copy(box.min);
    const vertex2 = this._vector3Pool.v2.copy(box.max);
    const max =
      vertex2.x - vertex1.x > vertex2.y - vertex1.y ? vertex2.x - vertex1.x : vertex2.y - vertex1.y;

    // Reuse or create temporary mesh for position calculations
    if (!this._tempPositionMesh) {
      const invi = new THREE.PlaneGeometry(max, max);
      const invMat = new THREE.MeshBasicMaterial();
      this._tempPositionMesh = new THREE.Mesh(invi, invMat);
    } else {
      // Update geometry size if needed
      const currentSize = this._tempPositionMesh.geometry.parameters.width;
      if (Math.abs(currentSize - max) > 0.01) {
        this._tempPositionMesh.geometry.dispose();
        this._tempPositionMesh.geometry = new THREE.PlaneGeometry(max, max);
      }
    }

    const invMesh = this._tempPositionMesh;
    invMesh.position.copy(this.carpetMesh.position);
    invMesh.rotation.copy(this.carpetMesh.rotation);

    if (this.carpetRatio.w < 1.25) {
      invMesh.scale.y = this.carpetMesh.scale.x / 0.8;
      invMesh.scale.x = this.carpetMesh.scale.x;
    } else {
      invMesh.scale.x = this.carpetMesh.scale.y * 0.8;
      invMesh.scale.y = this.carpetMesh.scale.y;
    }

    invMesh.updateMatrix();
    invMesh.updateMatrixWorld();

    const position = invMesh.geometry.attributes.position;
    const vector = this._vector3Pool.v3;
    const size = this._vector2Pool.v1;
    this.renderer.getSize(size);

    const temparray = [];
    for (let i = 0, l = position.count; i < l; i++) {
      vector.fromBufferAttribute(position, i);
      vector.applyMatrix4(invMesh.matrixWorld);
      const canvasVertex = createVector(
        vector,
        this.camera,
        size.width,
        size.height
      );
      temparray.push({
        x: this.getResizedImageCoordinatesX(canvasVertex.x),
        y: this.getResizedImageCoordinatesY(canvasVertex.y)
      });
    }
    // console.log(vertices);
    // vertices = [vertices[0], vertices[1], vertices[3], vertices[2]];
    // const temparray = [];
    // vertices.forEach(vertex => {
    //   vertex.applyMatrix4(invMesh.matrixWorld);
    //   const canvasVertex = createVector(
    //     vertex,
    //     this.camera,
    //     this.renderer.getSize().width,
    //     this.renderer.getSize().height
    //   );
    //   temparray.push({
    //     x: this.getResizedImageCoordinatesX(canvasVertex.x),
    //     y: this.getResizedImageCoordinatesY(canvasVertex.y)
    //   });
    // });
    this.myRoomPointsOBJ.carpetpoints = temparray;
  }

  updateGizmo(options = {}) {
    const { show = true } = options;
    if (!this.gizmoCanvas || !this.carpetMesh) return;
    const context = this.gizmoCanvas.getContext("2d");
    const { width, height } = this.gizmoCanvas;
    if (!show) {
      clearCanvas(this.gizmoCanvas, width, height);
      return;
    }
    const carpetSize = this.calculateCarpetSize();
    const smallerDim = carpetSize.x > carpetSize.y ? carpetSize.x : carpetSize.y;
    const carpetRadius = smallerDim / 5;
    const carpetCenter = this.carpetMesh.position.clone();

    const vertex1 = carpetCenter.clone();
    const vertex2 = new THREE.Vector3(
      carpetCenter.x,
      carpetCenter.y,
      carpetCenter.z + carpetRadius
    );

    const dist1 = this.distbetween2Vertices(vertex1, vertex2);
    const radYY = dist1.yDist;
    const radYX = dist1.xDist;

    const vertex3 = new THREE.Vector3(
      carpetCenter.x + carpetRadius,
      carpetCenter.y,
      carpetCenter.z
    );
    //TODO:this could be point of failure
    const vertex4 = carpetCenter.clone();
    const dist2 = this.distbetween2Vertices(vertex3, vertex4);
    const radXX = dist2.xDist;
    const radXY = dist2.yDist;

    const area1 = areaOfellipse(radYY, radXX);
    const area2 = areaOfellipse(radXY, radYX);
    let radX, radY;
    if (area1 > area2) {
      radX = radXX;
      radY = radYY;
    } else {
      radX = radXY;
      radY = radYX;
    }
    const diamondHeight = 10;
    const canvasCenter = createVector(carpetCenter, this.camera, width, height);

    const rgb = {
      r: 250,
      g: 250,
      b: 250,
      a: 0.8
    };
    const colorStr = "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + rgb.a + ")";
    var radiusX;
    var radiusY;
    if (radX > radY) {
      radiusX = radX;
      radiusY = radY;
    } else {
      radiusX = radY;
      radiusY = radX;
    }
    // Draw the ellipse
    context.strokeStyle = colorStr;
    context.fillStyle = colorStr;
    context.lineWidth = 1;
    context.shadowOffsetX = 0;
    context.shadowColor = "black";
    context.shadowOffsetY = 1;
    context.clearRect(0, 0, width, height);
    context.beginPath();
    context.ellipse(canvasCenter.x, canvasCenter.y, radiusX, radiusY, 0, 0, 2 * Math.PI);
    context.stroke();
    context.beginPath();
    context.moveTo(canvasCenter.x, canvasCenter.y + radiusY - 5);
    context.lineTo(canvasCenter.x + diamondHeight, canvasCenter.y + radiusY);
    context.lineTo(canvasCenter.x, canvasCenter.y + radiusY + 5);
    context.lineTo(canvasCenter.x - diamondHeight, canvasCenter.y + radiusY);
    context.fill();
  }
  findGizmoIntersection(e) {
    const { x, y } = e;
    if (!this.gizmoCanvas) return;
    var imgData = this.gizmoCanvas.getContext("2d").getImageData(x - 10, y - 10, 20, 20);
    var ingizmo = false;
    for (var i = 0; i < imgData.data.length; i += 4) {
      if (imgData.data[i + 3] !== 0) {
        ingizmo = true;
        break;
      }
    }
    return ingizmo;
  }
  autoLevel(bgCanvas, maskCanvas) {
    this.origBG = bgCanvas.toDataURL();
    const { width, height } = this.renderer.getSize();

    const canvas = createCanvas(width, height);
    var ctx = canvas.getContext("2d");
    ctx.drawImage(bgCanvas, 0, 0, width, height);
    var imgData = ctx.getImageData(0, 0, width, height);
    var pixelNum = imgData.data.length;

    //initialize brightness for levels
    var redMax = 0;
    var redMin = 255;
    var greenMax = 0;
    var greenMin = 255;
    var blueMax = 0;
    var blueMin = 255;

    for (var i = 0; i < pixelNum; i += 4) {
      //set min and max values for each color
      if (imgData.data[i] > redMax) {
        redMax = imgData.data[i];
      }
      if (imgData.data[i] < redMin) {
        redMin = imgData.data[i];
      }
      if (imgData.data[i + 1] > greenMax) {
        greenMax = imgData.data[i + 1];
      }
      if (imgData.data[i + 1] < greenMin) {
        greenMin = imgData.data[i + 1];
      }
      if (imgData.data[i + 2] > blueMax) {
        blueMax = imgData.data[i + 2];
      }
      if (imgData.data[i + 2] < blueMin) {
        blueMin = imgData.data[i + 2];
      }
    }

    for (var j = 0; j < pixelNum; j += 4) {
      //map colors to 0 - 255 range
      imgData.data[j] = (imgData.data[j] - redMin) * (255 / (redMax - redMin));
      imgData.data[j + 1] = (imgData.data[j + 1] - greenMin) * (255 / (greenMax - greenMin));
      imgData.data[j + 2] = (imgData.data[j + 2] - blueMin) * (255 / (blueMax - blueMin));
    }
    ctx.putImageData(imgData, 0, 0);
    bgCanvas.getContext("2d").drawImage(canvas, 0, 0);
    var imgDataCopy = imgData.valueOf();

    var maskCanvas1 = createCanvas(width, height);
    var maskContext = maskCanvas1.getContext("2d");
    readImage(this.roomdataurl).then(image => {
      maskContext.drawImage(image, 0, 0, width, height);
      var maskData = maskContext.getImageData(0, 0, width, height);
      for (var k = 0; k < maskData.data.length; k += 4) {
        imgDataCopy.data[k + 3] = maskData.data[k + 3];
      }
      maskContext.putImageData(imgDataCopy, 0, 0);
      //maskUrl = maskCanvas.toDataURL();
      maskCanvas.width = width;
      maskCanvas.height = height;
      maskCanvas.getContext("2d").drawImage(maskCanvas1, 0, 0, width, height);
    });
  }

  undoAutoLevel(bgCanvas, maskCanvas) {
    readImage(this.origBG).then(origImage => {
      bgCanvas.getContext("2d").drawImage(origImage, 0, 0);
    });

    const { width, height } = this.renderer.getSize();
    var maskContext = maskCanvas.getContext("2d");
    readImage(this.roomdataurl).then(image => {
      maskCanvas.width = width;
      maskCanvas.height = height;
      clearCanvas(maskCanvas, width, height);
      maskContext.drawImage(image, 0, 0, width, height);
    });
  }
  markFF(x, y, inputCanvas, inputSelected) {
    if (inputSelected === "eraser") {
      this.removePoint(inputCanvas, x, y);
    } else {
      var markingColor = inputSelected === "floor" ? "#FF0000" : "#00FF00";
      this.markWithColor(inputCanvas, markingColor, x, y);

      inputSelected === "floor" ? this.pushFloorPoints(x, y) : this.pushFurniPoints(x, y);
    }
  }

  markWithColor(inputCanvas, MarkingColor, x, y) {
    var contextInputMarks = inputCanvas.getContext("2d");
    contextInputMarks.moveTo(x, y);
    contextInputMarks.fillStyle = MarkingColor;
    contextInputMarks.beginPath();
    contextInputMarks.arc(x, y, 2, 0, 2 * Math.PI, false);
    contextInputMarks.fill();
    contextInputMarks.closePath();
  }
  isLastPoint(pointsList, ptX, ptY) {
    //var pointsList =  myroomInputSelected === "floor" ? myRoomPointsOBJ.floorpoints : myRoomPointsOBJ.notfloorpoints;

    if (pointsList.length) {
      var lastPt = pointsList[pointsList.length - 1];
      if (lastPt.x !== ptX || lastPt.y !== ptY) {
        return false;
      } else return true;
    } else return false;
  }

  pushFloorPoints(x, y) {
    x = this.getResizedImageCoordinatesX(x);
    y = this.getResizedImageCoordinatesY(y);
    const pointsList = this.myRoomPointsOBJ.floorpoints;
    if (!this.isLastPoint(pointsList, x, y)) {
      this.myRoomPointsOBJ.floorpoints.push({
        x: x,
        y: y
      });
    }
  }

  pushFurniPoints(x, y) {
    x = this.getResizedImageCoordinatesX(x);
    y = this.getResizedImageCoordinatesY(y);
    const pointsList = this.myRoomPointsOBJ.notfloorpoints;
    if (!this.isLastPoint(pointsList, x, y)) {
      this.myRoomPointsOBJ.notfloorpoints.push({
        x: x,
        y: y
      });
    }
  }

  removePoint(inputCanvas, x, y) {
    x = this.getResizedImageCoordinatesX(x);
    y = this.getResizedImageCoordinatesY(y);
    function isFarEnough(point) {
      const a = x - point.x;
      const b = y - point.y;
      const dist = Math.sqrt(a * a + b * b);
      return dist >= 30;
    }
    this.myRoomPointsOBJ.notfloorpoints = this.myRoomPointsOBJ.notfloorpoints.filter(isFarEnough);
    this.myRoomPointsOBJ.floorpoints = this.myRoomPointsOBJ.floorpoints.filter(isFarEnough);
    this.drawFFPoints(inputCanvas);
  }
  drawFFPoints(inputCanvas) {
    var contextInputMarks = inputCanvas.getContext("2d");
    contextInputMarks.clearRect(0, 0, inputCanvas.width, inputCanvas.height);

    this.colorPoints(inputCanvas, this.myRoomPointsOBJ.floorpoints, "#FF0000");
    this.colorPoints(inputCanvas, this.myRoomPointsOBJ.notfloorpoints, "#00FF00");
  }
  colorPoints(inputCanvas, points, markingColor) {
    for (var i = 0; i < points.length; i++) {
      this.markWithColor(
        inputCanvas,
        markingColor,
        this.getInputCanvasCoordinatesX(points[i].x),
        this.getInputCanvasCoordinatesY(points[i].y)
      );
    }
  }
  updatePointHistory() {
    this.pointsHistory.floorpoints = this.myRoomPointsOBJ.floorpoints;
    this.pointsHistory.notfloorpoints = this.myRoomPointsOBJ.notfloorpoints;
    this.pointsHistory.inputSelected = this.myroomInputSelected;
    this.pointsHistoryArray.push(JSON.stringify(this.pointsHistory));
  }
  pointsHistoryReset() {
    this.myRoomPointsOBJ.floorpoints = [];
    this.myRoomPointsOBJ.notfloorpoints = [];
    this.pointsHistoryArray = [];
  }
  undoPoints(inputCanvas) {
    if (this.pointsHistoryArray.length > 0) {
      this.pointsHistoryArray.pop();
      if (this.pointsHistoryArray.length === 0) {
        //unselect floor,furniture and select floor
        this.myRoomPointsOBJ.floorpoints = [];
        this.myRoomPointsOBJ.notfloorpoints = [];
        this.drawFFPoints(inputCanvas);
        //getOutputMask();
        return;
      } else {
        this.pointsHistory = JSON.parse(
          this.pointsHistoryArray[this.pointsHistoryArray.length - 1]
        );
        this.myRoomPointsOBJ.floorpoints = this.pointsHistory.floorpoints;
        this.myRoomPointsOBJ.notfloorpoints = this.pointsHistory.notfloorpoints;
        this.drawFFPoints(inputCanvas);
        //getOutputMask
      }
    } else {
    }
  }
  resetPoints(inputCanvas) {
    this.pointsHistoryReset();
    this.drawFFPoints(inputCanvas);
    clearCanvas(inputCanvas, inputCanvas.width, inputCanvas.height);
    //upload white mask
  }
  getResizedImageCoordinatesX(x) {
    return Math.round(x * this.ratioWid);
  }

  getResizedImageCoordinatesY(y) {
    return Math.round(y * this.ratioHgt);
  }

  getInputCanvasCoordinatesX(x) {
    return Math.round(x / this.ratioWid);
  }

  getInputCanvasCoordinatesY(y) {
    return Math.round(y / this.ratioHgt);
  }
  resize(windowSize) {
    if (!this.canvasInitiated) return;
    const rendererSize = new THREE.Vector2();
    this.renderer.getSize(rendererSize);


    const { width, height } = resizeKeepingAspect(this.bgImage, windowSize);

    this.bgCanvas.style.width = `${width}px`;
    this.bgCanvas.style.height = `${height}px`;

    this.maskCanvas.style.width = `${width}px`;
    this.maskCanvas.style.height = `${height}px`;

    this.inputCanvas.width = width;
    this.inputCanvas.height = height;

    this.gizmoCanvas.width = width;
    this.gizmoCanvas.height = height;
    this.resizeRenderer(width, height);
    this.updateGizmo();
  }
  resizeRenderer(width, height) {
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.setSize(width, height);
    this.ratioWid = this.origWid / width;
    this.ratioHgt = this.origHgt / height;
    this.render();
  }
  calculateCarpetSize() {
    this.carpetMesh.geometry.computeBoundingBox();
    const carpetSize = new THREE.Vector3();
    this.carpetMesh.geometry.boundingBox.getSize(carpetSize);
    return carpetSize;
  }

  calculateCameraWidth() {
    const carpetSize = this.calculateCarpetSize();
    const siz = new THREE.Vector2();
    this.renderer.getSize(siz);
    const { x: width, y: height } = siz;
    const carpetWid = carpetSize.x > carpetSize.y ? carpetSize.x : carpetSize.y;
    if (width >= height) {
      return carpetWid * 1.1;
    } else {
      return carpetWid * 1.2;
    }
  }
  distbetween2Vertices(vertex1, vertex2, axis) {
    const { camera, renderer } = this;
    const vec = new THREE.Vector2();
    renderer.getSize(vec);
    const { x: width, y: height } = vec;
    const v1 = createVector(vertex1, camera, width, height);
    const v2 = createVector(vertex2, camera, width, height);
    const xDist = Math.abs(Math.abs(v2.x) - Math.abs(v1.x));
    const yDist = Math.abs(Math.abs(v2.y) - Math.abs(v1.y));
    return { xDist: xDist, yDist: yDist };
  }
  calculateVerticalHeight() {
    const carpetSize = this.calculateCarpetSize();
    const x = carpetSize.x,
      y = carpetSize.y;
    const vertex1 = new THREE.Vector3(-x / 2, 0, 0);
    const vertex2 = new THREE.Vector3(x / 2, 0, 0);
    const vertex3 = new THREE.Vector3(0, 0, y / 2);
    const vertex4 = new THREE.Vector3(0, 0, -y / 2);
    const h1 = this.distbetween2Vertices(vertex1, vertex2);
    const h2 = this.distbetween2Vertices(vertex3, vertex4);
    const height = h1.yDist > h2.yDist ? h1.yDist : h2.yDist;
    return height;
  }
  angleBetween2Vertices(vertex1, vertex2) {
    const { camera } = this;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const v1 = createVector(vertex1, camera, size.width, size.height);
    const v2 = createVector(vertex2, camera, size.width, size.height);
    const slope = (v2.y - v1.y) / (v2.x - v1.x);
    return (Math.atan(slope) * 180) / Math.PI;
  }
  changeCameraDist(width, fovDeg) {
    var fovrad = (fovDeg * Math.PI) / 180;
    const distance = width / (2 * Math.tan(fovrad / 2));
    const { camera, orbit } = this;
    let x1 = camera.position.x;
    let y1 = camera.position.y;
    let z1 = camera.position.z;
    const cur_dist = Math.sqrt(
      camera.position.x * camera.position.x +
      camera.position.y * camera.position.y +
      camera.position.z * camera.position.z
    );
    const dist = distance; // + $('#renderer-canvas').width()/2;
    const dist_ratio = dist / cur_dist;
    let x2 = dist_ratio * x1;
    let y2 = dist_ratio * y1;
    let z2 = dist_ratio * z1;
    orbit.object.position.set(x2, y2, z2);
    orbit.update();
    this.render();
  }
  calculateAngle1() {
    const vertex1 = new THREE.Vector3(0, 0, -500);
    const vertex2 = new THREE.Vector3(0, 0, 500);
    return this.angleBetween2Vertices(vertex1, vertex2);
  }
  calculateAngle2() {
    const vertex1 = new THREE.Vector3(400, 0, 0);
    const vertex2 = new THREE.Vector3(-400, 0, 0);
    const angle2deg = this.angleBetween2Vertices(vertex1, vertex2);
    let angle2act = 180 - Math.abs(angle2deg);
    return angle2act;
  }
  resetOrbit(x = 0, y = 0) {
    const { orbit, camera } = this;
    orbit.reset();

    const width = this.calculateCameraWidth();
    this.changeCameraDist(width, camera.fov);
    orbit.pan(x, y);
    orbit.update();
  }
  setinitialOrientation(res) {
    // Store room analysis data for carpet positioning
    this.roomAnalysisData = res;

    this.orbit.reset();
    this.camera.position.set(0, 0, 720);
    this.orbit.update();

    let fov = parseFloat(res.fov);
    if (fov < 30) fov = 30;
    if (fov > 60) fov = 60;

    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.render();

    const width = this.calculateCameraWidth();
    this.changeCameraDist(width, fov);

    const hor_rot = ((90 - res.orientation.hor) * Math.PI) / 180;
    // this.orbit.rotateLeft(-hor_rot);
    this.orbit.setAzimuthalAngle(-hor_rot);
    this.orbit.update();
    const vert_rot = (10 * Math.PI) / 180;
    // this.orbit.rotateUp(vert_rot);
    this.orbit.setPolarAngle(vert_rot);
    this.orbit.update();
    this.orbit.pan(res.floor_center.x, res.floor_center.y);
    this.orbit.update(); // orbit.pan(    //   res.floor_center.x * resizeRatio.w,    //   res.floor_center.y * resizeRatio.h    // );    // orbit.update();

    const angle1pred = Math.abs(res.orientation.hor);
    const angle2pred = Math.abs(res.orientation.vert);

    const global_iter_limit = 100;
    const iter_limit = 50;
    var index = 0;

    if (res.orientation.exception) {
      if (!res.orientation.flag) {
        this.orbit.rotateLeft(Math.PI / 2);
        this.orbit.update();
      }
    } else {
      var vertical_error = calcError(this.calculateAngle2(), angle2pred);
      var horizontal_error = calcError(this.calculateAngle1(), angle1pred);
      var hor_angle_per_step = 1;
      var vert_angle_per_step = 1;
      const decay_rate = 0.5;

      const optimizeVertically = vert_angle_per_step => {
        let index1 = 0;
        let index2 = 0;

        let angle2 = Math.abs(this.calculateAngle2());
        let vert_angle;
        if (angle2 < 90) {
          vert_angle = -vert_angle_per_step.valueOf();
        } else {
          vert_angle = vert_angle_per_step.valueOf();
        }
        while (angle2 > angle2pred) {
          this.orbit.rotateUp(THREE.MathUtils.degToRad(vert_angle));
          this.orbit.update();

          angle2 = Math.abs(this.calculateAngle2());
          index1++;
          if (index1 === iter_limit) break;
        }
        while (angle2 < angle2pred) {
          this.orbit.rotateUp(THREE.MathUtils.degToRad(-vert_angle));
          this.orbit.update();

          angle2 = Math.abs(this.calculateAngle2());

          index2++;
          if (index2 === iter_limit) break;
        }
      };

      const optimizeHorizontally = hor_angle_per_step => {
        let angle1 = Math.abs(this.calculateAngle1());

        let index1 = 0;
        let index2 = 0;
        while (angle1 < angle1pred) {
          this.orbit.rotateLeft(THREE.MathUtils.degToRad(hor_angle_per_step));
          this.orbit.update();
          angle1 = Math.abs(this.calculateAngle1());
          index1++;
          if (index1 === iter_limit) break;
        }
        while (angle1 > angle1pred) {
          this.orbit.rotateLeft(THREE.MathUtils.degToRad(-hor_angle_per_step));
          this.orbit.update();
          angle1 = Math.abs(this.calculateAngle1());
          index2++;
          if (index2 === iter_limit) break;
        }
      };

      while (vertical_error > 0.1 || horizontal_error > 2) {
        optimizeHorizontally(hor_angle_per_step);
        optimizeVertically(vert_angle_per_step);

        vertical_error = calcError(this.calculateAngle2(), angle2pred);
        horizontal_error = calcError(this.calculateAngle1(), angle1pred);
        index++;

        hor_angle_per_step = hor_angle_per_step * decay_rate;
        vert_angle_per_step = vert_angle_per_step * decay_rate;
        if (index === global_iter_limit) {
          break;
        }
      }
      this.orbit.update();
      if (!res.orientation.flag) {
        this.orbit.rotateLeft(Math.PI / 2);
        this.orbit.update();
      }
      var size = new THREE.Vector2();
      this.renderer.getSize(size);

      var verticalHeight = this.calculateVerticalHeight();
      while (verticalHeight < 0.15 * size.height) {
        this.orbit.rotateUp((0.5 * Math.PI) / 180);
        this.orbit.update();
        verticalHeight = this.calculateVerticalHeight();
      }

      function calcError(predicted, actual) {
        return (Math.abs(Math.abs(predicted) - actual) / actual) * 100;
      }

      this.orbit.update();
    }
    this.render();
    // const width = ;
    this.changeCameraDist(this.calculateCameraWidth(), fov);
    this.render();
    // addRotationGizmo();
  }

  removemeshes() {
    this.carpetMesh.material.opacity = 1;
    this.render();
  }
  saveAsRoom({ mode, roomId, file, props }) {
    this.getCarpetPositions();
    const carpetpoints = this.myRoomPointsOBJ.carpetpoints;
    const floorpoints = this.myRoomPointsOBJ.floorpoints;
    const notfloorpoints = this.myRoomPointsOBJ.notfloorpoints;
    return AppProvider.saveAsRoom({
      mode,
      roomId,
      file,
      props,
      floorpoints,
      notfloorpoints,
      carpetpoints
    }).then(response => {
      return { response };
    });
  }

  downloadImage(downloadBLob, filename) {
    return new Promise((resolve, reject) => {
      var url = window.URL || window.webkitURL;
      const imageSrc = url.createObjectURL(downloadBLob);
      var strData = imageSrc; // window.URL.createObjectURL(downloadBLob);
      var link = document.createElement("a");
      document.body.appendChild(link); //Firefox requires the link to be in the body
      link.setAttribute("download", filename);
      link.href = strData;
      if (navigator.msSaveOrOpenBlob) {
        navigator.msSaveOrOpenBlob(downloadBLob, filename);
      } else {
        link.click();
      }
      document.body.removeChild(link); //remove the link when done
      resolve(strData);
    });
  }
  saveAsImage = async ({ bgCanvas, maskCanvas, designPath }) => {
    this.carpetMesh.material.opacity = 1;
    this.removemeshes();
    var strMime = "image/png";
    let imgData = this.renderer.domElement.toDataURL(strMime);

    readImage(imgData).then(rendererImage => {
      var downloadCanvas = createCanvas(rendererImage.width, rendererImage.height);
      var downloadContext = downloadCanvas.getContext("2d");
      downloadContext.drawImage(bgCanvas, 0, 0, rendererImage.width, rendererImage.height);
      downloadContext.drawImage(rendererImage, 0, 0, rendererImage.width, rendererImage.height);
      downloadContext.drawImage(maskCanvas, 0, 0, rendererImage.width, rendererImage.height);

      if (window.flags.inhouseChanges.saveFunctionForFlutter) {
        window.getByteData = downloadCanvas.toDataURL("image/jpeg", 0.95);
        return;
      }

      canvasToBlobPromise(downloadCanvas).then(downloadBLob => {
        var name = "customdesign";
        if (!window.initialData.customDesignUrl) {
          const filenames = designPath.split("/");
          const filename = filenames.pop();
          const shorts = filename.split(".");
          name = shorts[0];
        }
        this.downloadImage(downloadBLob, name + "-myroom.jpg").then(dataurl => {
          //if (globalMode === "marking") {carpetMesh.material.opacity = 0.5;}
          this.carpetMesh.material.opacity = 1;
          this.render();
        });
      });
    });
  };

  // handleSuccess = (stream) =>{
  //   //$("#MyRoomTakePhotoArea").show();
  //   const myroomVideo = document.getElementById('MyRoomvideo');
  //   const videoTracks = stream.getVideoTracks();
  //   window.stream = stream; // make variable available to browser console
  //   myroomVideo.srcObject = stream;
  //   localVideoStream =stream;
  //   myroomVideo.play();
  //   myroomVideoPlaying = true;
  // }
  // handleError = (error) => {
  //   if (error.name === 'ConstraintNotSatisfiedError') {
  //     var v = this.constraints.video;
  //     this.errorMsg("The resolution ".concat(v.width.exact, "x").concat(v.height.exact, " px is not supported by your device."));
  //   } else if (error.name === 'PermissionDeniedError') {
  //    this.errorMsg('Permissions have not been granted to use your camera and ' + 'microphone, you need to allow the page access to your devices in ' + 'order for the demo to work.');
  //   }
  //   this.errorMsg("getUserMedia error: ".concat(error.name), error);
  // }
  // errorMsg = (msg, error)=> {
  //   //const errorElement = document.querySelector('#errorMsg');
  //   //errorElement.innerHTML += `<p>${msg}</p>`;
  //   //if (typeof error !== 'undefined') {
  //     console.error(msg);
  //   //}
  // }

  // initCam =(e)=> {
  //   // Older browsers might not implement mediaDevices at all, so we set an empty object first
  //   if (navigator.mediaDevices === undefined) {
  //     navigator.mediaDevices = {};
  //   }
  //   // Some browsers partially implement mediaDevices. We can't just assign an object
  //   // with getUserMedia as it would overwrite existing properties.
  //   // Here, we will just add the getUserMedia property if it's missing.
  //   if (navigator.mediaDevices.getUserMedia === undefined) {
  //     navigator.mediaDevices.getUserMedia = function(constraints) {
  //       // First get ahold of the legacy getUserMedia, if present
  //       var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  //       // Some browsers just don't implement it - return a rejected promise with an error
  //       // to keep a consistent interface
  //       if (!getUserMedia) {
  //         return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
  //       }
  //       // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
  //       return new Promise(function(resolve, reject) {
  //         getUserMedia.call(navigator, constraints, resolve, reject);
  //       });
  //     }
  //   }
  //   navigator.mediaDevices.getUserMedia(constraints)
  //   .then(function(stream) {
  //     handleSuccess(stream);
  //   })
  //   .catch(function(err) {
  //     handleError(err);
  //   });
  // }

  dispose() {
    // Clean up Three.js resources
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }

    if (this.orbit) {
      this.orbit.dispose();
      this.orbit = null;
    }

    if (this.carpetMesh) {
      if (this.carpetMesh.geometry) {
        this.carpetMesh.geometry.dispose();
      }
      if (this.carpetMesh.material) {
        if (this.carpetMesh.material.map) {
          this.carpetMesh.material.map.dispose();
        }
        this.carpetMesh.material.dispose();
      }
      this.carpetMesh = null;
    }

    // Clean up temporary mesh used in getCarpetPositions
    if (this._tempPositionMesh) {
      if (this._tempPositionMesh.geometry) {
        this._tempPositionMesh.geometry.dispose();
      }
      if (this._tempPositionMesh.material) {
        this._tempPositionMesh.material.dispose();
      }
      this._tempPositionMesh = null;
    }

    if (this.scene) {
      this.scene.clear();
      this.scene = null;
    }

    this.camera = null;
    this.textureLoader = null;
    this.roomAnalysisData = null;

    // Clear caches
    this._cachedFloorBounds = null;
    this._cachedCarpetDims = null;
  }
}
