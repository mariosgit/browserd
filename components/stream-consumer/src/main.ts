import $ from "jquery";
import pino from "pino";
import SimplePeer from "simple-peer";
import { v4 as uuid } from "uuid";
import { Signal } from "../../shared/src/signal";
import { BaseSignalProvider, ISignalPeer } from "../../shared/src/signal-provider";
import { HtmlInputEvents, InputMonitor } from "./input";

const logger = pino();
/**
 * Connect to signaling server and get stream provider id
 */
export const signIn = async (signalProvider: BaseSignalProvider) => {
  // Generate a random uuid for peer name
  const peerName = uuid();

  // Get stream provider id
  let streamProviderId;
  const peers = await signalProvider.signIn(peerName);
  console.log("signIn:peers:", peers);
  const streamConsumerId = signalProvider.id;
  peers.forEach((peer: ISignalPeer) => {
    if (peer.connected && peer.id !== streamConsumerId) {
      streamProviderId = peer.id;
    }
  });

  if (!streamProviderId) {
    throw new Error("Couldn't find any stream provider");
  }

  return streamProviderId;
};

/**
 * Connect to stream provider and render video
 */
export const connect = async () => {
  // Init signal provider
  const signalProvider = new Signal({
    pollIntervalMs: $("#poll-interval").val() as number,
    url: $("#signaling-server").val() as string,
  });

  signalProvider.on("error", (err) => {
    logger.error(`Signal error: ${err}`);
  });

  signalProvider.on("peer-message", (data) => {
    logger.info(data);
    const parsed = JSON.parse(data);

    // rewrap
    if (parsed.candidate) {
      parsed.candidate = {
        candidate: parsed.candidate,
        sdpMLineIndex: parsed.sdpMLineIndex,
        sdpMid: parsed.sdpMid,
      };
    }

    peer.signal(parsed);
  });

  // Get stream provider Id
  const providerId = await signIn(signalProvider);

  // Init simple peer
  const iceServers: RTCIceServer[] = [
    {
      credential: $("#turn-password").val() as string,
      //   credentialType: "password",
      urls: [$("#turn-server").val() as string],
      username: $("#turn-username").val() as string,
    },
  ];

  const peer = new SimplePeer({
    config: {
      iceServers,
    },
    initiator: true,
    trickle: false,
  });

  peer.on("error", (err) => logger.error(err));
  peer.on("connect", () => logger.info("connect"));
  peer.on("close", () => logger.info("disconnect"));
  peer.on("signal", async (data) => {
    // unwrap
    if ((data as any).candidate) {
      data = (data as any).candidate;
    }

    await signalProvider.send(JSON.stringify(data), providerId);
  });

  peer.on("stream", (rstream: MediaStream) => {
    startStreaming(rstream, peer);
  });

  // save settings
  const store = window.localStorage;
  store.setItem('turn', $("#turn-server").val() as string);
  store.setItem('sign', $("#signaling-server").val() as string);
  store.setItem('uname', $("#turn-username").val() as string);
  store.setItem('upass', $("#turn-password").val() as string);
  store.setItem('poll', $("#poll-interval").val() as string);

};

export const startStreaming = (rstream: MediaStream, peer: SimplePeer.Instance) => {
  // Play video
  const videoElement = $("#remote-video") as any as HTMLVideoElement[];
  videoElement[0].srcObject = rstream;
  videoElement[0].play();

  // Input handling
  const inputMonitor = new InputMonitor(videoElement[0]);
  const sendInputToPeer = (data: any) => {
    // console.log('sendInputToPeer', data);
    peer.send(JSON.stringify(data));
  };

  inputMonitor.on(HtmlInputEvents.Mouseup, sendInputToPeer);
  inputMonitor.on(HtmlInputEvents.Mousedown, sendInputToPeer);
  inputMonitor.on(HtmlInputEvents.Mousemove, sendInputToPeer);
  inputMonitor.on(HtmlInputEvents.Wheel, sendInputToPeer);
};

$(document).ready(() => {
  $("#connect").click(() => connect());

  // populate settings
  const store = window.localStorage;
  let turn = store.getItem('turn');
  let sign = store.getItem('sign');
  let uname = store.getItem('uname');
  let upass = store.getItem('upass');
  let poll = store.getItem('poll');
  if (turn && sign && uname && upass && poll) {
    $("#poll-interval").val(poll);
    $("#signaling-server").val(sign);
    $("#turn-password").val(upass);
    $("#turn-server").val(turn);
    $("#turn-username").val(uname);
  }
});
