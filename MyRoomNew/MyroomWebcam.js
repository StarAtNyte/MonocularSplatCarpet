/* eslint-disable no-useless-escape */
import React, { useEffect, useState } from "react";
import { ButtonGroup } from "@blueprintjs/core";
import AtButton from "../../atoms/AtButton";
import strings from "../../../strings";
import { isMobileDevice } from "../../../utils/utils";

const constraints = (window.constraints = {
  audio: false,
  video: isMobileDevice ? { facingMode: "environment" } : true
});

const errorMsg = (msg, error) => {
  console.error(msg);
};

const MyroomWebcam = props => {
  const { onClose, onCapture } = props;
  const [localVideoStream, setLocalVideoStream] = useState(null);
  const [myroomVideoPlaying, setMyroomVideoPlaying] = useState(false);

  const initCam = () => {
    // Older browsers might not implement mediaDevices at all, so we set an empty object first
    if (navigator.mediaDevices === undefined) {
      navigator.mediaDevices = {};
    }

    // Some browsers partially implement mediaDevices. We can't just assign an object
    // with getUserMedia as it would overwrite existing properties.
    // Here, we will just add the getUserMedia property if it's missing.
    if (navigator.mediaDevices.getUserMedia === undefined) {
      navigator.mediaDevices.getUserMedia = function(constraints) {
        // First get ahold of the legacy getUserMedia, if present
        var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

        // Some browsers just don't implement it - return a rejected promise with an error
        // to keep a consistent interface
        if (!getUserMedia) {
          return Promise.reject(new Error("getUserMedia is not implemented in this browser"));
        }

        // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
        return new Promise(function(resolve, reject) {
          getUserMedia.call(navigator, constraints, resolve, reject);
        });
      };
    }

    // function getConnectedDevices(type, callback) {
    //   navigator.mediaDevices.enumerateDevices().then(devices => {
    //     const filtered = devices.filter(device => device.kind === type);
    //     callback(filtered);
    //   });
    // }

    //getConnectedDevices("videoinput", cameras => console.log("Cameras found", cameras));

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(function(stream) {
        handleSuccess(stream);
      })
      .catch(function(err) {
        handleError(err);
      });
  };

  useEffect(() => {
    initCam();
  }, []);

  const handleSuccess = stream => {
    let myroomVideo = document.getElementById("MyRoomvideo");
    window.myroomVideo = myroomVideo;
    const videoTracks = stream.getVideoTracks();
    console.log("Got stream with constraints:", constraints);
    console.log("Using video device: ".concat(videoTracks[0].label));
    window.stream = stream; // make variable available to browser console
    window.myroomVideo.srcObject = stream;
    setLocalVideoStream(stream);
    window.myroomVideo.play();
    setMyroomVideoPlaying(true);
  };

  const handleError = error => {
    var errorText = "";
    if (error.name === "ConstraintNotSatisfiedError") {
      var v = constraints.video;
      errorText = "The resolution "
        .concat(v.width.exact, "x")
        .concat(v.height.exact, " px is not supported by your device.");
      errorMsg(errorText);
    } else if (error.name === "PermissionDeniedError") {
      errorText =
        "Permissions have not been granted to use your camera and " +
        "microphone, you need to allow the page access to your devices in " +
        "order for the demo to work.";
      errorMsg(errorText);
    } else if (error.name === "Error") {
      errorText = "getUserMedia is not implemented in unsecured browser";
    }
    var txt = "getUserMedia error: ".concat(error.name);
    errorMsg(txt);
    errorText = errorText === "" ? txt : errorText;
    alert(errorText);
    setTimeout(() => {
      onClose();
    }, 3000);
  };

  const capturePhoto = () => {
    if (myroomVideoPlaying) {
      var canvas = document.createElement("canvas");
      canvas.width = window.myroomVideo.videoWidth;
      canvas.height = window.myroomVideo.videoHeight;
      canvas.getContext("2d").drawImage(window.myroomVideo, 0, 0);
      var data = canvas.toDataURL("image/jpeg");
      window.myroomVideo.pause();
      window.myroomVideo.src = "";
      localVideoStream.getTracks()[0].stop();
      setMyroomVideoPlaying(false);
      onCapture(data);
      onClose();
    }
  };
  const cancelPhotoCapture = () => {
    if (myroomVideoPlaying) {
      window.myroomVideo.pause();
      window.myroomVideo.src = "";
      localVideoStream.getTracks()[0].stop();
      setMyroomVideoPlaying(false);
      onClose();
    }
  };
  return (
    <>
      <div className="at-webcam" title="New image">
        <video style={{ position: "absolute", zIndex: 500 }} id="MyRoomvideo"></video>

        <ButtonGroup vertical className="at-webcam--controls">
          <AtButton text={strings.myRoom.capture} onClick={capturePhoto}></AtButton>

          <AtButton text={strings.tools.close} onClick={cancelPhotoCapture}>
            {" "}
          </AtButton>
        </ButtonGroup>
      </div>
    </>
  );
};

export default MyroomWebcam;
