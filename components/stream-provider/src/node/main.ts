import { config } from "dotenv";
import { app as electronApp, desktopCapturer, ipcMain, BrowserWindow as ElectronBrowserWindow } from 'electron';
import pino from "pino";
import url from "url";
import { Application } from "./application";
import { requestTwilioTurnServer } from "./turn";
import { Win } from "./win";

// we'll export this and use it for testing
// it won't impact the runtime as the runtime ignores it
let runtimeIgnoredExportSuccess: () => void;
let runtimeIgnoredExportFailure: (err: Error) => void;
const runtimeIgnoredExportValue: Promise<void> = new Promise((resolve, reject) => {
  runtimeIgnoredExportSuccess = resolve;
  runtimeIgnoredExportFailure = reject;
});

const logger = pino();

/**
 * Configure dotenv - Supported values:
 * + SERVICE_URL (string) - the web service address (to render)
 * + TURN_URL (string) - a turn address
 * + TURN_USERNAME (string) - a turn username
 * + TURN_PASSWORD (string) - a turn password credential
 * + POLL_URL (string) - a signaling server base address
 * + POLL_INTERVAL (number) - a signaling poll interval in ms
 * + HEIGHT (number) - the window height
 * + WIDTH (number) - the window width
 * + EXP_HIDE_STREAMER (boolean) - experiment flag for hiding the streamer window
 * + TWILIO_ACCOUNT_SID (string) - a Twilio AccountSid required to get a Network Traversal Service Token
 * + TWILIO_AUTH_TOKEN (string) - a Twilio AuthToken required to get a Network Traversal Service Token
 */
const dotenv = config();
let mutableEnv: { [key: string]: string | undefined } = {};
if (dotenv.error) {
  logger.warn(`dotenv failed: ${dotenv.error}`);
}
mutableEnv = { ...process.env, ...dotenv.parsed };
const env: { [key: string]: string } = mutableEnv as { [key: string]: string };

// early exit if missing critical environment variables
[
  "SERVICE_URL",
  "POLL_URL",
  "POLL_INTERVAL",
  "WIDTH",
  "HEIGHT",
  "EXP_HIDE_STREAMER",
].filter((expectedEnvKey) => {
  return env[expectedEnvKey] === undefined;
}).forEach((key) => {
  const errorText = `missing env: ${key}`;
  logger.error(errorText);
  process.exit(-1);
  runtimeIgnoredExportFailure(new Error(errorText));
});

// keep the app in global memory, to prevent gc
let app: Application;

electronApp.on("ready", async () => {
  let iceServers: RTCIceServer[] = [
    {
      credential: env.TURN_PASSWORD,
      //   credentialType: "password",
      urls: [env.TURN_URL],
      username: env.TURN_USERNAME,
    },
  ];

  // if we have twilio info, we'll use that (overriding raw TURN credentials)
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    iceServers = await requestTwilioTurnServer(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN).catch((err: any) => {
      const errorText = `Node: Twilio failed: ${err}`;
      logger.error(errorText);
      process.exit(-2);
      runtimeIgnoredExportFailure(new Error(errorText));
    }).then(() => []);
    logger.info("Node: using Twilio");
  }

  app = new Application({
    captureWindowTitle: url.parse(env.SERVICE_URL || "no-window").hostname as string,
    captureWindowId: 0,
    expHideStreamer: env.EXP_HIDE_STREAMER === "true",
    height: Number.parseInt(env.HEIGHT, 10).valueOf(),
    logger,
    signalConfig: {
      pollIntervalMs: Number.parseInt(env.POLL_INTERVAL, 10).valueOf(),
      url: env.POLL_URL,
    },
    streamerConfig: {
      iceServers,
    },
    url: env.SERVICE_URL,
    width: Number.parseInt(env.WIDTH, 10).valueOf(),
    winProvider: new Win(),
  });

  app.boot().then(() => {
    logger.info("Node: booted");
    runtimeIgnoredExportSuccess();
  }, (err) => {
    logger.error(`Node: boot failed: ${err}`, err.stack);
    runtimeIgnoredExportFailure(err);
  });
});

// IPC handlers

ipcMain.handle('getGlobal', async (event, someArgument) => {
  logger.info("ipcMain.handle 'getGlobal'", someArgument);
  let result = (global as any)[someArgument];
  let json = JSON.stringify(result);
  // console.log(json);
  return json;
});

ipcMain.handle('getSources', async (event, someArgument) => {
  let result = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  logger.info("ipcMain.handle 'getSources' result:", JSON.stringify(result));

  // missing electron windows :( https://github.com/electron/electron/issues/29931

  // workaround ???
  result = [];
  for(let win of ElectronBrowserWindow.getAllWindows()) {
    logger.info(`ipcMain.handle 'getSources' - win data: ${win.title} ${win.getMediaSourceId()} `);
    (result as any).push({name: win.title, id: win.getMediaSourceId()});
  }

  return result;
});

ipcMain.on('sendInputEvent', (event, winid, evt) => {
  // logger.info(`sendInputEvent winid:${winid} ${JSON.stringify(evt)}`);

  for(let win of ElectronBrowserWindow.getAllWindows()) {
    if(win.id == winid) {
      win.webContents.sendInputEvent(evt);
      break;
    }
  }
});

ipcMain.on('sendWindowEvent', (event, winid, evt) => {
  // e.g. resize
  if(evt.type == 'resize') {
    logger.info(`sendWindowEvent winid:${winid} evt:${JSON.stringify(evt.data)}`);
    for(let win of ElectronBrowserWindow.getAllWindows()) {
      if(win.id == winid) {
        win.setSize(evt.data.width, evt.data.height);
        break;
      }
    }
  }
});
// module.exports = runtimeIgnoredExportValue;
