import { ipcRenderer, MouseWheelInputEvent } from "electron";
import { IInputHandler, IInputMessage } from "../base/input-handler";

/**
 * Input handler for electron WebContents
 */
export class Input implements IInputHandler {
  private windowid: number; //webContents: WebContents;

  /**
   * Default ctor
   * @param windowId the electron WindowId to bind to
   */
  public constructor(windowid: number) {
    this.windowid = windowid;
  }

  public processAndRaiseMessage(msg: IInputMessage) {
    // console.log(`processAndRaiseMessage 1, ${this.windowid}, ${msg}`);

    if(msg.type === 'resize') {
      ipcRenderer.send('sendWindowEvent', this.windowid, msg);
    } else {
      const events = this.convertToElectronMessages(msg) as any[];
      events.filter((evt) => evt != null)
        .forEach((evt) => {
          // raise all the events on the electron control
          // this.webContents.sendInputEvent(evt);
          ipcRenderer.send('sendInputEvent', this.windowid, evt);
          // console.log(`processAndRaiseMessage 2, ${this.windowid}, ${evt});`);
        });
    }
  }

  /**
   * Converts wire messages to electron messages for use in webContents.sendInputEvent(e);
   * ref: https://www.electronjs.org/docs/latest/api/web-contents#contentssendinputeventinputevent
   * @param msg wire message to convert
   * @returns converted electron messages
   */
  private convertToElectronMessages(msg: IInputMessage) {
    if (msg.version !== 1) {
      throw new Error(`Unsupported Input Protocol version: ${msg.version}`);
    }

    switch (msg.type) {
      // process touch events
      case "touch":
        const touchData = msg.data as { pointers: any[] };
        // process each pointer individually
        return touchData.pointers.map((pointer) => this.convertSingleTouch(pointer));

      case "keyboard":
        const keyData = msg.data as { key: string, state: string };
        return [this.convertSingleKey(keyData)];

      case "wheel":
        // move to share !!!
        // export interface IWheelData {
        //   dx: number;
        //   dy: number;
        //   dz: number;
        //   mode: number;
        // }

        const wheelData = msg.data as { pointers: any[] };
        let mwie: MouseWheelInputEvent = {
          x: 0,
          y: 0,
          type: "mouseWheel",
          deltaX: wheelData.pointers[0].dx,
          deltaY: wheelData.pointers[0].dy
        };
        return [mwie];

      default:
        console.warn(`Input:convertToElectronMessages: Unsupported Message Type: ${msg.type}`);
        // throw new Error(`Unsupported Message Type: ${msg.type}`);
        return [];
    }
  }

  /**
   * Convert a single touch event into an electron event
   * Note: return can be null, indicating no conversion was possible
   * @param pointer the pointer event data
   * @returns converted event
   */
  private convertSingleTouch(pointer: { id: string, state: string, x: number, y: number }) {
    switch (pointer.state) {
      // if the pointer is starting a touch
      case "start":
        // emit a left-click (hold down) at that location
        return {
          button: "left",
          clickCount: 1,
          type: "mouseDown",
          x: pointer.x,
          y: pointer.y,
        };
      // if the pointer is releasing
      case "end":
        // emit a left-click (release) at that location
        return {
          button: "left",
          clickCount: 1,
          type: "mouseUp",
          x: pointer.x,
          y: pointer.y,
        };
      case "move":
        // emit a left-click (release) at that location
        return {
          button: "left",
          clickCount: 1,
          type: "mouseMove",
          x: pointer.x,
          y: pointer.y,
        };
      default:
        // no valid event
        return null;
    }
  }

  /**
   * Convert a single key event into an electron event
   * Note: return can be null, indicating no conversion was possible
   * @param keyboard the keyboard event data
   * @returns converted event
   */
  private convertSingleKey(keyboard: { key: string, state: string }) {
    // these help us convert the message to electron accelerator message
    const modifiers = /^(Command|Cmd|Control|Ctrl|CommandOrControl|CmdOrCtrl|Alt|Option|AltGr|Shift|Super)$/;
    const keyCodes = /^([0-9A-Za-z)!@#$%^&*(:+<_>?~{|}";=,\-./`[\\\]'])$/;
    // tslint:disable-next-line:max-line-length
    const specialKeyCodes = /(F1*[1-9]|F10|F2[0-4]|Plus|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause|PrintScreen)$/;
    const lowerKeyCodes = /^[a-z]$/;

    // default initialize the key event
    const event: {
      keyCode?: string,
      modifiers: string[],
      type?: "keyUp" | "keyDown" | "char",
    } = {
      keyCode: undefined,
      modifiers: [],
      type: undefined,
    };

    // send key codes as char
    if (keyCodes.test(keyboard.key)) {
      // we only fire chars on "pressed"
      if (keyboard.state !== "pressed") {
        // no valid event
        return null;
      }

      event.type = "char";
      event.keyCode = keyboard.key;
      if (!lowerKeyCodes.test(keyboard.key)) {
        event.modifiers.push("Shift");
      }
      // send special keys and modifiers as key events
    } else {
      // case the keycode, capital first, then lowercase
      const casedKeyCode = keyboard.key[0].toUpperCase() + keyboard.key.substr(1).toLowerCase();

      event.type = keyboard.state === "pressed" ? "keyDown" : "keyUp";

      // special key codes must use cased keyCode properties
      if (specialKeyCodes.test(keyboard.key)) {
        event.keyCode = casedKeyCode;
        // modifiers must use no keyCode prop, and a modifier array
      } else if (modifiers.test(keyboard.key)) {
        event.keyCode = undefined;
        event.modifiers = [
          casedKeyCode,
        ];
      }
    }
    return event;
  }
}
