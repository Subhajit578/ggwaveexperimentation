import { useEffect, useRef, useState } from "react";
import {
  GGWAVE_PROTOCOLS,
  useGgwave,
} from "../hooks/useGgwave";
import type { GgwaveProtocolMode } from "../hooks/useGgwave";

declare const ggwave_factory: any;

export default function CapabilityTest() {
  const [mode, setMode] = useState<GgwaveProtocolMode>("audible");
  const { sendMessage, isTransmittingNow } = useGgwave(mode);

  const [message, setMessage] = useState("HELLO");
  const [status, setStatus] = useState("Idle");
  const [lastDecoded, setLastDecoded] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [distanceMeters, setDistanceMeters] = useState("1");
  const [sessionNote, setSessionNote] = useState("");
  const [decodeCount, setDecodeCount] = useState(0);
  const [transmitAttempts, setTransmitAttempts] = useState(0);
  const [gateActive, setGateActive] = useState(false);
  const [decodeEvents, setDecodeEvents] = useState<
    {
      timestamp: string;
      protocolMode: GgwaveProtocolMode;
      decodedMessage: string;
      distanceMeters: number | null;
      gatingActive: boolean;
      note: string;
    }[]
  >([]);

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
      if (!message.trim()) {
        setStatus("Please enter a message");
        return;
      }

      setStatus(`Broadcasting: ${message}`);
      setTransmitAttempts((prev) => prev + 1);
      const txInfo = await sendMessage(message, { protocolMode: mode });
      setGateActive(isTransmittingNow());
      setStatus(
        `Broadcasting: ${message} (${txInfo.protocolMode}, gate ${txInfo.transmitDurationMs}ms)`
      );
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
        if (isTransmittingNow()) {
          setGateActive(true);
          return;
        }

        setGateActive(false);
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
          const eventRecord = {
            timestamp: new Date().toISOString(),
            protocolMode: mode,
            decodedMessage: text,
            distanceMeters: Number.isFinite(Number(distanceMeters))
              ? Number(distanceMeters)
              : null,
            gatingActive: false,
            note: sessionNote.trim(),
          };
          console.log("Decoded:", text);
          setLastDecoded(text);
          setDecodeCount((prev) => prev + 1);
          setDecodeEvents((prev) => [...prev, eventRecord]);
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

  function exportLog() {
    const payload = {
      exportedAt: new Date().toISOString(),
      protocolMode: mode,
      distanceMeters: Number.isFinite(Number(distanceMeters))
        ? Number(distanceMeters)
        : null,
      note: sessionNote.trim(),
      transmitAttempts,
      decodeCount,
      successRate:
        transmitAttempts === 0
          ? 0
          : Number(((decodeCount / transmitAttempts) * 100).toFixed(2)),
      decodeEvents,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `capability-log-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2>Capability Test</h2>

      <div style={{ display: "grid", gap: "12px", maxWidth: "400px" }}>
        <label>
          Message
          <br />
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Mode
          <br />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as GgwaveProtocolMode)}
            style={{ width: "100%" }}
          >
            {Object.entries(GGWAVE_PROTOCOLS).map(([value, config]) => (
              <option key={value} value={value}>
                {config.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Distance (meters)
          <br />
          <input
            type="number"
            min="0"
            step="0.1"
            value={distanceMeters}
            onChange={(e) => setDistanceMeters(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Session Note / Label
          <br />
          <input
            value={sessionNote}
            onChange={(e) => setSessionNote(e.target.value)}
            placeholder="through wall, AEC enabled, etc."
            style={{ width: "100%" }}
          />
        </label>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={handleBroadcast}>Broadcast Message</button>

          {!isListening ? (
            <button onClick={handleStartListening}>Start Listening</button>
          ) : (
            <button onClick={handleStopListening}>Stop Listening</button>
          )}
          <button onClick={exportLog} disabled={decodeEvents.length === 0}>
            Export Log JSON
          </button>
        </div>

        <div>
          <strong>Status:</strong> {status}
        </div>

        <div>
          <strong>Last Decoded Signal:</strong>{" "}
          {lastDecoded || "Nothing decoded yet"}
        </div>

        <div>
          <strong>Transmission Attempts:</strong> {transmitAttempts}
        </div>

        <div>
          <strong>Decode Count:</strong> {decodeCount}
        </div>

        <div>
          <strong>Success Rate:</strong>{" "}
          {transmitAttempts === 0
            ? "0%"
            : `${((decodeCount / transmitAttempts) * 100).toFixed(2)}%`}
        </div>

        <div>
          <strong>Receiver Gating:</strong> {gateActive ? "ACTIVE" : "INACTIVE"}
        </div>
      </div>
    </div>
  );
}