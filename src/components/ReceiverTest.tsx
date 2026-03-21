import { useRef, useState } from "react";

declare const ggwave_factory: any;

export default function ReceiverTest() {
  const [status, setStatus] = useState("Idle");
  const [decoded, setDecoded] = useState("");
  const [isListening, setIsListening] = useState(false);

  const contextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<ScriptProcessorNode | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
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
    if (!contextRef.current) {
      contextRef.current = new AudioContext({ sampleRate: 48000 });
    }

    if (!ggwaveRef.current) {
      ggwaveRef.current = await ggwave_factory();
    }

    if (!instanceRef.current) {
      const parameters = ggwaveRef.current.getDefaultParameters();
      parameters.sampleRateInp = contextRef.current.sampleRate;
      parameters.sampleRateOut = contextRef.current.sampleRate;
      instanceRef.current = ggwaveRef.current.init(parameters);
    }
  }

  async function startListening() {
    try {
      await init();

      const context = contextRef.current!;
      const ggwave = ggwaveRef.current;
      const instance = instanceRef.current;

      if (context.state === "suspended") {
        await context.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
      });

      mediaStreamRef.current = stream;
      mediaSourceRef.current = context.createMediaStreamSource(stream);

      const recorder = context.createScriptProcessor(1024, 1, 1);

      recorder.onaudioprocess = (event) => {
        const source = event.inputBuffer;
        const res = ggwave.decode(
          instance,
          convertTypedArray(
            new Float32Array(source.getChannelData(0)),
            Int8Array
          )
        );

        if (res && res.length > 0) {
          const text = new TextDecoder("utf-8").decode(res);
          console.log("Decoded:", text);
          setDecoded(text);
          setStatus("Signal detected");
        }
      };

      mediaSourceRef.current.connect(recorder);
      recorder.connect(context.destination);
      recorderRef.current = recorder;

      setStatus("Listening...");
      setIsListening(true);
    } catch (error) {
      console.error(error);
      setStatus("Listening failed");
    }
  }

  function stopListening() {
    if (recorderRef.current) {
      recorderRef.current.disconnect();
      recorderRef.current = null;
    }

    if (mediaSourceRef.current) {
      mediaSourceRef.current.disconnect();
      mediaSourceRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setIsListening(false);
    setStatus("Stopped");
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Receiver Test</h2>
      <div style={{ display: "flex", gap: 8 }}>
        {!isListening ? (
          <button onClick={startListening}>Start Listening</button>
        ) : (
          <button onClick={stopListening}>Stop Listening</button>
        )}
      </div>

      <p>
        <strong>Status:</strong> {status}
      </p>
      <p>
        <strong>Decoded:</strong> {decoded || "Nothing yet"}
      </p>
    </div>
  );
}