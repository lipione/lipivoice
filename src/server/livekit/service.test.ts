import { describe, expect, it, vi } from "vitest";
import { createLiveKitService, isLiveKitConfigured } from "./service";

const configured = {
  livekitWsUrl: "ws://127.0.0.1:7880",
  livekitApiUrl: "http://127.0.0.1:7880",
  livekitApiKey: "key",
  livekitApiSecret: "secret",
  livekitAgentName: "lipivoice-receptionist",
};

describe("isLiveKitConfigured", () => {
  it("requires URL, API key, API secret, and agent name", () => {
    expect(isLiveKitConfigured(configured)).toBe(true);
    expect(isLiveKitConfigured({ ...configured, livekitApiKey: "" })).toBe(false);
  });
});

describe("createLiveKitService", () => {
  it("creates a room, dispatches an agent, and returns a browser token", async () => {
    const createRoom = vi.fn().mockResolvedValue({ name: "room" });
    const createDispatch = vi.fn().mockResolvedValue({ id: "dispatch_1" });
    const createToken = vi.fn().mockResolvedValue("jwt-token");
    const service = createLiveKitService(configured, {
      roomClient: { createRoom },
      dispatchClient: { createDispatch },
      createToken,
    });

    const result = await service.startWebCall({
      callId: "call_1",
      agentId: "agent_reception",
      participantIdentity: "caller_call_1",
    });

    expect(createRoom).toHaveBeenCalledWith({
      name: "lipivoice-call-call_1",
      emptyTimeout: 300,
      maxParticipants: 4,
    });
    expect(createDispatch).toHaveBeenCalledWith(
      "lipivoice-call-call_1",
      "lipivoice-receptionist",
      {
        metadata: JSON.stringify({ callId: "call_1", agentId: "agent_reception" }),
      },
    );
    expect(createToken).toHaveBeenCalledWith({
      roomName: "lipivoice-call-call_1",
      participantIdentity: "caller_call_1",
    });
    expect(result).toEqual({
      wsUrl: "ws://127.0.0.1:7880",
      roomName: "lipivoice-call-call_1",
      participantIdentity: "caller_call_1",
      token: "jwt-token",
      dispatchId: "dispatch_1",
    });
  });

  it("creates fresh LiveKit API clients for each web call when factories are provided", async () => {
    const createRoom = vi.fn().mockResolvedValue({ name: "room" });
    const createDispatch = vi.fn().mockResolvedValue({ id: "dispatch_1" });
    const createRoomClient = vi.fn(() => ({ createRoom }));
    const createDispatchClient = vi.fn(() => ({ createDispatch }));
    const service = createLiveKitService(configured, {
      createRoomClient,
      createDispatchClient,
      createToken: async () => "jwt-token",
    });

    await service.startWebCall({
      callId: "call_1",
      agentId: "agent_reception",
      participantIdentity: "caller_call_1",
    });
    await service.startWebCall({
      callId: "call_2",
      agentId: "agent_reception",
      participantIdentity: "caller_call_2",
    });

    expect(createRoomClient).toHaveBeenCalledTimes(2);
    expect(createDispatchClient).toHaveBeenCalledTimes(2);
  });

  it("creates an outbound SIP participant through the Asterisk gateway", async () => {
    const createRoom = vi.fn().mockResolvedValue({ name: "room" });
    const createDispatch = vi.fn().mockResolvedValue({ id: "dispatch_1" });
    const listSipOutboundTrunk = vi.fn().mockResolvedValue([]);
    const createSipOutboundTrunk = vi.fn().mockResolvedValue({
      sipTrunkId: "trunk_1",
      name: "LipiVoice Asterisk Gateway",
      numbers: ["+97760400011"],
      metadata: "{\"owner\":\"lipivoice\",\"gateway\":\"asterisk\"}",
    });
    const createSipParticipant = vi.fn().mockResolvedValue({
      participantId: "sip_participant_1",
      participantIdentity: "sip_call_1",
    });
    const service = createLiveKitService(configured, {
      roomClient: { createRoom },
      dispatchClient: { createDispatch },
      createSipClient: () => ({
        listSipOutboundTrunk,
        createSipOutboundTrunk,
        createSipParticipant,
      }),
    });

    const result = await service.startOutboundSipCall({
      callId: "call_1",
      agentId: "agent_reception",
      toNumber: "9779841234567",
      fromNumber: "+97760400011",
      contactName: "Ram Shrestha",
      campaignId: "campaign_1",
      campaignRunId: "run_1",
      contextPromptSuffix: "Policy number: SALICO-MOTOR-12345",
    });

    expect(createRoom).toHaveBeenCalledWith({
      name: "lipivoice-call-call_1",
      emptyTimeout: 300,
      maxParticipants: 4,
    });
    expect(createDispatch).toHaveBeenCalledWith(
      "lipivoice-call-call_1",
      "lipivoice-receptionist",
      {
        metadata: JSON.stringify({
          callId: "call_1",
          agentId: "agent_reception",
          direction: "outbound",
          campaignId: "campaign_1",
          campaignRunId: "run_1",
          contextPromptSuffix: "Policy number: SALICO-MOTOR-12345",
        }),
      },
    );
    expect(createSipOutboundTrunk).toHaveBeenCalledWith(
      "LipiVoice Asterisk Gateway",
      "127.0.0.1:5062",
      ["+97760400011"],
      {
        metadata: "{\"owner\":\"lipivoice\",\"gateway\":\"asterisk\"}",
        transport: 1,
      },
    );
    expect(createSipParticipant).toHaveBeenCalledWith(
      "trunk_1",
      "9779841234567",
      "lipivoice-call-call_1",
      expect.objectContaining({
        fromNumber: "+97760400011",
        participantIdentity: "sip_call_1",
        participantName: "Ram Shrestha",
      }),
    );
    expect(result).toEqual({
      roomName: "lipivoice-call-call_1",
      dispatchId: "dispatch_1",
      trunkId: "trunk_1",
      participantId: "sip_participant_1",
      participantIdentity: "sip_call_1",
    });
  });
});
