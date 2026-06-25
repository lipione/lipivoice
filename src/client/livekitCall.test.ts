import { RoomEvent, Track } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { connectLiveKitCall } from "./livekitCall";

describe("connectLiveKitCall", () => {
  it("connects to a room, enables microphone, and disconnects cleanly", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const setMicrophoneEnabled = vi.fn().mockResolvedValue(undefined);
    const room = {
      connect,
      disconnect,
      localParticipant: {
        setMicrophoneEnabled,
      },
      on: vi.fn(),
      off: vi.fn(),
    };

    const call = await connectLiveKitCall({
      wsUrl: "ws://127.0.0.1:7880",
      token: "jwt-token",
      roomFactory: () => room,
    });

    expect(connect).toHaveBeenCalledWith("ws://127.0.0.1:7880", "jwt-token", {
      peerConnectionTimeout: 30000,
      websocketTimeout: 15000,
    });
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);

    call.close();
    expect(disconnect).toHaveBeenCalled();
  });

  it("attaches subscribed remote audio tracks so agent speech can play", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const setMicrophoneEnabled = vi.fn().mockResolvedValue(undefined);
    const room = {
      connect,
      disconnect,
      localParticipant: {
        setMicrophoneEnabled,
      },
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        listeners.set(event, handler);
      }),
      off: vi.fn((event: string) => {
        listeners.delete(event);
      }),
    };
    const detachedElement = document.createElement("audio");
    const attachedElement = document.createElement("audio");
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(attachedElement, "play", { value: play });
    const track = {
      sid: "TR_agent_audio",
      kind: Track.Kind.Audio,
      attach: vi.fn(() => attachedElement),
      detach: vi.fn(() => [detachedElement]),
    };

    const call = await connectLiveKitCall({
      wsUrl: "ws://127.0.0.1:7880",
      token: "jwt-token",
      roomFactory: () => room,
    });

    listeners.get(RoomEvent.TrackSubscribed)?.(track);

    expect(track.attach).toHaveBeenCalled();
    expect(attachedElement.isConnected).toBe(true);
    expect(attachedElement.autoplay).toBe(true);
    expect(attachedElement.getAttribute("playsinline")).toBe("true");
    expect(play).toHaveBeenCalled();

    call.close();

    expect(attachedElement.isConnected).toBe(false);
    expect(track.detach).toHaveBeenCalled();
  });
});
