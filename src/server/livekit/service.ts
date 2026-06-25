import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
  SipClient,
  type SIPOutboundTrunkInfo,
  type SIPParticipantInfo,
} from "livekit-server-sdk";

export interface LiveKitServiceConfig {
  livekitWsUrl: string;
  livekitApiUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitAgentName: string;
}

export interface LiveKitWebCall {
  wsUrl: string;
  roomName: string;
  participantIdentity: string;
  token: string;
  dispatchId: string | null;
}

export interface LiveKitOutboundSipCall {
  roomName: string;
  dispatchId: string | null;
  trunkId: string;
  participantId: string | null;
  participantIdentity: string;
}

interface RoomClient {
  createRoom(options: { name: string; emptyTimeout: number; maxParticipants: number }): Promise<unknown>;
}

interface DispatchClient {
  createDispatch(
    roomName: string,
    agentName: string,
    options: { metadata: string },
  ): Promise<{ id?: string }>;
}

interface SipClientLike {
  listSipOutboundTrunk(options?: { numbers?: string[] }): Promise<Array<Pick<SIPOutboundTrunkInfo, "sipTrunkId" | "name" | "numbers" | "metadata">>>;
  createSipOutboundTrunk(
    name: string,
    address: string,
    numbers: string[],
    options?: { metadata?: string; transport: number; authUsername?: string; authPassword?: string },
  ): Promise<Pick<SIPOutboundTrunkInfo, "sipTrunkId" | "name" | "numbers" | "metadata">>;
  createSipParticipant(
    sipTrunkId: string,
    number: string,
    roomName: string,
    options?: {
      fromNumber?: string;
      participantIdentity?: string;
      participantName?: string;
      displayName?: string;
      participantMetadata?: string;
      participantAttributes?: Record<string, string>;
      playDialtone?: boolean;
      ringingTimeout?: number;
      waitUntilAnswered?: boolean;
      timeout?: number;
    },
  ): Promise<Pick<SIPParticipantInfo, "participantId" | "participantIdentity">>;
}

interface TokenInput {
  roomName: string;
  participantIdentity: string;
}

interface LiveKitServiceDeps {
  roomClient?: RoomClient;
  dispatchClient?: DispatchClient;
  createRoomClient?: () => RoomClient;
  createDispatchClient?: () => DispatchClient;
  createSipClient?: () => SipClientLike;
  createToken?: (input: TokenInput) => Promise<string>;
}

export function isLiveKitConfigured(config: LiveKitServiceConfig): boolean {
  return Boolean(
    config.livekitWsUrl &&
      config.livekitApiUrl &&
      config.livekitApiKey &&
      config.livekitApiSecret &&
      config.livekitAgentName,
  );
}

export function createLiveKitService(config: LiveKitServiceConfig, deps: LiveKitServiceDeps = {}) {
  const createRoomClient = deps.createRoomClient ?? (() => deps.roomClient ?? new RoomServiceClient(
    config.livekitApiUrl,
    config.livekitApiKey,
    config.livekitApiSecret,
  ));
  const createDispatchClient = deps.createDispatchClient ?? (() => deps.dispatchClient ?? new AgentDispatchClient(
    config.livekitApiUrl,
    config.livekitApiKey,
    config.livekitApiSecret,
  ));
  const createSipClient = deps.createSipClient ?? (() => new SipClient(
    config.livekitApiUrl,
    config.livekitApiKey,
    config.livekitApiSecret,
  ));
  const createToken = deps.createToken ?? ((input: TokenInput) => createParticipantToken(config, input));

  return {
    async startWebCall(input: { callId: string; agentId: string; participantIdentity: string }): Promise<LiveKitWebCall> {
      if (!isLiveKitConfigured(config)) {
        throw new Error("livekit_not_configured");
      }

      const roomName = `lipivoice-call-${input.callId}`;
      const roomClient = createRoomClient();
      const dispatchClient = createDispatchClient();
      await roomClient.createRoom({
        name: roomName,
        emptyTimeout: 300,
        maxParticipants: 4,
      });

      const dispatch = await dispatchClient.createDispatch(roomName, config.livekitAgentName, {
        metadata: JSON.stringify({ callId: input.callId, agentId: input.agentId }),
      });

      return {
        wsUrl: config.livekitWsUrl,
        roomName,
        participantIdentity: input.participantIdentity,
        token: await createToken({ roomName, participantIdentity: input.participantIdentity }),
        dispatchId: dispatch.id ?? null,
      };
    },

    async startOutboundSipCall(input: {
      callId: string;
      agentId: string;
      toNumber: string;
      fromNumber: string;
      contactName: string;
      campaignId?: string;
      campaignRunId?: string;
      contextPromptSuffix?: string;
      asteriskAddress?: string;
    }): Promise<LiveKitOutboundSipCall> {
      if (!isLiveKitConfigured(config)) {
        throw new Error("livekit_not_configured");
      }

      const roomName = `lipivoice-call-${input.callId}`;
      const participantIdentity = `sip_${input.callId}`;
      const metadata = {
        callId: input.callId,
        agentId: input.agentId,
        direction: "outbound",
        campaignId: input.campaignId ?? null,
        campaignRunId: input.campaignRunId ?? null,
        contextPromptSuffix: input.contextPromptSuffix ?? "",
      };
      const roomClient = createRoomClient();
      const dispatchClient = createDispatchClient();
      const sipClient = createSipClient();

      await roomClient.createRoom({
        name: roomName,
        emptyTimeout: 300,
        maxParticipants: 4,
      });

      const dispatch = await dispatchClient.createDispatch(roomName, config.livekitAgentName, {
        metadata: JSON.stringify(metadata),
      });
      const trunk = await findOrCreateAsteriskOutboundTrunk(sipClient, {
        fromNumber: input.fromNumber,
        address: input.asteriskAddress ?? "127.0.0.1:5062",
      });
      const participant = await sipClient.createSipParticipant(trunk.sipTrunkId, input.toNumber, roomName, {
        fromNumber: input.fromNumber,
        participantIdentity,
        participantName: input.contactName,
        displayName: input.contactName,
        participantMetadata: JSON.stringify(metadata),
        participantAttributes: {
          "lipivoice.callId": input.callId,
          "lipivoice.campaignId": input.campaignId ?? "",
          "lipivoice.campaignRunId": input.campaignRunId ?? "",
        },
        playDialtone: true,
        ringingTimeout: 60,
        waitUntilAnswered: false,
        timeout: 10,
      });

      return {
        roomName,
        dispatchId: dispatch.id ?? null,
        trunkId: trunk.sipTrunkId,
        participantId: participant.participantId ?? null,
        participantIdentity: participant.participantIdentity ?? participantIdentity,
      };
    },
  };
}

async function findOrCreateAsteriskOutboundTrunk(
  sipClient: SipClientLike,
  input: { fromNumber: string; address: string },
) {
  const trunkName = "LipiVoice Asterisk Gateway";
  const metadata = JSON.stringify({ owner: "lipivoice", gateway: "asterisk" });
  const trunks = await sipClient.listSipOutboundTrunk({ numbers: [input.fromNumber] });
  const existing = trunks.find((trunk) =>
    trunk.sipTrunkId &&
    (trunk.name === trunkName || trunk.metadata === metadata || trunk.numbers?.includes(input.fromNumber))
  );

  if (existing?.sipTrunkId) {
    return existing;
  }

  return sipClient.createSipOutboundTrunk(trunkName, input.address, [input.fromNumber], {
    metadata,
    transport: 1,
  });
}

async function createParticipantToken(config: LiveKitServiceConfig, input: TokenInput): Promise<string> {
  const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: input.participantIdentity,
    ttl: 60 * 30,
  });

  token.addGrant({
    room: input.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return token.toJwt();
}
