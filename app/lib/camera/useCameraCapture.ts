"use client";

// Rear-camera capture lifecycle for the Kanji screen's Camera mode.
//
// Owns getUserMedia, the permission/availability state machine, and a single
// still-frame grab. Capture mode is deliberately "snap a still, then process"
// (not live 30fps recognition) — the recognizer runs in WASM and the pixel
// pre-stage is one-shot, so a frame grab on the shutter is all we need (see
// photo_probe/FINDINGS.md §9).
//
// The hook is camera-only: it hands back a `videoRef` to attach to a <video>
// and a `grabFrame()` that rasterizes the current frame at intrinsic
// resolution. Cropping to the guide box and the pixel pipeline live in the
// caller (CameraPanel → imagePreprocess.ts), where the layout is known.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type CameraStatus =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "streaming" }
  /** Permission was refused (or blocked by policy). Recoverable via retry once
   *  the user grants access. */
  | { kind: "denied" }
  /** No getUserMedia / not a secure context — camera can't be used here at all. */
  | { kind: "unsupported" }
  /** Secure + permitted, but the device has no usable camera. */
  | { kind: "nocamera" }
  | { kind: "error"; message: string };

export type CameraCapture = {
  status: CameraStatus;
  /** Attach to a `<video muted playsInline>` rendered while streaming. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Request the rear camera and begin streaming. No-op if already active. */
  start: () => void;
  /** Stop all tracks and detach. Idempotent; also runs on unmount. */
  stop: () => void;
  /** Rasterize the current frame to a canvas at intrinsic resolution. Returns
   *  null when not yet streaming a real frame. */
  grabFrame: () => HTMLCanvasElement | null;
};

/** getUserMedia needs a secure context (https / localhost). Probe defensively —
 *  SSR has no navigator/window. */
function cameraSupported(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

export function useCameraCapture(): CameraCapture {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Mirrors the active stream into render so the attach effect fires once the
  // <video> is mounted (status flips to "streaming" → video renders → attach).
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>({ kind: "idle" });
  // Guards against a getUserMedia promise resolving after the user navigated
  // away (or React Strict Mode's mount/unmount/remount) — we tear the stream
  // straight back down if we're no longer active.
  const activeRef = useRef(false);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
    setStatus({ kind: "idle" });
  }, []);

  const start = useCallback(async () => {
    if (!cameraSupported()) {
      setStatus({ kind: "unsupported" });
      return;
    }
    if (activeRef.current) return; // already requesting/streaming
    activeRef.current = true;
    setStatus({ kind: "requesting" });
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!activeRef.current) {
        // Stopped while awaiting permission — discard the late stream.
        for (const track of next.getTracks()) track.stop();
        return;
      }
      streamRef.current = next;
      setStream(next);
      setStatus({ kind: "streaming" });
    } catch (err) {
      activeRef.current = false;
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus({ kind: "denied" });
      } else if (
        name === "NotFoundError" ||
        name === "DevicesNotFoundError" ||
        name === "OverconstrainedError"
      ) {
        setStatus({ kind: "nocamera" });
      } else {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, []);

  // Attach the stream to the <video> once both exist. Runs after the render
  // that mounts the element (status === "streaming").
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      void video.play().catch(() => {
        /* autoplay can reject if interrupted; the frame still renders */
      });
    }
  }, [stream]);

  // Release the camera when the panel unmounts (leaving Camera mode).
  useEffect(() => stop, [stop]);

  const grabFrame = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  return { status, videoRef, start, stop, grabFrame };
}

/** Exposed so the Kanji screen can gate the Camera mode entry without
 *  duplicating the secure-context probe. */
export { cameraSupported };
