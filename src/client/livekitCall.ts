import { Room, RoomEvent, Track } from "livekit-client";

interface RemoteAudioTrackLike {
  sid?: string;
  kind?: string;
  attach(): HTMLMediaElement;
  detach(): HTMLMediaElement[];
}

interface LiveKitRoomLike {
  connect(
    url: string,
    token: string,
    options?: {
      peerConnectionTimeout?: number;
      websocketTimeout?: number;
    },
  ): Promise<void>;
  disconnect(): void;
  localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  };
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  off(event: string, handler: (...args: unknown[]) => void): unknown;
}

interface ConnectLiveKitCallInput {
  wsUrl: string;
  token: string;
  roomFactory?: () => LiveKitRoomLike;
  onDisconnected?: () => void;
  onConnectionQualityChanged?: (quality: string) => void;
  timeoutMs?: number;
}

export interface LiveKitCallConnection {
  close(): void;
}

export async function connectLiveKitCall(input: ConnectLiveKitCallInput): Promise<LiveKitCallConnection> {
  const room = input.roomFactory?.() ?? new Room();
  const remoteAudioElements = new Map<RemoteAudioTrackLike, HTMLMediaElement>();
  const onDisconnected = () => input.onDisconnected?.();
  const onConnectionQualityChanged = (quality: unknown) => input.onConnectionQualityChanged?.(String(quality));
  const onTrackSubscribed = (track: unknown) => {
    if (!isRemoteAudioTrack(track)) {
      return;
    }

    const element = track.attach();
    element.autoplay = true;
    element.setAttribute("playsinline", "true");
    element.dataset.livekitRemoteAudio = track.sid ?? "remote-audio";
    element.style.display = "none";
    document.body.appendChild(element);
    remoteAudioElements.set(track, element);
    void element.play().catch(() => {
      // A user-clicked call start should usually allow playback, but keep the
      // element attached so the browser can resume once audio is unlocked.
    });
  };
  const onTrackUnsubscribed = (track: unknown) => {
    if (isRemoteAudioTrack(track)) {
      detachRemoteAudioTrack(track, remoteAudioElements);
    }
  };
  const timeoutMs = input.timeoutMs ?? 30000;

  room.on(RoomEvent.Disconnected, onDisconnected);
  room.on(RoomEvent.ConnectionQualityChanged, onConnectionQualityChanged);
  room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
  try {
    await withTimeout(
      room.connect(input.wsUrl, input.token, {
        peerConnectionTimeout: timeoutMs,
        websocketTimeout: Math.min(timeoutMs, 15000),
      }),
      timeoutMs + 1000,
      "LiveKit room connection timed out",
    );
  } catch (error) {
    cleanupLiveKitRoom(room, {
      onDisconnected,
      onConnectionQualityChanged,
      onTrackSubscribed,
      onTrackUnsubscribed,
      remoteAudioElements,
    });
    room.disconnect();
    throw new Error(`LiveKit room connection failed: ${errorMessage(error)}`, { cause: error });
  }

  try {
    await withTimeout(
      room.localParticipant.setMicrophoneEnabled(true),
      timeoutMs,
      "Microphone permission or publishing timed out",
    );
  } catch (error) {
    cleanupLiveKitRoom(room, {
      onDisconnected,
      onConnectionQualityChanged,
      onTrackSubscribed,
      onTrackUnsubscribed,
      remoteAudioElements,
    });
    room.disconnect();
    throw new Error(`Microphone publish failed: ${errorMessage(error)}`, { cause: error });
  }

  return {
    close() {
      cleanupLiveKitRoom(room, {
        onDisconnected,
        onConnectionQualityChanged,
        onTrackSubscribed,
        onTrackUnsubscribed,
        remoteAudioElements,
      });
      room.disconnect();
    },
  };
}

function isRemoteAudioTrack(track: unknown): track is RemoteAudioTrackLike {
  return (
    typeof track === "object" &&
    track !== null &&
    "attach" in track &&
    "detach" in track &&
    (track as { kind?: unknown }).kind === Track.Kind.Audio
  );
}

function detachRemoteAudioTrack(track: RemoteAudioTrackLike, remoteAudioElements: Map<RemoteAudioTrackLike, HTMLMediaElement>) {
  const attachedElement = remoteAudioElements.get(track);
  if (attachedElement) {
    attachedElement.remove();
    remoteAudioElements.delete(track);
  }

  for (const element of track.detach()) {
    element.remove();
  }
}

function cleanupLiveKitRoom(
  room: LiveKitRoomLike,
  handlers: {
    onDisconnected: () => void;
    onConnectionQualityChanged: (quality: unknown) => void;
    onTrackSubscribed: (track: unknown) => void;
    onTrackUnsubscribed: (track: unknown) => void;
    remoteAudioElements: Map<RemoteAudioTrackLike, HTMLMediaElement>;
  },
) {
  room.off(RoomEvent.Disconnected, handlers.onDisconnected);
  room.off(RoomEvent.ConnectionQualityChanged, handlers.onConnectionQualityChanged);
  room.off(RoomEvent.TrackSubscribed, handlers.onTrackSubscribed);
  room.off(RoomEvent.TrackUnsubscribed, handlers.onTrackUnsubscribed);

  for (const track of handlers.remoteAudioElements.keys()) {
    detachRemoteAudioTrack(track, handlers.remoteAudioElements);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "unknown error";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error: unknown) => reject(error))
      .finally(() => window.clearTimeout(timer));
  });
}
