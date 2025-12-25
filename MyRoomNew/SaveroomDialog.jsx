import React, { useState, useEffect } from "react";
import AtDialog from "../../../components/molecules/AtDialog";
import { H5, FormGroup, InputGroup, Button } from "@blueprintjs/core";
import AtIcon from "../../../components/atoms/AtIcon";
import AtButton from "../../../components/atoms/AtButton";
import strings from "../../../strings";

const SaveroomDialog = props => {
  const [roomName, setRoomName] = useState("My own room");
  const [isOpen, setIsOpen] = useState(props.isOpen);

  useEffect(() => {
    setIsOpen(props.isOpen);
  }, [props.isOpen]);
  const handleSave = () => {
    props.handleSave(roomName);
  };
  const handleCloseDialog = () => {
    setIsOpen(false);
    props.handleCancel();
  };
  return (
    <AtDialog isOpen={isOpen} className="at-confirmation-dialog" size="xs">
      <div className="at-dialog-area at-confirmation-dialog-area">
        <Button
          className="at-close-dialog-button"
          onClick={handleCloseDialog}
          minimal
          icon={<AtIcon icon="close"></AtIcon>}
        />
        <H5 className="at-dialog-heading">{strings.myRoom.saveroom}</H5>
        <div className="at-dialog-content">
          <FormGroup helperText={strings.myRoom.saveRoomText}>
            <InputGroup
              autoFocus
              onFocus={e => {
                e.target.select();
              }}
              value={roomName}
              onChange={e => setRoomName(e.target.value)}
            />
          </FormGroup>
          <div className="at-fav-btns-area">
            <AtButton intent="primary" onClick={handleSave} text={strings.tools.save} />

            <AtButton intent="danger" onClick={handleCloseDialog} text={strings.tools.cancel} />
          </div>
        </div>
      </div>
    </AtDialog>
  );
};

SaveroomDialog.propTypes = {};

export default SaveroomDialog;
