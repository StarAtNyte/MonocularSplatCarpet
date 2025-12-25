import React, { useEffect } from "react";
import AtDialog from "../../molecules/AtDialog";
import { useUiDispatch, mainUiActions, useUiState } from "../../../reducers/mainui.reducer";
import { H5 } from "@blueprintjs/core";
import AtButton from "../../atoms/AtButton";
import strings from "../../../strings";

const MyroomCameraDialog = () => {
  const dispatchUiState = useUiDispatch();
  const uiState = useUiState();
  const handleCloseDialog = () => {
    dispatchUiState({ type: mainUiActions.SET_MYROOM_MSG_DIALOG, payload: false });
  };
  useEffect(() => {
    if (!uiState.showMyroomMsgDialog) return;
  }, [uiState.showMyroomMsgDialog]);
  return (
    <AtDialog
      onClose={handleCloseDialog}
      isOpen={uiState.showMyroomMsgDialog}
      className="at-confirmation-dialog at-myroom-Message-dialog"
      size="sm"
    >
      <div className="at-dialog-area ">
        <AtButton
          className="at-close-dialog-button"
          onClick={handleCloseDialog}
          minimal
          icon="close"
        />
        <H5 className="at-dialog-heading">{strings.tools.cameraUnaccesible}</H5>
        <div className="at-dialog-content">
          <div className="bp3-form-helper-text">{strings.tools.cameraIssue}</div>
          <div className="at-confirmation-btns-area">
            <AtButton intent="primary" onClick={handleCloseDialog} text={strings.tools.close} />
          </div>
        </div>
      </div>
    </AtDialog>
  );
};

export default MyroomCameraDialog;
