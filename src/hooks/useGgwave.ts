import { useRef } from "react";

declare const ggwave_factory: any;

export const GGWAVE_PROTOCOLS = {
  audible: {
    label: "Audible (Fast)",
    idKey: "GGWAVE_PROTOCOL_AUDIBLE_FAST",
  },
  nearUltrasonic: {
    label: "Near Ultrasonic (Fast)",
    idKey: "GGWAVE_PROTOCOL_DT_FASTEST",
  },
  ultrasonic: {
    label: "Ultrasonic (Fast)",
    idKey: "GGWAVE_PROTOCOL_ULTRASOUND_FAST",
  },
} as const;

export type GgwaveProtocolMode = keyof typeof GGWAVE_PROTOCOLS;

type SendOptions = {
  protocolMode?: GgwaveProtocolMode;
  volume?: number;
};

export function useGgwave(defaultProtocolMode: GgwaveProtocolMode = "audible") {
  const audioContextRef = useRef<AudioContext | null>(null);
  const ggwaveRef = useRef<any>(null);
  const instanceRef = useRef<any>(null);
  const txEndsAtRef = useRef(0);

  function convertTypedArray(src: ArrayBufferView, Type: any) {
    const buffer = new ArrayBuffer(src.byteLength);
    new Uint8Array(buffer).set(
      new Uint8Array(src.buffer, src.byteOffset, src.byteLength)
    );
    return new Type(buffer);
  }

  async function init() {
    if (!audioContextRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext!;

      audioContextRef.current = new AudioCtx({ sampleRate: 48000 });
    }

    if (!ggwaveRef.current) {
      ggwaveRef.current = await ggwave_factory();
    }

    if (!instanceRef.current) {
      const parameters = ggwaveRef.current.getDefaultParameters();
      parameters.sampleRateInp = audioContextRef.current.sampleRate;
      parameters.sampleRateOut = audioContextRef.current.sampleRate;
      instanceRef.current = ggwaveRef.current.init(parameters);
    }
  }

  async function sendMessage(
    text: string,
    options?: SendOptions
  ) {
    await init();

    const context = audioContextRef.current!;
    const ggwave = ggwaveRef.current;
    const instance = instanceRef.current;
    const volume = options?.volume ?? 10;
    const protocolMode = options?.protocolMode ?? defaultProtocolMode;

    if (context.state === "suspended") {
      await context.resume();
    }

    const protocolConfig = GGWAVE_PROTOCOLS[protocolMode];
    const protocol = ggwave.ProtocolId[protocolConfig.idKey];

    const waveform = ggwave.encode(instance, text, protocol, volume);
    const buf = convertTypedArray(waveform, Float32Array);
    const transmitDurationMs = Math.ceil((buf.length / context.sampleRate) * 1000);

    const audioBuffer = context.createBuffer(1, buf.length, context.sampleRate);
    audioBuffer.getChannelData(0).set(buf);

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    txEndsAtRef.current = Date.now() + transmitDurationMs;
    source.onended = () => {
      if (Date.now() >= txEndsAtRef.current) {
        txEndsAtRef.current = 0;
      }
    };
    source.start(0);

    return {
      protocolMode,
      transmitDurationMs,
      gateUntil: txEndsAtRef.current,
    };
  }

  function isTransmittingNow() {
    return Date.now() < txEndsAtRef.current;
  }

  return {
    init,
    sendMessage,
    isTransmittingNow,
  };
}