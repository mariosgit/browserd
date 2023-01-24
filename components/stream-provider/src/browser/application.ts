import { BaseSignalProvider } from "@browserd/shared";
import { Logger } from "pino";
import { v4 as uuid } from "uuid";
import { IApplication } from "../base/application";
import { IInputHandler, IInputMessage } from "../base/input-handler";
import { IStreamProvider } from "../base/stream-provider";
import { BaseWebrtcProvider } from "../base/webrtc-provider";

/**
 * Application constructor options
 */
export interface IApplicationOpts {
  /**
   * A logger
   */
  logger: Logger;

  /**
   * The name of the capture window
   */
  captureWindowTitle: string;

  /**
   * The ice servers to use
   */
  iceServers: RTCIceServer[];

  /**
   * The signal provider to use
   */
  signalProvider: BaseSignalProvider;

  /**
   * The stream provider to use
   */
  streamProvider: IStreamProvider;

  /**
   * The webrtc provider to use
   */
  webrtcProvider: BaseWebrtcProvider;

  /**
   * The input handler to use
   */
  inputHandler: IInputHandler;
}

/**
 * A browser application - orchestrates the streamer experience
 */
export class Application implements IApplication {
  private opts: IApplicationOpts;

  /**
   * Default ctor
   * @param opts ctor options
   */
  constructor(opts: IApplicationOpts) {
    this.opts = opts;
  }

  /**
   * Internal boot helper
   */
  public async boot() {
    const {
      logger,
      captureWindowTitle,
      iceServers,
      signalProvider,
      streamProvider,
      webrtcProvider,
      inputHandler } = this.opts;
    logger.info("Browser: initializing application", this.opts);

    const rawDevices = await streamProvider.enumerateDevices();
    if (rawDevices.length > 0) {
      logger.info("Browser: found available devices", rawDevices);
    } else {
      throw new Error(`Unable to find devices`);
    }
    for (let rawDev of rawDevices) {
      logger.info(JSON.stringify(rawDev));
    }

    const matchedDevice = rawDevices.find((e) => e.name === captureWindowTitle);
    if (matchedDevice) {
      logger.info(`Browser: found device matching ${captureWindowTitle}`, matchedDevice);
    } else {
      logger.info(`Browser: selecting first device`, rawDevices[0]);
    }

    const selectedDevice = matchedDevice || rawDevices[0];
    logger.info("Browser: selected device", selectedDevice);

    const stream = await streamProvider.createStream(selectedDevice);

    webrtcProvider.initialize(iceServers, stream);
    await signalProvider.signIn(`${captureWindowTitle}.${uuid()}`);

    let remotePeerId: string;

    signalProvider.on("error", (err) => {
      logger.error(`signalProvider.on "error": signal error: ${err}`);
    });
    signalProvider.on("peer-message", async (data, id) => {
      remotePeerId = id;

      const parsed = JSON.parse(data);
      // rewrap
      if (parsed.candidate) {
        parsed.candidate = { candidate: parsed.candidate };
      }
      webrtcProvider.signal(parsed);
      logger.info('signalProvider.on "peer-message"', parsed);
    });


    webrtcProvider.on("error", (err) => {
      logger.error('webrtcProvider.on "error"', err);
    });
    webrtcProvider.on("connect", async () => {
      logger.info('webrtcProvider.on "connect" ');
    });
    webrtcProvider.on("disconnect", async () => {
      logger.info('webrtcProvider.on "disconnect"');
      await signalProvider.signOut();
      // restart...  //peer:  already initialiced... ??? Without it ..  Error: cannot signal after peer is destroyed :(
      webrtcProvider.initialize(iceServers, stream);
      await signalProvider.signIn(`${captureWindowTitle}.${uuid()}`);
    });

    webrtcProvider.on("signal", async (data) => {
      // unwrap
      if (data.candidate) {
        data = data.candidate;
      }
      await signalProvider.send(JSON.stringify(data), remotePeerId);
      logger.info('webrtcProvider.on "signal" reply to:', remotePeerId);
    });
    webrtcProvider.on("data", (data) => {
      data = data.toString();
      logger.info('webrtcProvider.on "data" ');
      if (inputHandler) {
        inputHandler.processAndRaiseMessage(JSON.parse(data) as IInputMessage);
      } else {
        logger.warn('webrtcProvider.on("data"... missing inputHandler', data);
      }
    });


  }
}
