/* eslint-disable no-useless-escape */
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useRef, useState } from "react";
import MyRoomHelper from "./myroomhelper";
import { getCroppedSize, resizeKeepingAspect } from "../../../utils/utils";

import { readImage } from "../../../utils/domUtils";
import { useWindowSize } from "react-use";
import InputCanvas from "../../atoms/InputCanvas";
import classNames from "classnames";
import {
  useMyroomState,
  useMyroomDispatch,
  controlModes,
  myRoomActions
} from "../../../reducers/myroom.reducer";
import { useUiDispatch, mainUiActions, pageViews } from "../../../reducers/mainui.reducer";

import {
  useDispatchDesignDetail,
  designDetailActions,
  useDesignDetailState
} from "../../../reducers/designdetails.reducer";
import TileCanvas from "../../../tilecanvasnew";
import { Portal, ButtonGroup, Toaster, Toast } from "@blueprintjs/core";
import AtButton from "../../atoms/AtButton";
import AppProvider, { CDN_domain } from "../../../api/appProvider";
import loadImage from "blueimp-load-image";
import { isMobileDevice } from "../../../utils/utils";
import {
  clearCanvas,
  canvasToBlobPromise,
  createCanvas,
  cropStitchCanvas
} from "../../../utils/canvasutils";

import AtIcon from "../../atoms/AtIcon";
import "./myroom.scss";
import SaveroomDialog from "./SaveroomDialog";
import InputButton from "../../atoms/AtButton/InputButton";
import MyroomWebcam from "./MyroomWebcam";
import MyRoomIceBreaker from "./MyRoomIceBreaker";
import strings from "../../../strings";
const myRoomHelper = new MyRoomHelper();
const zoom = 1;
const tileCanvas = new TileCanvas();

// let myroomImageSrc = "myroom/images/JustMarried.jpg";
// let defaultRoomImage = ;
// let defaultmyRoomMask = "myroom/images/myroomMask.png";
// let defaultMask512 = "myroom/images/bnwMask512.png";
// // let defaultWMask512 = "myroom/images/wMask512.png";
// let fbxUrl = "myroom/images/Binding.FBX";
let carpetInitialPositionX, carpetInitialPositionY;
const baseUrl = CDN_domain + "v3assets/myroom/images";
const myRoomConfig = {
  bgImageUrl: `${baseUrl}/MyRoom.jpg`,
  maskUrl: `${baseUrl}/myroomMask.png`,
  mask512Url: `${baseUrl}/bnwMask512.png`,
  fbxUrl: `${baseUrl}/Binding.FBX`
};
const MyRoom = () => {
  const dispatchUiState = useUiDispatch();
  const containerRef = useRef();
  const rendererRef = useRef();
  const bgCanvasRef = useRef();
  const maskCanvasRef = useRef();
  const inputCanvasRef = useRef();
  const gizmoCanvasRef = useRef();
  const inputRef = useRef(null);

  const { width: windowWidth, height: windowHeight } = useWindowSize();

  const [toastProps, setToastProps] = useState(null);
  const [roomId, setroomId] = useState(null);
  const [isAutoLeveled, setIsAutoLeveled] = useState(false);
  const [myroomInputSelected, setMyroomInputSelected] = useState("floor");
  const [origMaskUrl, setOrigMaskUrl] = useState(null);
  const [origMask512, setOrigMask512] = useState(null);
  const [openSaveDialog, setOpenSaveDialog] = useState(false);
  const [isRoomSaved, setIsRoomSaved] = useState(false);
  const [showCamOptions, setShowCamOptions] = useState(false);
  const [openCam, setOpenCam] = useState(false);

  const [loadIceBreaker, setLoadIceBreaker] = useState(
    window.flags.visualizations.showIcebreakerinMyroom &&
    (!sessionStorage.getItem("myroomimage") ||
      sessionStorage.getItem("myroomimage") === "undefined")
  );
  let AImaskLoaded = true;
  let DesignLoaded = false;

  const myRoomState = useMyroomState();
  const designDetailState = useDesignDetailState();
  const dispatchDesignDetails = useDispatchDesignDetail();
  const dispatchMyRoom = useMyroomDispatch();
  const { fullpath: designPath, designDetails, hash, designDimsOrig } = designDetailState;
  const windowSize = useWindowSize();
  const cameraButtonsInStage = window.flags.homeTemplate === pageViews.STEPPER;
  const myRoomControlsPortalID =
    window.flags.homeTemplate === pageViews.STEPPER || window.flags.homeTemplate === pageViews.HOME
      ? "left-sidebar"
      : "room-view-container";
  useEffect(() => {
    if (!loadIceBreaker) {
      const containerDims = {
        width: windowSize.width,
        height: window.flags.homeTemplate != pageViews.CREATEYOURRUG
          ? windowHeight
          : containerRef.current.getBoundingClientRect().height
      };

      myRoomHelper.resize(containerDims);
    }
  }, [windowSize]);
  useEffect(() => {
    if (loadIceBreaker) {
      //mainUi  hide both the side panels
      dispatchUiState({
        type: mainUiActions.SET_SHOW_SIDEBAR,
        payload: { left: false, right: false }
      });
    }
  }, [loadIceBreaker]);
  useEffect(() => {
    setLoading(true);
    myRoomHelper.initCanvas({
      bgCanvas: bgCanvasRef.current,
      rendererCanvas: rendererRef.current,
      maskCanvas: maskCanvasRef.current,
      gizmoCanvas: gizmoCanvasRef.current,
      inputCanvas: inputCanvasRef.current,
      container: containerRef.current
    });
    const myroomimage = sessionStorage.getItem("myroomimage");
    const mode = sessionStorage.getItem("mode");
    if (myroomimage && myroomimage !== "" && myroomimage !== "undefined" && mode === "myroom") {
      loadFromImageUrl(myroomimage);
    } else {
      load();
    }
  }, []);

  const load = async () => {
    if (loadIceBreaker) {
      return;
    }
    const bgImage = await readImage(myRoomConfig.bgImageUrl);
    const { width, height } = resizeKeepingAspect(bgImage, {
      width: windowWidth,
      height: windowHeight
    });
    myRoomHelper.updateBackground({ bgImage, width, height });
    myRoomHelper.initScene({ dims: { width, height }, config: myRoomConfig });

    setCanvasWidHgt(inputCanvasRef, width, height, gizmoCanvasRef);

    myRoomHelper.updateMask({
      maskUrl: myRoomConfig.maskUrl,
      maskCanvas: maskCanvasRef.current,
      bgCanvas: bgCanvasRef.current,
      width,
      height
    });
    myRoomHelper.resizeRenderer(width, height);
    setOrigMaskUrl(myRoomConfig.maskUrl);
    setOrigMask512(myRoomConfig.mask512Url);
    const roomId = await uploadRoom();
    await myRoomHelper.uploadMask({ maskUrl: myRoomConfig.mask512Url, roomId });
    loadDesignCanvas();
  };

  const onCameraCapture = src => {
    loadFromImageUrl(src);
    setOpenCam(false);
  };
  const loadFromImageUrl = async myroomImageSrc => {
    loadImage.parseMetaData(myroomImageSrc, data => {
      readImage(myroomImageSrc).then(
        async img => {
          const tmpCanvas = createCanvas(img.width, img.height);
          tmpCanvas.getContext("2d").drawImage(img, 0, 0, img.width, img.height);
          loadMyRoomFromCanvas({ canvas: tmpCanvas, initScene: true, containerRef });
        },
        error => {
          console.log(error);
        }
      );
    });
  };
  const onMyRoomLoadComplete = () => {
    setTimeout(() => {
      myRoomHelper.updateMap();
      setLoading(false);
      // this loads the myroom ui when myroomimage is loadded from session
      setTimeout(() => {
        if (!AImaskLoaded) setLoading(true);
      }, 100);
    }, 150);
  };

  const repeatDesignForOverSize = ({ designDetails, designCanvas, origCanvas, onComplete }) => {
    const width = designDetails.Width;
    const height = designDetails.Height;
    designCanvas.width = width;
    designCanvas.height = height;

    const img = new Image();

    const repeatImg = (canvas, img, width, height) => {
      var ctx = canvas.getContext("2d");
      var pat = ctx.createPattern(img, "repeat");

      //find offset
      let repeat = [width / img.width, height / img.height];
      let offsetX = 0;
      let offsetY = 0;
      let halfRepeatX = repeat[0] / 2;
      offsetX = 0.5 - (halfRepeatX - Math.floor(halfRepeatX)); //offset to center the tile center as canvas center horizontally
      let halfRepeatY = repeat[1] / 2;
      offsetY = 0.5 - (halfRepeatY - Math.floor(halfRepeatY)); //offset to center the tile center as canvas center vertically
      let offsetXActual = Math.abs(offsetX * img.width);
      if (offsetX < 0) {
        offsetXActual = img.width - offsetXActual;
      }
      let offsetYActual = Math.abs(offsetY * img.height);
      if (offsetY < 0) {
        offsetYActual = img.height - offsetYActual;
      }

      ctx.save();
      ctx.translate(-offsetXActual, -offsetYActual);
      ctx.rect(0, 0, width + offsetXActual, height + offsetYActual);
      ctx.fillStyle = pat;
      ctx.fill();
      ctx.restore();
    };

    img.onload = () => {
      repeatImg(designCanvas, img, width, height);
      onComplete();
    };

    img.src = origCanvas.toDataURL();
  };

  const loadDesignCanvas = async shouldSetPosition => {
    const myroomDesignUrl = window.initialData.customDesignUrl || "";
    const loadMyroomDesignFromUrl =
      myroomDesignUrl !== "" && window.flags.visualizations.allowDesignFromUrlInMyroom;
    const { fbxUrl } = myRoomConfig;
    if (loadMyroomDesignFromUrl) {
      const { fbxUrl } = myRoomConfig;
      readImage(myroomDesignUrl).then(image => {
        let { width, height } = image;

        const phyWidth = window.initialData.designWidth,
          phyheight = window.initialData.designHeight,
          unit = window.initialData.unit;

        const designCanvas = createCanvas(width, height);
        const ctx = designCanvas.getContext("2d");
        ctx.drawImage(image, 0, 0, width, height);

        myRoomHelper
          .loadDesignCanvas({
            designCanvas: designCanvas,
            fbxUrl,
            shouldSetPosition,
            designPath: myroomDesignUrl,
            customWid: phyWidth,
            customHgt: phyheight,
            unit
          })
          .then(() => {
            DesignLoaded = true;
            onMyRoomLoadComplete();
          });
      });
    } else {
      const desDetails = { ...designDetails, ...designDimsOrig };

      tileCanvas.init({ tileSize: 256, zoom, designDetails: desDetails });

      const designCanvasMod = createCanvas(tileCanvas.width, tileCanvas.height);

      await myRoomHelper.loadDesignCanvas({
        designCanvas: designCanvasMod,
        designDetails: designDetails,
        fbxUrl,
        shouldSetPosition,
        designPath
      });
      tileCanvas.drawVisTiles(
        {
          designPath,
          zoom,
          designDetails: desDetails,
          hash
        },
        () => {
          DesignLoaded = true;

          const isDimsOrig =
            designDimsOrig.Width === designDetails.Width &&
            designDimsOrig.Height === designDetails.Height;

          if (window.InterfaceElements.IsWallToWall) {
            designCanvasMod.getContext("2d").drawImage(tileCanvas.canvasVis, 0, 0);
            onMyRoomLoadComplete();
          } else if (!isDimsOrig && window.flags.ordersheet.repeatRugInArea) {
            repeatDesignForOverSize({
              designDetails,
              designCanvas: designCanvasMod,
              origCanvas: tileCanvas.canvasVis,
              onComplete: () => {
                onMyRoomLoadComplete();
              }
            });
          } else {
            const cropPadding = 100;
            if (!isDimsOrig) {
              const { width, height } = getCroppedSize(designDimsOrig, designDetails, cropPadding);
              designCanvasMod.width = width;
              designCanvasMod.height = height;
            }
            cropStitchCanvas({ origCanvas: tileCanvas.canvasVis, canvas: designCanvasMod });
            onMyRoomLoadComplete();
          }
        }
      );
    }
    myRoomHelper.updateGizmo({ show: myRoomState.controlMode === controlModes.TRANSFORM });
  };

  useEffect(() => {
    if (!roomId) return;
    setLoading(true);
    loadDesignCanvas();
  }, [designDetails]);

  useEffect(() => {
    if (!roomId) return;
    setLoading(true);
    loadDesignCanvas();
  }, [
    window.initialData.customDesignUrl,
    window.initialData.designWidth,
    window.initialData.designHeight,
    window.initialData.unit
  ]);

  useEffect(() => {
    if (myRoomState.controlMode === controlModes.MARK) {
      myRoomHelper.drawFFPoints(inputCanvasRef.current);
    } else {
      clearCanvas(
        inputCanvasRef.current,
        inputCanvasRef.current.width,
        inputCanvasRef.current.height
      );
    }
    myRoomHelper.updateGizmo({ show: myRoomState.controlMode === controlModes.TRANSFORM });
  }, [myRoomState.controlMode]);

  const setLoading = loading => {
    dispatchDesignDetails({ type: designDetailActions.SET_LOADING, payload: loading });
  };
  const handleRoomImageUpload = (e, initScene, imageFromFlutter = "") => {
    var uploadedImage;
    if (imageFromFlutter == "") {
      uploadedImage = e.target.files[0];
    } else {
      uploadedImage = imageFromFlutter;
    }
    if (!uploadedImage) return;
    setLoading(true);
    loadImage.parseMetaData(uploadedImage, data => {
      let orientation = 0;
      if (data.exif) orientation = data.exif.get("Orientation");
      //alert("handleRoomImageUpload -> orientation", orientation)
      loadImage(
        uploadedImage,
        async canvas => {
          loadMyRoomFromCanvas({ canvas, initScene: true, containerRef });
        },
        {
          canvas: true, // to activate auto fix orientation
          orientation: orientation,
          minWidth: 600,
          minHeight: 600
        }
      );
    });
  };
  const loadMyRoomFromCanvas = async ({ canvas, initScene, containerRef }) => {
    setLoadIceBreaker(false);
    const maskCanvas = maskCanvasRef.current;

    const { width, height } = resizeKeepingAspect(canvas, {
      width: windowWidth,
      height:
        window.flags.homeTemplate != pageViews.CREATEYOURRUG
          ? windowHeight
          : containerRef.current.getBoundingClientRect().height
    });
    maskCanvas.width = width;
    maskCanvas.height = height;
    clearCanvas(maskCanvas, width, height);
    myRoomHelper.updateBackground({
      bgImage: canvas,
      width,
      height,
      bgCanvas: bgCanvasRef.current
    });
    if (initScene) {
      myRoomHelper.initScene({ dims: { width, height }, config: myRoomConfig });
    }
    const roomId = await uploadRoom();
    setCanvasWidHgt(inputCanvasRef, width, height, gizmoCanvasRef);

    myRoomHelper.resizeRenderer(width, height);
    const bgImageBlob = await canvasToBlobPromise(myRoomHelper.bgCanvas);
    // console.log(AImaskLoaded);

    if (initScene) {
      AImaskLoaded = false;
      DesignLoaded = false;
      await loadDesignCanvas();
      if (!AImaskLoaded) {
        setLoading(true);
      }
    }
    try {
      loadRoomMaskFromAI(bgImageBlob, width, height, roomId);
    } catch (error) {
      console.log(error);
      //TODO:Handle segmentation error
    }
  };
  const uploadRoom = async () => {
    const { roomId } = await myRoomHelper.uploadRoom({ bgCanvas: bgCanvasRef.current });
    setroomId(roomId);
    setIsRoomSaved(false);
    setLoadIceBreaker(false);

    return roomId;
  };
  const loadRoomMaskFromAI = async (bgImageBlob, width, height, roomId) => {
    setLoading(true);
    myRoomHelper.setCarpetVisibility(false);
    myRoomHelper.updateGizmo({ show: false });

    AppProvider.getRoomMask(bgImageBlob).then(
      async res => {
        let maskData = "data:image/png;base64, " + res.img;
        const mask512 = "data:image/png;base64, " + res.img_orig;
        setOrigMaskUrl(maskData);
        setOrigMask512(mask512);
        //console.log(width, height);
        width = width || maskCanvasRef.current.width;
        height = height || maskCanvasRef.current.height;

        myRoomHelper.updateMask({
          maskUrl: maskData,
          maskCanvas: maskCanvasRef.current,
          bgCanvas: bgCanvasRef.current,
          width,
          height
        });
        await myRoomHelper.uploadMask({ maskUrl: mask512, roomId });

        carpetInitialPositionX = res.floor_center.x;
        carpetInitialPositionY = res.floor_center.y;
        myRoomHelper.setinitialOrientation(res);

        AImaskLoaded = true;
        if (DesignLoaded) setLoading(false);
        myRoomHelper.setCarpetVisibility(true);
        myRoomHelper.updateGizmo({ show: myRoomState.controlMode === controlModes.TRANSFORM });
      },
      error => {
        console.log(error);
        AImaskLoaded = true;
        if (DesignLoaded) setLoading(false);
        myRoomHelper.setCarpetVisibility(true);
        myRoomHelper.updateGizmo({ show: myRoomState.controlMode === controlModes.TRANSFORM });
      }
    );

    // const res = await AppProvider.getRoomMask(bgImageBlob);
    // let maskData = "data:image/png;base64, " + res.img;
    // const mask512 = "data:image/png;base64, " + res.img_orig;
    // setOrigMaskUrl(maskData);
    // setOrigMask512(mask512);
    // //console.log(width, height);
    // width = width || maskCanvasRef.current.width;
    // height = height || maskCanvasRef.current.height;

    // myRoomHelper.updateMask({
    //   maskUrl: maskData,
    //   maskCanvas: maskCanvasRef.current,
    //   bgCanvas: bgCanvasRef.current,
    //   width,
    //   height
    // });
    // await myRoomHelper.uploadMask({ maskUrl: mask512, roomId });

    // carpetInitialPositionX = res.floor_center.x;
    // carpetInitialPositionY = res.floor_center.y;
    // myRoomHelper.setinitialOrientation(res);
    // AImaskLoaded = true;
    // dispatchDesignDetails({ type: designDetailActions.SET_LOADING, payload: false });
    // myRoomHelper.setCarpetVisibility(true);
    // myRoomHelper.updateGizmo({ show: myRoomState.controlMode === controlModes.TRANSFORM });
  };
  const handleGizmoInputStart = e => {
    myRoomHelper.mouseDownTouchStart(e);
  };
  const handleGizmoInputMove = e => {
    myRoomHelper.mouseTouchMove(e, myRoomState.controlMode === controlModes.TRANSFORM);
  };
  const handleTranslateMode = () => {
    dispatchMyRoom({ type: myRoomActions.SET_CONTROL_MODE, payload: controlModes.TRANSFORM });
  };
  const handleMarkMode = () => {
    dispatchMyRoom({ type: myRoomActions.SET_CONTROL_MODE, payload: controlModes.MARK });
  };
  const handleAdjustPlaneMode = () => {
    dispatchMyRoom({ type: myRoomActions.SET_CONTROL_MODE, payload: controlModes.ADJUST_PLANE });
  };
  const handleAutoLevel = e => {
    isAutoLeveled
      ? myRoomHelper.undoAutoLevel(bgCanvasRef.current, maskCanvasRef.current)
      : myRoomHelper.autoLevel(bgCanvasRef.current, maskCanvasRef.current);
    setIsAutoLeveled(!isAutoLeveled);
  };
  const handleRotation = deg => {
    myRoomHelper.rotateCarpet(deg);
  };
  const handleScaleUp = e => {
    e.stopPropagation();
    myRoomHelper.scaleUpCarpet();
    //viewer.panCamera(10, 10);
  };

  const handleScaleDown = e => {
    e.stopPropagation();
    myRoomHelper.scaleDownCarpet();
  };
  const handleReset = () => {
    switch (myRoomState.controlMode) {
      case controlModes.MARK:
        handleResetPoints();
        break;
      case controlModes.TRANSFORM:
        myRoomHelper.resetCarpetTransform();
        break;
      case controlModes.ADJUST_PLANE:
        myRoomHelper.resetOrbit(carpetInitialPositionX, carpetInitialPositionY);
        break;

      default:
        break;
    }
  };
  const CancelSaveRoom = () => {
    setOpenSaveDialog(false);
  };
  const handleIncPlaneHgt = e => {
    myRoomHelper.adjustPlaneHeight(true);
  };
  const handleDecPlaneHgt = e => {
    myRoomHelper.adjustPlaneHeight(false);
  };
  const handleMoveCameraUp = e => {
    myRoomHelper.adjustCameraAngle(true);
  };
  const handleMoveCameraDown = e => {
    myRoomHelper.adjustCameraAngle(false);
  };
  const handleInputStart = e => {
    const x = e.x,
      y = e.y;
    handleInputMark(x, y);
  };
  const handleInputMove = e => {
    const x = e.x,
      y = e.y;
    handleInputMark(x, y);
  };
  const handleInputEnd = () => {
    myRoomHelper.updatePointHistory();
    getOutputMask();
  };
  const handleInputMark = (x, y) => {
    myRoomHelper.markFF(x, y, inputCanvasRef.current, myroomInputSelected);
  };
  const handleResetPoints = () => {
    myRoomHelper.resetPoints(inputCanvasRef.current);
    clearCanvas(maskCanvasRef.current, maskCanvasRef.current.width, maskCanvasRef.current.height);
    //uploadMask({ maskUrl: defaultWMask512, roomId });
    myRoomHelper.uploadMask({ maskUrl: origMask512, roomId });
    myRoomHelper.updateMask({
      maskUrl: origMaskUrl,
      maskCanvas: maskCanvasRef.current,
      bgCanvas: bgCanvasRef.current
    });
  };

  const handleUndoPoints = () => {
    myRoomHelper.undoPoints(inputCanvasRef.current);
    getOutputMask();
  };
  const getOutputMask = () => {
    setLoading(true);

    // const roomId = roomId;
    myRoomHelper.getCarpetPositions();
    const carpetpoints = myRoomHelper.myRoomPointsOBJ.carpetpoints;
    const floorpoints = myRoomHelper.myRoomPointsOBJ.floorpoints;

    const notfloorpoints = myRoomHelper.myRoomPointsOBJ.notfloorpoints;

    AppProvider.getProcessedRoomMask({
      roomId,
      file: designPath,
      props: designDetails,
      floorpoints,
      notfloorpoints,
      carpetpoints
    }).then(response => {
      var url = window.URL || window.webkitURL;
      const imageSrc = url.createObjectURL(response);

      readImage(imageSrc).then(
        image => {
          myRoomHelper.updateMask({
            maskImage: image,
            maskCanvas: maskCanvasRef.current,
            bgCanvas: bgCanvasRef.current
          });
          setLoading(false);
        },
        error => {
          //console.log(error);
        }
      );
    });
  };
  const handleBtnAI = async () => {
    myRoomHelper.resetPoints(inputCanvasRef.current);
    myRoomHelper.uploadMask({ maskUrl: origMask512, roomId });
    myRoomHelper.updateMask({
      maskUrl: origMaskUrl,
      maskCanvas: maskCanvasRef.current,
      bgCanvas: bgCanvasRef.current
    });
  };
  const handleMyroomCamera = () => {
    // if(isMobileDevice){
    //   inputRef.current.click();
    // }
    // else{
    //   setShowCamOptions(!showCamOptions);
    // }
    handleReset();
    handleTranslateMode();
    setShowCamOptions(!showCamOptions);
  };
  const openMyroomInput = () => {
    handleReset();
    handleTranslateMode();
    inputRef.current.click();
  };
  const handleOpenMyroomCamera = () => {
    if (!openCam) {
      setOpenCam(true);
      setShowCamOptions(false);
    }
  };
  const changeInputSelected = inputToSelect => {
    setMyroomInputSelected(inputToSelect);
  };
  const SaveRoom = roomName => {
    let mode = isAutoLeveled ? "saveab" : "save";
    const bgUrl = bgCanvasRef.current.toDataURL();
    const roomProps = {
      Thumb: bgUrl,
      label: roomName,
      id: roomId,
      fullpath: `Rooms/my room/${roomId}.crf`
    };
    myRoomHelper
      .saveAsRoom({
        mode,
        roomId,
        file: designPath,
        props: designDetails
      })
      .then(response => {
        dispatchMyRoom({
          type: myRoomActions.SAVE_ROOM,
          payload: roomProps
        });
        setIsRoomSaved(true);
        setOpenSaveDialog(false);
      });
  };

  window.SaveAsImage = async () => {
    myRoomHelper.saveAsImage({
      bgCanvas: bgCanvasRef.current,
      maskCanvas: maskCanvasRef.current,
      designPath
    });
  };

  return (
    <>
      {/* <AtSpinnerOverlay show></AtSpinnerOverlay> */}
      {loadIceBreaker && (
        <MyRoomIceBreaker
          handleOpenMyroomCamera={handleOpenMyroomCamera}
          handleRoomImageUpload={handleRoomImageUpload}
          setLoading={setLoading}
          myroomTutorialLink={window.flags.visualizations.myroomTutorialLink}
          showARcard={window.flags.visualizations.showARcardInIcebreaker}
          loadDesignFromUrl={window.flags.visualizations.allowDesignFromUrlInMyroom}
          customDesignUrl={window.initialData.customDesignUrl}
          myroomIcebreakerBackground={window.flags.visualizations.myroomIcebreakerBackground}
          takeAPictureImgUrl={window.flags.visualizations.takeAPictureImgUrl}
        />
      )}

      <div
        id="RugInMyRoom"
        style={{
          display: loadIceBreaker ? "none" : "block"
        }}
      >
        <div id="myroom-container" className="text-center" ref={containerRef}>
          <canvas ref={bgCanvasRef} id="bg-canvas" style={{ zIndex: 1 }}></canvas>
          <canvas ref={rendererRef} id="renderer-canvas" style={{ zIndex: 2 }}></canvas>
          <canvas ref={maskCanvasRef} id="mask-canvas" style={{ zIndex: 3 }}></canvas>
          <InputCanvas
            id="input-canvas"
            zIndex={4}
            pointerEvent={myRoomState.controlMode === controlModes.MARK}
            ref={inputCanvasRef}
            onStart={handleInputStart}
            onMove={handleInputMove}
            onEnd={handleInputEnd}
          />
          <InputCanvas
            id="gizmo-canvas"
            className="overlay-canvas"
            zIndex={5}
            pointerEvent={myRoomState.controlMode !== controlModes.MARK}
            ref={gizmoCanvasRef}
            onStart={handleGizmoInputStart}
            onMove={handleGizmoInputMove}
          // onEnd={handleGizmoInputEnd}
          />

          <Toaster position="bottom">
            {toastProps && (
              <Toast
                message={toastProps.message}
                intent={toastProps.intent}
                onDismiss={() => setToastProps(null)}
              />
            )}
          </Toaster>
          <SaveroomDialog
            isOpen={openSaveDialog && !isRoomSaved}
            handleSave={SaveRoom}
            handleCancel={CancelSaveRoom}
          ></SaveroomDialog>

          <Portal
            className="myroom-controls-portal"
            container={document.getElementById(myRoomControlsPortalID)}
          >
            {!loadIceBreaker && (
              <>
                <ButtonGroup vertical className="myroom-controls topLeft">
                  <AtButton
                    minimal
                    title="Adjust Rug"
                    intent={null}
                    icon="move"
                    onClick={handleTranslateMode}
                    className={myRoomState.controlMode === "TRANSFORM" ? "at-active" : null}
                  />
                  <AtButton
                    minimal
                    title="Adjust Floor"
                    intent={null}
                    icon="viewing-height"
                    onClick={handleAdjustPlaneMode}
                    className={
                      myRoomState.controlMode === controlModes.ADJUST_PLANE ? "at-active" : null
                    }
                  />
                  <AtButton
                    minimal
                    title="Mark floor or furniture"
                    intent={null}
                    icon="mark-tool"
                    onClick={handleMarkMode}
                    className={myRoomState.controlMode === controlModes.MARK ? "at-active" : null}
                  />
                  <AtButton
                    minimal
                    title="Save your room"
                    intent={null}
                    icon="save"
                    onClick={() => window.SaveAsImage()}
                  />
                </ButtonGroup>

                <ButtonGroup
                  onDoubleClick={e => e.stopPropagation()}
                  className="myroom-controls bottomBar"
                >
                  {myRoomState.controlMode === "TRANSFORM" && (
                    <div className="myroom-controls__transform">
                      <AtButton
                        className={classNames({ "at-active": isAutoLeveled })}
                        minimal
                        title="Auto Contrast"
                        intent={null}
                        icon="auto-brightness"
                        onClick={handleAutoLevel}
                      />
                      <AtButton
                        minimal
                        title="Rotate rug anti-clockwise"
                        intent={null}
                        icon="rotate-ccw"
                        onClick={() => handleRotation(15)}
                      />
                      <AtButton
                        minimal
                        title="Rotate rug 45 clockwise"
                        intent={null}
                        icon="rotate-45-cw"
                        onClick={() => handleRotation(-45)}
                      />
                      <AtButton
                        minimal
                        title="Rotate rug clockwise"
                        intent={null}
                        icon="rotate-cw"
                        onClick={() => handleRotation(-15)}
                      />

                      <AtButton
                        minimal
                        title="Scale-up"
                        intent={null}
                        icon="expand"
                        onClick={handleScaleUp}
                      />
                      <AtButton
                        minimal
                        title="Scale-down"
                        intent={null}
                        icon="collapse"
                        onClick={handleScaleDown}
                      />
                    </div>
                  )}
                  {myRoomState.controlMode === controlModes.ADJUST_PLANE && (
                    <div className="myroom-controls__adjustplane">
                      <AtButton
                        minimal
                        title="Increase floor height"
                        intent={null}
                        icon="increase-height"
                        onClick={handleIncPlaneHgt}
                      />
                      <AtButton
                        minimal
                        title="Decrease floor height"
                        intent={null}
                        icon="decrease-height"
                        onClick={handleDecPlaneHgt}
                      />
                      <AtButton
                        minimal
                        title="Move camera up"
                        intent={null}
                        icon="move-camera-up"
                        onClick={handleMoveCameraUp}
                      />
                      <AtButton
                        minimal
                        title="Move camera down"
                        intent={null}
                        icon="move-camera-down"
                        onClick={handleMoveCameraDown}
                      />
                    </div>
                  )}
                  {myRoomState.controlMode === controlModes.MARK && (
                    <div className="myroom-controls__mark">
                      <AtButton
                        minimal
                        title="Auto detect floor using AI"
                        intent={null}
                        icon="magic-wand"
                        onClick={handleBtnAI}
                      />
                      <AtButton
                        minimal
                        title="Mark floor"
                        intent={null}
                        icon="mark-floor"
                        onClick={() => changeInputSelected("floor")}
                        className={myroomInputSelected === "floor" ? "at-active" : null}
                      />
                      <AtButton
                        minimal
                        title="Mark furniture"
                        intent={null}
                        icon="mark-furniture"
                        onClick={() => changeInputSelected("furni")}
                        className={myroomInputSelected === "furni" ? "at-active" : null}
                      />
                      <AtButton
                        minimal
                        title="Erase marks"
                        intent={null}
                        icon="erase-mark"
                        onClick={() => changeInputSelected("eraser")}
                        className={myroomInputSelected === "eraser" ? "at-active" : null}
                      />
                    </div>
                  )}

                  {/* <div className="vertSeparator"></div> */}
                  {myRoomState.controlMode === controlModes.MARK && (
                    <AtButton
                      minimal
                      title="undo"
                      intent={null}
                      icon="undo"
                      onClick={handleUndoPoints}
                    />
                  )}
                  <AtButton
                    minimal
                    title="reset"
                    intent={null}
                    icon="reset"
                    onClick={handleReset}
                  />
                </ButtonGroup>
              </>
            )}
          </Portal>

          <Portal container={document.getElementById("app-main")}>
            {openCam && (
              <MyroomWebcam
                onClose={() => setOpenCam(false)}
                onCapture={onCameraCapture}
              ></MyroomWebcam>
            )}
          </Portal>

          <Portal
            container={
              cameraButtonsInStage || window.flags.visualizations.showCameraIconInStageMyRoom
                ? document.getElementById("stage_container")
                : document.getElementById("right-sidebar")
            }
            className={classNames("rightBarPortal", {
              "rightBarPortal-stageContainer":
                cameraButtonsInStage || window.flags.visualizations.showCameraIconInStageMyRoom
            })}
          >
            {!loadIceBreaker && (
              <>
                <ButtonGroup
                  vertical
                  className="myroom-controls camera-options"
                  style={{
                    display: showCamOptions ? "block" : "none"
                  }}
                >
                  <AtButton
                    className="camera-options__button"
                    minimal
                    title={strings.myRoom.takephoto}
                    intent={null}
                    onClick={handleOpenMyroomCamera}
                    id="openCamera"
                    text={strings.myRoom.openCam}
                  ></AtButton>

                  <InputButton
                    labelClassName="camera-options__button"
                    id="upload-room"
                    onChange={handleRoomImageUpload}
                    onClick={openMyroomInput}
                    title={strings.myRoom.uploadImage}
                    inputRef={inputRef}
                  >
                    Upload an Image
                  </InputButton>
                </ButtonGroup>

                <ButtonGroup
                  className={classNames("myroom-controls", "middleRight", {
                    "middleRight--expanded": showCamOptions
                  })}
                >
                  <div className="myroom-controls__camera">
                    <AtButton
                      minimal
                      title="Camera"
                      intent={null}
                      id="myroomCamera"
                      onClick={isMobileDevice ? openMyroomInput : handleMyroomCamera}
                    >
                      <AtIcon icon="double-chevron-camera" />
                    </AtButton>
                    {/* <AtButton
                      minimal
                      title="Camera"
                      intent={null}
                      // onClick={isMobileDevice ? openMyroomInput : handleMyroomCamera}
                      onClick={() => console.log("here")}
                      id="myroomCamera"
                    >
                      <AtIcon icon="double-chevron-camera" />
                    </AtButton> */}
                  </div>
                </ButtonGroup>
              </>
            )}
          </Portal>
        </div>
      </div>
    </>
  );
};

export default MyRoom;
function setCanvasWidHgt(inputCanvasRef, width, height, gizmoCanvasRef) {
  inputCanvasRef.current.width = width;
  inputCanvasRef.current.height = height;
  gizmoCanvasRef.current.width = width;
  gizmoCanvasRef.current.height = height;
}
