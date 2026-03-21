import { useRef } from "react";

declare const ggwave_factory: any;

export function useGgwave() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const ggwaveRef = useRef<any>(null);
  const instanceRef = useRef<any>(null);

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
    protocolId?: number,
    volume: number = 10
  ) {
    await init();

    const context = audioContextRef.current!;
    const ggwave = ggwaveRef.current;
    const instance = instanceRef.current;

    if (context.state === "suspended") {
      await context.resume();
    }

    const protocol =
      protocolId ?? ggwave.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST;

    const waveform = ggwave.encode(instance, text, protocol, volume);
    const buf = convertTypedArray(waveform, Float32Array);

    const audioBuffer = context.createBuffer(1, buf.length, context.sampleRate);
    audioBuffer.getChannelData(0).set(buf);

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    source.start(0);
  }

  return {
    init,
    sendMessage,
  };
}