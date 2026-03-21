import { useEffect, useRef, useState } from "react";
import { useGgwave } from "../hooks/useGgwave";

declare const ggwave_factory: any;

export default function CapabilityTest() {
  const { sendMessage } = useGgwave();

  const [deviceId, setDeviceId] = useState("DEVICE_A");
  const [mode, setMode] = useState("audible");
  const [status, setStatus] = useState("Idle");
  const [lastDecoded, setLastDecoded] = useState("");
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

  async function initReceiver() {
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

  async function handleBroadcast() {
    try {
      setStatus(`Broadcasting test from ${deviceId}`);
      await sendMessage(`TEST_SIGNAL_FROM_${deviceId}`);
    } catch (error) {
      console.error(error);
      setStatus("Broadcast failed");
    }
  }

  async function handleStartListening() {
    try {
      await initReceiver();

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
          setLastDecoded(text);
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

  function handleStopListening() {
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
    setStatus("Stopped listening");
  }

  useEffect(() => {
    return () => {
      handleStopListening();
    };
  }, []);

  return (
    <div>
      <h2>Capability Test</h2>

      <div style={{ display: "grid", gap: "12px", maxWidth: "400px" }}>
        <label>
          Device ID
          <br />
          <input
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Mode
          <br />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="audible">Audible</option>
            <option value="ultrasonic">Near Ultrasonic</option>
          </select>
        </label>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={handleBroadcast}>Broadcast Test Signal</button>

          {!isListening ? (
            <button onClick={handleStartListening}>Start Listening</button>
          ) : (
            <button onClick={handleStopListening}>Stop Listening</button>
          )}
        </div>

        <div>
          <strong>Status:</strong> {status}
        </div>

        <div>
          <strong>Last Decoded Signal:</strong>{" "}
          {lastDecoded || "Nothing decoded yet"}
        </div>
      </div>
    </div>
  );
}