/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useRef, useEffect } from "react";
import pako from "pako";
import { Card, Elevation, Intent, Toast, Toaster } from "@blueprintjs/core";
import PerspectiveView from "./perspective";
import { useDesignDetailState } from "../../../reducers/designdetails.reducer";
import { isAppleDevice, isIos, isMobileDevice, resizeKeepingAspect } from "../../../utils/utils";
import AtButton from "../../atoms/AtButton";
import strings from "../../../strings";
import classNames from "classnames";
import MyroomCameraDialog from "./MyroomCameraDialog";
import { mainUiActions, useUiDispatch } from "../../../reducers/mainui.reducer";
import { readImage } from "../../../utils/domUtils";
import AppProvider, { assetsDomain, CDN_domain, domain } from "../../../api/appProvider";
import ArCarpetDialog from "../ArCarpetDialog";
import { useWindowSize } from "react-use";
import AtIcon from "../../atoms/AtIcon";
var QRCode = require("qrcode.react");

const baseUrl = CDN_domain + "v3assets/myroom";
let takePicImgUrl = `${baseUrl}/takepicture.png`;
let ArCardImgUrl = `${baseUrl}/seeItLive.jpg`;

const loadRoomImgUrl = `${baseUrl}/loadroom.png`;

const onlineGuideImgUrl = `${baseUrl}/onlineguide.png`;
const qrImgUrl = `${baseUrl}/qr.png`;
// REMOVED: Module-level singleton was causing memory leaks
// const perspectiveView = new PerspectiveView();

const MyRoomIceBreaker = props => {
  const {
    handleOpenMyroomCamera,
    handleRoomImageUpload,
    setLoading,
    myroomTutorialLink = "",
    showARcard = false,
    loadDesignFromUrl = false,
    customDesignUrl,
    myroomIcebreakerBackground = "PERSPECTIVE",
    takeAPictureImgUrl = ""
  } = props;
  const { designDetails, fullpath: designPath, hash } = useDesignDetailState();
  const dispatchUiState = useUiDispatch();
  const [toastProps, setToastProps] = useState(null);
  const inputRef = useRef(null);
  const imageRef = useRef();
  const containerRef = useRef();
  const [qrForARUrl, setQrForARUrl] = useState(null);
  const size = useWindowSize();
  const [showQRCodeForStores, setshowQRCodeForStores] = useState(false);
  const windowSize = useWindowSize();

  // Move perspectiveView to component level with useRef to prevent memory leaks
  const perspectiveViewRef = useRef(null);

  // Initialize perspectiveView once
  const getPerspectiveView = () => {
    if (!perspectiveViewRef.current) {
      perspectiveViewRef.current = new PerspectiveView();
    }
    return perspectiveViewRef.current;
  };
  useEffect(() => {
    if (takeAPictureImgUrl !== "") {
      takePicImgUrl = takeAPictureImgUrl;
    }
  }, [takeAPictureImgUrl]);

  useEffect(() => {
    window.recieveFromFlutter = testValue => {
      const test = "data:image/png;base64," + testValue;
      setToastProps({ message: "Uploading your image", intent: Intent.NONE });
      handleRoomImageUpload(null, true, test);
    };
    setARQR();
  }, []);
  useEffect(() => {
    if (size.width < size.height && size.width < 1000) {
      setToastProps({
        message: "This feature is better viewed in Landscape mode.",
        intent: Intent.PRIMARY
      });
    }
  }, [size]);
  const getImageUrl = url => {
    let imageUrl = `${assetsDomain}${url.replace("/Assets", "")}`;
    if (url.lastIndexOf("/Cache") !== -1) {
      imageUrl = `${domain}${url}`;
    }
    return imageUrl;
  };

  const getUnityUrl = ({ imageUrl, width, length, unit, compressed = false }) => {
    let unityUrl = `imageUrl=${encodeURIComponent(
      imageUrl
    )}&width=${width}&length=${length}&unit=${unit}`; //&mapUrl=${mapUrl}
    unityUrl = "unitydl://carpetAR?" + unityUrl;
    if (compressed) {
      let test = {
        imageUrl: imageUrl,
        width: width,
        length: length,
        unit: unit
      };
      const compressed = pako.deflate(JSON.stringify(test));
      let b64 = Buffer.from(compressed, "u8").toString("base64");
      unityUrl = "unitydl://carpetAR?data=" + encodeURIComponent(b64);
    }
    setQrForARUrl(unityUrl);
  };

  const setARQR = () => {
    if (customDesignUrl) {
      const width = window.initialData.designWidth || designDetails.PhysicalWidth;
      const length = window.initialData.designHeight || designDetails.PhysicalHeight;
      const unit = window.initialData.unit || designDetails.Unit;
      getUnityUrl({ imageUrl: customDesignUrl, width, length, unit });
    } else {
      if (!designDetails) return;
      AppProvider.getArQr({
        file: designPath,
        props: designDetails
      }).then(data => {
        const imageUrl = getImageUrl(data.imageurl);
        const width = designDetails ? designDetails.PhysicalWidth : window.initialData.designWidth;
        const length = designDetails
          ? designDetails.PhysicalHeight
          : window.initialData.designHeight;
        const unit = designDetails ? designDetails.Unit : window.initialData.unit;
        getUnityUrl({ imageUrl, width, length, unit });
        // const encodedUrl="unitydl://carpetAR?data=" + encodeURIComponent(b64);
        // const qrImage = `https://chart.googleapis.com/chart?cht=qr&chl=${unityUrl}&choe=UTF-8&chs=300x300`;
        // setQrForARUrl(qrImage);
      });
    }
  };
  useEffect(() => {
    setLoading(true);
    if (myroomIcebreakerBackground === "PERSPECTIVE") {
      const perspectiveView = getPerspectiveView();
      perspectiveView.init();
      if (loadDesignFromUrl && customDesignUrl && customDesignUrl !== "") {
        perspectiveView
          .getRenderedDesignFromCustomUrl({
            customUrl: customDesignUrl,
            physicalWidth: window.initialData.designWidth,
            physicalHeight: window.initialData.designHeight,
            unit: window.initialData.unit
          })
          .then(renderedImage => {
            onImageRender(renderedImage);
          });
      } else {
        perspectiveView
          .getRenderedDesignImage({
            designDetails: designDetails,
            designPath: designPath,
            hash
          })
          .then(renderedImage => {
            onImageRender(renderedImage);
          })
          .catch(() => {
            setLoading(false);
          });
        setARQR();
      }
    }

    // Cleanup function to dispose resources
    return () => {
      if (perspectiveViewRef.current) {
        // Note: PerspectiveView needs a dispose() method to clean up Three.js resources
        if (typeof perspectiveViewRef.current.dispose === 'function') {
          perspectiveViewRef.current.dispose();
        }
        perspectiveViewRef.current = null;
      }
    };
  }, [hash, customDesignUrl, window.initialData.designWidth, window.initialData.designHeight]);

  useEffect(() => {
    if (myroomIcebreakerBackground !== "PERSPECTIVE") {
      readImage(myroomIcebreakerBackground).then(image => {
        onImageRender(image.src);
      });
    }
  }, [myroomIcebreakerBackground]);
  const onImageRender = renderedImage => {
    if (!imageRef.current) {
      return;
    }
    imageRef.current.src = renderedImage;
    const containerDims = {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight
    };
    const { width, height } = resizeKeepingAspect({ width: 1920, height: 1080 }, containerDims);
    imageRef.current.style.width = `${width}px`;
    imageRef.current.style.height = `${height}px`;
    setLoading(false);
  };

  const handleCameraCardClick = () => {
    console.log("web cam");
    if (!isSiteSecured()) {
      dispatchUiState({ type: mainUiActions.SET_MYROOM_MSG_DIALOG, payload: true });
    }
  };
  const handleARCardClick = () => {
    if (windowSize.width < 1400 || windowSize.height < 700) {
      dispatchUiState({ type: mainUiActions.SET_ARCARPET_INFO_DIALOG, payload: true });
    } else if (isMobileDevice) {
      window.location.href = qrForARUrl;
      setTimeout(function() {
        window.location.href =
          isAppleDevice || isIos
            ? "https://apps.apple.com/np/app/ar-carpet/id1602660181"
            : "https://play.google.com/store/apps/details?id=com.alternative.atarcarpet";
      }, 1000);
    } else {
      setToastProps({
        message:
          "This feature is only available on smartphones through our AR Carpet App. Please scan the given QR code to continue.",
        intent: Intent.PRIMARY
      });
    }
  };
  const handlewebcamopen = e => {
    handleOpenMyroomCamera(e);
  };
  const handleInput = e => {
    setToastProps({ message: "Uploading your image", intent: Intent.NONE });
    handleRoomImageUpload(e, true);
    //handle input image from device uploaded from storage
  };
  const isSiteSecured = () => {
    var isSecured =
      window.location.protocol === "https:" || window.location.hostname === "localhost";
    return isSecured;
  };
  return (
    <React.Fragment>
      <div ref={containerRef} className={"at-myroomicebreaker-container"}>
        <img ref={imageRef} className="at-myroomicebreaker-image" alt="My Room Icebreaker" />
        <div className={"at-myroomicebreaker-contents"}>
          <div
            className={classNames("opt-1-wrapper take-picture", { disabled: !isSiteSecured() })}
            onClick={handleCameraCardClick}
          >
            <Card interactive={true} elevation={Elevation.TWO} onClick={handlewebcamopen}>
              <div className="card-image-wrapper">
                <img alt="capture" src={takePicImgUrl} className={"cardimg"}></img>
              </div>
              <AtButton minimal icon="double-chevron-camera" text={strings.myRoom.takePicture} />
            </Card>
            <div className={"scan-wrapper"}>
              {qrImgUrl && <img alt="scan qr" className={"scan-qr"} id="qr" src={qrImgUrl}></img>}
              <span className="scan-text">
                Scan this QR code or go to{" "}
                <a
                  className="scan-link"
                  href="http://explor.ug/mrupd"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  http://explor.ug/mrupd
                </a>{" "}
                if you want to use camera on your smart device
              </span>
            </div>
          </div>

          <label htmlFor="upload-photo">
            <Card interactive={true} elevation={Elevation.TWO}>
              <div className="card-image-wrapper">
                <img alt="upload" src={loadRoomImgUrl} className={"cardimg"}></img>
              </div>
              <AtButton
                minimal
                icon="folder-closed"
                text={strings.myRoom.loadFromStorage}
                onClick={() => inputRef.current.click()}
              />
            </Card>
          </label>
          <input
            type="file"
            name="photo"
            accept="image/*"
            id="upload-photo"
            className={"hiddeninput"}
            // onInput={handleInput}
            onChange={handleInput}
            ref={inputRef}
          />

          {showARcard && qrForARUrl && (
            <div className={classNames("opt-1-wrapper", "at-ar-card")} onClick={handleARCardClick}>
              <Card interactive={true} elevation={Elevation.TWO} onClick={handleARCardClick}>
                <div className="card-image-wrapper">
                  <img alt="capture" src={ArCardImgUrl} className={"cardimg"}></img>
                </div>
                <AtButton minimal icon="handycam" text={strings.myRoom.seeItLive} />
              </Card>
              {/* <ScanQRWrapper qrForARUrl={qrForARUrl}/> */}
              <div className={"scan-wrapper"}>
                {qrForARUrl && (
                  <div className="qr-code">
                    <QRCode
                      value={qrForARUrl}
                      size={128}
                      bgColor={"#ffffff"}
                      fgColor={"#000000"}
                      level={"L"}
                    />
                  </div>
                )}
                <span className="scan-text">
                  Scan this QR code on your phone to view this design live in your room. This
                  requires the AR carpet app. You can install it from
                  <div className="ar-app-store-area">
                    <span
                      className="ar-app-store"
                      onClick={e => {
                        setshowQRCodeForStores("apple");
                        e.stopPropagation();
                      }}
                    >
                      {" "}
                      App store
                    </span>
                    <span className="ar-stores-separator"> or </span>
                    <span
                      className="ar-play-store"
                      onClick={e => {
                        setshowQRCodeForStores("android");
                        e.stopPropagation();
                      }}
                    >
                      {" "}
                      Play Store
                    </span>
                  </div>
                </span>
                <div
                  className={classNames(
                    "scan-qr-wrapper",
                    { hidden: !showQRCodeForStores },
                    { "show-apple": showQRCodeForStores === "apple" },
                    { "show-android": showQRCodeForStores === "android" }
                  )}
                >
                  {showQRCodeForStores === "apple" ? (
                    <a
                      href="https://apps.apple.com/np/app/ar-carpet/id1602660181"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <QRCode
                        value={"https://apps.apple.com/np/app/ar-carpet/id1602660181"}
                        size={128}
                        bgColor={"#ffffff"}
                        fgColor={"#000000"}
                        level={"L"}
                      />
                      <AtIcon icon={"apple"} />
                      App Store
                    </a>
                  ) : (
                    <a
                      href="https://play.google.com/store/apps/details?id=com.alternative.atarcarpet"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <QRCode
                        value={
                          "https://play.google.com/store/apps/details?id=com.alternative.atarcarpet"
                        }
                        size={128}
                        bgColor={"#ffffff"}
                        fgColor={"#000000"}
                        level={"L"}
                      />
                      <AtIcon icon={"android"} />
                      Play Store
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          <Card
            interactive={true}
            elevation={Elevation.TWO}
            onClick={() => {
              window.open(myroomTutorialLink);
            }}
          >
            <div className="card-image-wrapper">
              <img alt="view guide" src={onlineGuideImgUrl} className={"cardimg"}></img>
            </div>
            <AtButton minimal icon="info-circle" text={strings.myRoom.readGuidelines} />
          </Card>
        </div>
      </div>
      <Toaster className="myroom-toast" position="bottom">
        {toastProps && (
          <Toast
            timeout={-1}
            message={toastProps.message}
            intent={toastProps.intent}
            onDismiss={() => setToastProps(null)}
          />
        )}
      </Toaster>
      <MyroomCameraDialog />
      <ArCarpetDialog qrForARUrl={qrForARUrl} />
    </React.Fragment>
  );
};

export default MyRoomIceBreaker;
