import * as path from "path";
import { Logger } from "pino";
import { ISignalOpts } from "../../../shared/src/signal";
import { IApplication } from "../base/application";
import {
  K_BROWSER_CONFIG,
  K_BROWSER_STORAGE,
  K_CAPTURE_WIN,
  K_CAPTURE_WINID,
  K_PRELOAD_LOGGER_KEY,
  K_SIGNAL_CONFIG,
} from "../base/constants";
import { IWindowProvider } from "../base/window-provider";

/**
 * Application constructor options
 */
interface IApplicationOpts {
  /**
   * A logger
   */
  logger: Logger;

  /**
   * The url to stream (visually)
   */
  url: string;

  /**
   * The visual window width
   */
  width: number;

  /**
   * The visual window height
   */
  height: number;

  /**
   * The capture window name
   */
  captureWindowTitle: string;

  /**
   * The capture window id :-O
   */
   captureWindowId: number;

  /**
   * Signal configuration
   */
  signalConfig: ISignalOpts;

  /**
   * Streamer (browser/application) configuration
   */
  streamerConfig: { iceServers: RTCIceServer[] };

  /**
   * Experiment: hide the streamer window
   */
  expHideStreamer: boolean;

  /**
   * A window provider
   */
  winProvider: IWindowProvider;
}

/**
 * Node application - orchestrates electron main process
 */
export class Application implements IApplication {
  private opts: IApplicationOpts;

  /**
   * Default Ctor
   * @param opts ctor opts
   */
  constructor(opts: IApplicationOpts) {
    this.opts = opts;
  }

  /**
   * Internal boot up helper
   */
  public async boot() {
    const {
      logger,
      url,
      captureWindowTitle,
      signalConfig,
      streamerConfig,
      expHideStreamer,
      winProvider,
      width,
      height } = this.opts;

    logger.info("Node: creating browser");

    const contentWindow = await winProvider.createWindow({
      alwaysOnTop: false,
      backgroundColor: "#000",
      height,
      logger,
      title: captureWindowTitle,
      url,
      webPreferences: {
        contextIsolation: true,
        disableBlinkFeatures: "Auxclick",
        // offscreen: true
      },
      width,
      frame: false,
      paintWhenInitiallyHidden: true,
      show: false
    });
    contentWindow.toBrowserWindow().webContents.backgroundThrottling = false;
    contentWindow.toBrowserWindow().menuBarVisible = false;
    // contentWindow.toBrowserWindow().webContents.setFrameRate(25);
    // contentWindow.toBrowserWindow().hide();
    // contentWindow.toBrowserWindow().show();

    logger.info("Node: created browser");

    // give our content window another second - to be sure x is happy
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000));

    // setup our globals so the streamer-process can access it's config
    this.setGlobals({
      captureWindowTitle:captureWindowTitle,
      captureWindowId:contentWindow.toBrowserWindow().id,
      logger:logger,
      signalConfig:signalConfig,
      streamerConfig:streamerConfig,
    });

    logger.info("Node: creating streamer");

    const streamerWindow = await winProvider.createWindow({
      height: 900,
      logger,
      url: "file:thisWillLoadIndex.html", // "chrome://webrtc-internals", // local file is better to get code maps loaded in dev tools, create a index.html in dist..
      webPreferences: {
        // this is what triggers our actual streamer logic (webrtc init and whatnot)
        preload: path.join(__dirname, "/../browser/main.js"),
        contextIsolation: false,
        sandbox: false
      },
      width: 1280,
    });
    streamerWindow.toBrowserWindow().webContents.openDevTools();
    streamerWindow.toBrowserWindow().show();

    logger.info("Node: created streamer");

    // if we're running the hide_streamer flight, hide it
    if (expHideStreamer) {
      streamerWindow.hide();
      logger.info("Node: experiment - hiding streamer window");
    }
  }

  /**
   * Set globals
   * @param opts the global values
   */
  private setGlobals(thing: Partial<IApplicationOpts>) {
    const glob: { [key: string]: any } = {};
    glob[K_CAPTURE_WIN] = thing.captureWindowTitle;
    glob[K_CAPTURE_WINID] = thing.captureWindowId;
    glob[K_PRELOAD_LOGGER_KEY] = thing.logger;
    glob[K_BROWSER_CONFIG] = thing.streamerConfig;
    glob[K_SIGNAL_CONFIG] = thing.signalConfig;
    (global as any)[K_BROWSER_STORAGE] = glob;
  }
}
