import { ipcRenderer, contextBridge, DesktopCapturerSource, SourcesOptions } from "electron";
import pino, { Logger } from "pino";
import { Signal } from "../../../shared/src/signal";
import {
  K_BROWSER_CONFIG,
  K_BROWSER_STORAGE,
  K_CAPTURE_WIN,
  K_CAPTURE_WINID,
  K_PRELOAD_INIT_KEY,
  K_PRELOAD_LOGGER_KEY,
  K_SIGNAL_CONFIG,
} from "../base/constants";
import { Application } from "./application";
import { H264Sdp } from "./h264-sdp";
import { Input } from "./input";
import { Peer } from "./peer";
import { UserMedia } from "./usermedia";

// we'll export this and use it for testing
// it won't impact the runtime as the runtime ignores it
let runtimeIgnoredExportValue: Promise<void>;

// const config = getGlobal(K_BROWSER_STORAGE);
let config:any = {};
// const logger = config.logger; // cannot access this !?
const logger:any = {
  log: console.log,
  info: console.log,
  warn: console.warn,
  error: console.error
}

async function getSources(opts: SourcesOptions, cb: (err: Error|undefined, sources: DesktopCapturerSource[])=>void) {
  setTimeout(() => {
    ipcRenderer.invoke('getSources', opts).then((result) => {
      cb(undefined, result);
    }).catch((err)=>{
      cb(Error(err), []);
    });

  }, 1000);
}

ipcRenderer.invoke('getGlobal', K_BROWSER_STORAGE).then((value) => {
  config = JSON.parse(value);
  console.log("ipcRenderer.invoke'getGlobal': ", config);

  // const logger = console; //: Logger = config[K_PRELOAD_LOGGER_KEY]; // will not work, cannot access main

  if (!config[K_PRELOAD_INIT_KEY]) {
    // indicate that we've booted, and future preloads should not boot again
    config[K_PRELOAD_INIT_KEY] = true;

    const captureWindowTitle = config[K_CAPTURE_WIN];

    const app = new Application({
      ...config[K_BROWSER_CONFIG],
      captureWindowTitle,
      inputHandler: new Input(config[K_CAPTURE_WINID]),
      logger,
      signalProvider: new Signal({
        ...config[K_SIGNAL_CONFIG],
      }),
      streamProvider: new UserMedia({
        getSources: getSources,
        // bind needed - see https://github.com/peers/peerjs/issues/98#issuecomment-445342890
        getUserMedia: navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
      }),
      webrtcProvider: new Peer({
        sdpHandler: new H264Sdp(),
      }),
    });

    runtimeIgnoredExportValue = app.boot().then(() => {
      logger.log("Browser: booted");
    }, (err) => {
      logger.error(`Browser: failed to boot: ${err}`, err.stack);
    });

  } else {
    const errorText = "Browser: could not re-boot";
    logger.error(errorText);
    runtimeIgnoredExportValue = Promise.reject(errorText);
  }
  // module.exports = runtimeIgnoredExportValue;
});

