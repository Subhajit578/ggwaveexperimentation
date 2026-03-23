import { useEffect, useRef, useState } from "react";
import {
  GGWAVE_PROTOCOLS,
  useGgwave,
} from "../hooks/useGgwave";
import type { GgwaveProtocolMode } from "../hooks/useGgwave";

declare const ggwave_factory: any;

type NearbyDevice = {
  id: string;
  lastSeen: number;
};

export default function PresenceDetector() {
  const [mode, setMode] = useState<GgwaveProtocolMode>("audible");
  const { sendMessage, isTransmittingNow } = useGgwave(mode);
  const [deviceId, setDeviceId] = useState("A101");
  const [meetingId, setMeetingId] = useState("demo-room");
  const [broadcasting, setBroadcasting] = useState(false);
  const [listening, setListening] = useState(false);
  const [nearbyDevices, setNearbyDevices] = useState<NearbyDevice[]>([]);
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

  const broadcastIntervalRef = useRef<number | null>(null);

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

  function buildBeaconPayload() {
    return `DEVICE:${deviceId}|MEETING:${meetingId}`;
  }

  function parseBeacon(message: string) {
    const parts = message.split("|");
    const parsed: Record<string, string> = {};

    for (const part of parts) {
      const [key, value] = part.split(":");
      if (key && value) {
        parsed[key] = value;
      }
    }

    return parsed;
  }

  async function startBroadcasting() {
    try {
      const payload = buildBeaconPayload();

      setBroadcasting(true);
      setTransmitAttempts((prev) => prev + 1);
      await sendMessage(payload, { protocolMode: mode });
      setGateActive(isTransmittingNow());

      broadcastIntervalRef.current = window.setInterval(async () => {
        try {
          setTransmitAttempts((prev) => prev + 1);
          await sendMessage(buildBeaconPayload(), { protocolMode: mode });
          setGateActive(isTransmittingNow());
        } catch (error) {
          console.error("Broadcast error:", error);
        }
      }, 3000);
    } catch (error) {
      console.error("Failed to start broadcasting:", error);
      setBroadcasting(false);
    }
  }

  function stopBroadcasting() {
    setBroadcasting(false);

    if (broadcastIntervalRef.current !== null) {
      clearInterval(broadcastIntervalRef.current);
      broadcastIntervalRef.current = null;
    }
  }

  async function handleStartListening() {
    try {
      if (recorderRef.current) return;

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
          console.log("Decoded beacon:", text);
          setDecodeCount((prev) => prev + 1);
          setDecodeEvents((prev) => [...prev, eventRecord]);

          const parsed = parseBeacon(text);

          if (!parsed.DEVICE || !parsed.MEETING) return;
          if (parsed.MEETING !== meetingId) return;
          if (parsed.DEVICE === deviceId) return;

          setNearbyDevices((prev) => {
            const now = Date.now();
            const existing = prev.find((device) => device.id === parsed.DEVICE);

            if (existing) {
              return prev.map((device) =>
                device.id === parsed.DEVICE
                  ? { ...device, lastSeen: now }
                  : device
              );
            }

            return [...prev, { id: parsed.DEVICE, lastSeen: now }];
          });
        }
      };

      mediaSourceRef.current.connect(recorder);
      recorder.connect(context.destination);
      recorderRef.current = recorder;

      setListening(true);
    } catch (error) {
      console.error("Failed to start listening:", error);
      setListening(false);
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

    setListening(false);
  }

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
    link.download = `presence-log-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    const cleanupInterval = window.setInterval(() => {
      const now = Date.now();

      setNearbyDevices((prev) =>
        prev.filter((device) => now - device.lastSeen < 10000)
      );
    }, 1000);

    return () => {
      clearInterval(cleanupInterval);
      stopBroadcasting();
      handleStopListening();
    };
  }, []);

  return (
    <div>
      <h2>Presence Detection</h2>

      <div style={{ display: "grid", gap: "12px", maxWidth: "500px" }}>
        <label>
          My Device ID
          <br />
          <input
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Meeting ID
          <br />
          <input
            value={meetingId}
            onChange={(e) => setMeetingId(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Protocol Mode
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
          {!broadcasting ? (
            <button onClick={startBroadcasting}>Start Broadcasting</button>
          ) : (
            <button onClick={stopBroadcasting}>Stop Broadcasting</button>
          )}

          {!listening ? (
            <button onClick={handleStartListening}>Start Listening</button>
          ) : (
            <button onClick={handleStopListening}>Stop Listening</button>
          )}
          <button onClick={exportLog} disabled={decodeEvents.length === 0}>
            Export Log JSON
          </button>
        </div>

        <div>
          <strong>Broadcasting:</strong> {broadcasting ? "ON" : "OFF"}
        </div>

        <div>
          <strong>Listening:</strong> {listening ? "ON" : "OFF"}
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

        <div>
          <strong>Nearby Devices</strong>
          {nearbyDevices.length === 0 ? (
            <p>No nearby devices detected.</p>
          ) : (
            <ul>
              {nearbyDevices.map((device) => (
                <li key={device.id}>
                  {device.id} — last seen{" "}
                  {Math.floor((Date.now() - device.lastSeen) / 1000)}s ago
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}