import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  Circle,
  Clock,
  Gauge,
  Headphones,
  ListChecks,
  MessageSquareText,
  PhoneOff,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Volume2,
} from "lucide-react";

import { connectLiveKitCall } from "@/client/livekitCall";
import { getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { Agent, Call, CallEvent, ModelAsset, ModelRuntime, Voice } from "@/domain/types";
import { formatVoiceOption, sortVoicesForDisplay, voiceTonalityLabel } from "@/domain/voiceLabels";
import { cn } from "@/lib/utils";

type CallRecord = Call;
type FirstMessageMode = "assistant_first" | "waits_for_user" | "generated_first";
type CallChannelFilter = "all" | "web" | "simulation" | "phone";
type CallStatusFilter = "all" | "active" | "ended" | "failed";
type CallPanelTab = "transcript" | "log";
type CallTone = "professional" | "warm" | "direct";
type CallPace = "normal" | "brisk" | "fast";
type AcknowledgementStyle = "hajur_hus" | "hajur_only" | "minimal";
type LiveKitWebCall = {
  wsUrl: string;
  roomName: string;
  participantIdentity: string;
  token: string;
  dispatchId: string | null;
};
type StartLiveCallResponse = {
  call: CallRecord;
  events: CallEvent[];
  livekit: LiveKitWebCall;
};
type AgentOption = Pick<Agent, "id" | "name"> & Partial<Agent>;

const firstMessageModes: Array<{ id: FirstMessageMode; label: string }> = [
  { id: "assistant_first", label: "Assistant speaks first" },
  { id: "waits_for_user", label: "Assistant waits for user" },
  { id: "generated_first", label: "Assistant speaks first with model generated message" },
];
const channelFilters: Array<{ id: CallChannelFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "web", label: "Web" },
  { id: "simulation", label: "Simulation" },
  { id: "phone", label: "Phone" },
];
const statusFilters: Array<{ id: CallStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "ended", label: "Ended" },
  { id: "failed", label: "Failed" },
];
const toneOptions: Array<{ id: CallTone; label: string; instruction: string }> = [
  {
    id: "professional",
    label: "Professional receptionist",
    instruction: "Use a composed insurance receptionist tone. Be respectful and concise. Do not sound chatty or overly friendly.",
  },
  {
    id: "warm",
    label: "Warm service desk",
    instruction: "Use a warm but still professional service-desk tone. Keep empathy brief and move to the next useful question.",
  },
  {
    id: "direct",
    label: "Direct call center",
    instruction: "Use a direct call-center tone. Keep replies short, avoid small talk, and prioritize the next operational step.",
  },
];
const paceOptions: Array<{ id: CallPace; label: string; instruction: string }> = [
  {
    id: "normal",
    label: "Normal",
    instruction: "Speak at a normal phone-call pace. Do not drag acknowledgements or explanations.",
  },
  {
    id: "brisk",
    label: "Brisk",
    instruction: "Speak slightly faster than normal, like a trained call-center receptionist. Keep sentences compact.",
  },
  {
    id: "fast",
    label: "Fast",
    instruction: "Speak quickly but clearly. Use short clauses and avoid long explanations unless the caller asks.",
  },
];
const acknowledgementOptions: Array<{ id: AcknowledgementStyle; label: string; instruction: string }> = [
  {
    id: "hajur_hus",
    label: "हजुर / हस्",
    instruction: "Use हजुर or हस् for acknowledgement. Do not say ठीक छ.",
  },
  {
    id: "hajur_only",
    label: "हजुर only",
    instruction: "Use हजुर as the main acknowledgement. Avoid ठीक छ and avoid repeating हस् too often.",
  },
  {
    id: "minimal",
    label: "Minimal acknowledgement",
    instruction: "Use acknowledgement only when needed. Prefer the next useful question over filler. Do not say ठीक छ.",
  },
];

function formatDuration(seconds: number | null | undefined) {
  const totalSeconds = Math.max(0, seconds ?? 0);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}:${String(remainingSeconds).padStart(2, "0")}` : `${remainingSeconds}s`;
}

function formatMoney(value: number | null | undefined) {
  return `$${(value ?? 0).toFixed(2)}`;
}

function formatRate(value: number) {
  return `~$${value.toFixed(2)}`;
}

function formatPayload(payload: Record<string, unknown> | undefined) {
  if (!payload) return "No event payload";

  const toolSummary = formatToolPayload(payload);
  if (toolSummary) return toolSummary;

  const toolName = payload.toolName;
  if (typeof toolName === "string") return toolName;

  const name = payload.name;
  if (typeof name === "string") return name;

  const code = payload.code;
  if (typeof code === "string") return code;

  const status = payload.status;
  if (typeof status === "string") return status;

  const text = payload.text;
  if (typeof text === "string") return text;

  return JSON.stringify(payload);
}

function formatToolPayload(payload: Record<string, unknown>) {
  const toolName = payload.toolName;
  if (typeof toolName !== "string") {
    return null;
  }

  const parts = [toolName];
  const ok = payload.ok;
  const status = payload.status;
  if (typeof ok === "boolean" || typeof status === "number") {
    if (ok === false && status === 0) {
      parts.push("failed");
    } else if (typeof status === "number") {
      parts.push(String(status));
    }
  }

  const attempts = payload.attempts;
  if (typeof attempts === "number") {
    parts.push(`${attempts} ${attempts === 1 ? "attempt" : "attempts"}`);
  }

  const error = payload.error;
  if (typeof error === "string" && error.length > 0) {
    parts.push(error);
  }

  return parts.join(" · ");
}

function toAgentOptions(agents: Agent[]): AgentOption[] {
  return agents
    .filter((agent) => typeof agent.id === "string" && typeof agent.name === "string")
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      greeting: agent.greeting,
      systemPrompt: agent.systemPrompt,
      language: agent.language,
      voiceId: agent.voiceId,
      modelRuntimeId: agent.modelRuntimeId,
      modelAssetId: agent.modelAssetId,
      transcriberRuntimeId: agent.transcriberRuntimeId,
      recordingEnabled: agent.recordingEnabled,
      interruptionSensitivity: agent.interruptionSensitivity,
      toolIds: agent.toolIds,
      knowledgeBaseIds: agent.knowledgeBaseIds,
      deploymentState: agent.deploymentState,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }));
}

function hasPendingMedia(call: CallRecord) {
  return call.channel === "web" && call.status === "connected" && (call.durationSeconds ?? 0) === 0;
}

function callStatusVariant(call: CallRecord) {
  if (hasPendingMedia(call)) return "warning" as const;
  if (call.status === "failed") return "danger" as const;
  if (call.status === "connected" || call.status === "speaking" || call.status === "listening" || call.status === "thinking") {
    return "success" as const;
  }

  return "outline" as const;
}

function displayCallStatus(call: CallRecord) {
  if (hasPendingMedia(call)) {
    return "media pending";
  }

  return call.status;
}

function displayFailureReason(call: CallRecord) {
  if (call.failureReason) {
    return call.failureReason;
  }

  if (hasPendingMedia(call)) {
    return "waiting_for_browser_media";
  }

  return "none";
}

function isActiveCall(call: CallRecord | null | undefined) {
  return Boolean(call && !call.endedAt && call.status !== "failed" && call.status !== "disconnected");
}

function sortNewestCalls(calls: CallRecord[]) {
  return [...calls].sort((first, second) => Date.parse(second.startedAt) - Date.parse(first.startedAt));
}

function averageCostPerMinute(calls: CallRecord[]) {
  const totalCost = calls.reduce((sum, call) => sum + (call.costEstimateUsd ?? 0), 0);
  const totalMinutes = Math.max(1, calls.reduce((sum, call) => sum + Math.max(1, call.durationSeconds ?? 0), 0) / 60);

  return totalCost / totalMinutes;
}

function isEndedCall(call: CallRecord) {
  return Boolean(call.endedAt || call.status === "disconnected");
}

function matchesStatusFilter(call: CallRecord, filter: CallStatusFilter) {
  if (filter === "all") return true;
  if (filter === "active") return isActiveCall(call);
  if (filter === "ended") return isEndedCall(call);
  return call.status === "failed";
}

function averageLatencyMs(events: CallEvent[]) {
  const values = events
    .map((event) => event.payload?.latencyMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return 1150;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function abbreviatedId(id: string) {
  return id.length > 18 ? `${id.slice(0, 8)}-${id.slice(-6)}` : id;
}

function formatAdapter(adapter: string | undefined) {
  if (!adapter) return "Not configured";

  const labels: Record<string, string> = {
    faster_whisper: "LipiHear",
    google_stt: "LipiHear",
    google_tts: "LipiVoice",
    vllm: "LipiCore",
    gemini: "LipiSense",
    whisper_cpp: "LipiHear Local",
    piper: "LipiVoice Local",
    ollama: "LipiCore Local",
  };

  return labels[adapter] ?? adapter;
}

function buildTunedGreeting(greeting: string | undefined, acknowledgementStyle: AcknowledgementStyle) {
  const currentGreeting = greeting?.trim();
  if (currentGreeting) {
    return currentGreeting.replace(/ठीक छ[।,]?\s*/g, acknowledgementStyle === "hajur_only" ? "हजुर। " : "हस्। ");
  }

  return acknowledgementStyle === "hajur_only"
    ? "नमस्ते, लिपि इन्स्योरेन्समा स्वागत छ। हजुरलाई कसरी सहयोग गरूँ?"
    : "नमस्ते, लिपि इन्स्योरेन्समा स्वागत छ। हस्, हजुरलाई कसरी सहयोग गरूँ?";
}

function buildTunedSystemPrompt(
  systemPrompt: string | undefined,
  tuning: {
    toneInstruction: string;
    paceInstruction: string;
    acknowledgementInstruction: string;
  },
) {
  const basePrompt = (systemPrompt || "").replace(
    /\n\n\[LipiVoice call tuning\][\s\S]*?\[\/LipiVoice call tuning\]/,
    "",
  ).trim();
  const tuningBlock = [
    "[LipiVoice call tuning]",
    tuning.toneInstruction,
    tuning.paceInstruction,
    tuning.acknowledgementInstruction,
    "Read phone numbers, policy numbers, account numbers, and claim numbers digit by digit or in short groups. Never read them as full amount values.",
    "Avoid casual filler and avoid saying ठीक छ. Use short, natural Nepali call-center replies.",
    "[/LipiVoice call tuning]",
  ].join("\n");

  return [basePrompt, tuningBlock].filter(Boolean).join("\n\n");
}

async function requestMicrophonePermission() {
  const getUserMedia = globalThis.navigator?.mediaDevices?.getUserMedia;
  if (!getUserMedia) {
    throw new Error("microphone_capture_unavailable");
  }

  const stream = await getUserMedia.call(globalThis.navigator.mediaDevices, { audio: true });
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function CallsPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [agents, setAgents] = useState<ReturnType<typeof toAgentOptions>>([]);
  const [runtimes, setRuntimes] = useState<ModelRuntime[]>([]);
  const [modelAssets, setModelAssets] = useState<ModelAsset[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [events, setEvents] = useState<CallEvent[]>([]);
  const [isLoadingCalls, setIsLoadingCalls] = useState(true);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [callsError, setCallsError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [liveCallError, setLiveCallError] = useState<string | null>(null);
  const [endState, setEndState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [startState, setStartState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [demoState, setDemoState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [runtimeSaveState, setRuntimeSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [firstMessageMode, setFirstMessageMode] = useState<FirstMessageMode>("assistant_first");
  const [isFirstMessageMenuOpen, setIsFirstMessageMenuOpen] = useState(false);
  const [channelFilter, setChannelFilter] = useState<CallChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<CallStatusFilter>("all");
  const [callPanelTab, setCallPanelTab] = useState<CallPanelTab>("transcript");
  const [isSetupCollapsed, setIsSetupCollapsed] = useState(true);
  const [callTone, setCallTone] = useState<CallTone>("professional");
  const [callPace, setCallPace] = useState<CallPace>("brisk");
  const [acknowledgementStyle, setAcknowledgementStyle] = useState<AcknowledgementStyle>("hajur_hus");
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const eventRequestIdRef = useRef(0);
  const liveKitConnectionsRef = useRef<Map<string, { close(): void }>>(new Map());
  const liveKitRoomByCallRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let isCurrent = true;

    async function loadCalls() {
      setIsLoadingCalls(true);
      setCallsError(null);

      try {
        const [nextCalls, nextAgents, nextRuntimes, nextModelAssets, nextVoices] = await Promise.all([
          getJson<CallRecord[]>("/api/calls"),
          getJson<Agent[]>("/api/agents").catch(() => []),
          getJson<ModelRuntime[]>("/api/model-runtimes").catch(() => []),
          getJson<ModelAsset[]>("/api/model-assets").catch(() => []),
          getJson<Voice[]>("/api/voices").catch(() => []),
        ]);
        if (!isCurrent) return;

        const agentOptions = toAgentOptions(nextAgents);
        setCalls(sortNewestCalls(nextCalls));
        setAgents(agentOptions);
        setRuntimes(nextRuntimes);
        setModelAssets(nextModelAssets);
        setVoices(nextVoices);
        setSelectedAgentId((currentAgentId) => currentAgentId || agentOptions[0]?.id || "");
        if (nextCalls[0]) {
          void selectCall(nextCalls[0].id);
        }
      } catch (error) {
        if (!isCurrent) return;

        setCallsError(error instanceof Error ? error.message : "Unable to load calls.");
      } finally {
        if (isCurrent) {
          setIsLoadingCalls(false);
        }
      }
    }

    void loadCalls();

    return () => {
      isCurrent = false;
      for (const connection of liveKitConnectionsRef.current.values()) {
        connection.close();
      }

      liveKitConnectionsRef.current.clear();
    };
  }, []);

  const selectedCall = useMemo(
    () => calls.find((call) => call.id === selectedCallId) ?? null,
    [calls, selectedCallId],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );
  const sttRuntimes = runtimes.filter((runtime) => runtime.kind === "stt");
  const llmRuntimes = runtimes.filter((runtime) => runtime.kind === "llm");
  const selectedSttRuntime = runtimes.find((runtime) => runtime.id === selectedAgent?.transcriberRuntimeId) ?? null;
  const selectedModelRuntime = runtimes.find((runtime) => runtime.id === selectedAgent?.modelRuntimeId) ?? null;
  const selectedModelAsset = modelAssets.find((asset) => asset.id === selectedAgent?.modelAssetId) ??
    modelAssets.find((asset) => asset.id === selectedModelRuntime?.defaultModelId) ??
    null;
  const selectedVoice = voices.find((voice) => voice.id === selectedAgent?.voiceId) ?? null;
  const selectedVoiceRuntime = runtimes.find((runtime) => runtime.id === selectedVoice?.runtimeId) ?? null;
  const displayVoices = useMemo(() => sortVoicesForDisplay(voices), [voices]);
  const selectedSttModelAsset = modelAssets.find((asset) => asset.id === selectedSttRuntime?.defaultModelId) ?? null;
  const transcriptEvents = events.filter((event) => event.type === "transcript");
  const debugEvents = events.filter((event) => event.type !== "transcript");
  const activeCall = isActiveCall(selectedCall) ? selectedCall : calls.find(isActiveCall) ?? selectedCall;
  const filteredCalls = useMemo(
    () =>
      calls.filter((call) => {
        const channelMatches = channelFilter === "all" || call.channel === channelFilter;
        return channelMatches && matchesStatusFilter(call, statusFilter);
      }),
    [calls, channelFilter, statusFilter],
  );
  const costRate = averageCostPerMinute(filteredCalls.length > 0 ? filteredCalls : calls);
  const latencyMs = averageLatencyMs(events);
  const selectedFirstMode = firstMessageModes.find((mode) => mode.id === firstMessageMode) ?? firstMessageModes[0];
  const selectedCallTransport = selectedCallId ? liveKitRoomByCallRef.current[selectedCallId] : null;
  const selectedBrowserConnected = selectedCallId ? liveKitConnectionsRef.current.has(selectedCallId) : false;
  const liveConnectionLabel = selectedBrowserConnected
    ? "Browser connected"
    : selectedCallTransport
      ? "LiveKit room ready"
      : isActiveCall(selectedCall)
        ? "Call active"
        : "No live call";

  useEffect(() => {
    if (!selectedCallId || !selectedCall || !isActiveCall(selectedCall)) {
      return;
    }

    let isCurrent = true;

    async function refreshEvents() {
      try {
        const nextEvents = await getJson<CallEvent[]>(`/api/calls/${selectedCallId}/events`);
        if (!isCurrent) return;

        setEvents((currentEvents) => {
          const ids = new Set(currentEvents.map((event) => event.id));
          const merged = [...currentEvents];
          for (const event of nextEvents) {
            if (!ids.has(event.id)) {
              merged.push(event);
            }
          }

          return merged;
        });
      } catch {
        // Keep active-call polling quiet; explicit row selection still reports load errors.
      }
    }

    void refreshEvents();
    const interval = window.setInterval(() => void refreshEvents(), 2000);

    return () => {
      isCurrent = false;
      window.clearInterval(interval);
    };
  }, [selectedCallId, selectedCall]);

  useEffect(() => {
    if (callPanelTab !== "transcript") {
      return;
    }

    const scrollContainer = transcriptScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [callPanelTab, selectedCallId, transcriptEvents.length]);

  function clearConnectionForCall(callId: string) {
    const connection = liveKitConnectionsRef.current.get(callId);
    if (!connection) {
      return;
    }

    connection.close();
    liveKitConnectionsRef.current.delete(callId);
  }

  function appendEventsWithoutDuplicates(nextEvents: CallEvent[]) {
    setEvents((currentEvents) => {
      const ids = new Set(currentEvents.map((event) => event.id));
      const merged = [...currentEvents];
      for (const event of nextEvents) {
        if (!ids.has(event.id)) {
          merged.push(event);
        }
      }

      return merged;
    });
  }

  function upsertCall(call: CallRecord) {
    setCalls((currentCalls) =>
      sortNewestCalls([
        call,
        ...currentCalls.filter((currentCall) => currentCall.id !== call.id),
      ]),
    );
  }

  function patchSelectedAgent(patch: Partial<AgentOption>) {
    if (!selectedAgent) {
      return;
    }

    setRuntimeSaveState("idle");
    setAgents((currentAgents) =>
      currentAgents.map((agent) => (agent.id === selectedAgent.id ? { ...agent, ...patch } : agent)),
    );
  }

  function updateSelectedModelRuntime(runtimeId: string) {
    const runtime = runtimes.find((candidate) => candidate.id === runtimeId);
    patchSelectedAgent({
      modelRuntimeId: runtimeId,
      modelAssetId: runtime?.defaultModelId ?? selectedAgent?.modelAssetId,
    });
  }

  function applyCallTuningToAgent(agent: AgentOption): AgentOption {
    const tone = toneOptions.find((option) => option.id === callTone) ?? toneOptions[0];
    const pace = paceOptions.find((option) => option.id === callPace) ?? paceOptions[1];
    const acknowledgement = acknowledgementOptions.find((option) => option.id === acknowledgementStyle) ?? acknowledgementOptions[0];

    return {
      ...agent,
      greeting: buildTunedGreeting(agent.greeting, acknowledgementStyle),
      systemPrompt: buildTunedSystemPrompt(agent.systemPrompt, {
        toneInstruction: tone.instruction,
        paceInstruction: pace.instruction,
        acknowledgementInstruction: acknowledgement.instruction,
      }),
    };
  }

  function selectedAgentIsComplete(agent: AgentOption | null): agent is Agent {
    return Boolean(
      agent?.id &&
      agent.name &&
      agent.greeting &&
      agent.systemPrompt &&
      agent.language &&
      agent.modelRuntimeId &&
      agent.modelAssetId &&
      agent.voiceId &&
      agent.transcriberRuntimeId &&
      agent.interruptionSensitivity &&
      agent.deploymentState &&
      agent.createdAt &&
      agent.updatedAt &&
      Array.isArray(agent.toolIds) &&
      Array.isArray(agent.knowledgeBaseIds) &&
      typeof agent.recordingEnabled === "boolean",
    );
  }

  async function persistSelectedAgentRuntime() {
    if (!selectedAgentIsComplete(selectedAgent)) {
      setRuntimeSaveState("failed");
      return null;
    }

    const tunedAgent = applyCallTuningToAgent(selectedAgent);
    setRuntimeSaveState("saving");
    try {
      const savedAgent = await postJson<Agent>("/api/agents", {
        ...tunedAgent,
        updatedAt: new Date().toISOString(),
      });
      setAgents((currentAgents) =>
        currentAgents.map((agent) => (agent.id === savedAgent.id ? toAgentOptions([savedAgent])[0] : agent)),
      );
      setSelectedAgentId(savedAgent.id);
      setRuntimeSaveState("saved");
      return savedAgent;
    } catch {
      setRuntimeSaveState("failed");
      return null;
    }
  }

  async function saveRuntimeStack() {
    setRuntimeSaveState("saving");
    await persistSelectedAgentRuntime();
  }

  async function syncRuntimeForCallStart() {
    const savedAgent = await persistSelectedAgentRuntime();
    if (!savedAgent) {
      setLiveCallError("Unable to save current call tuning and voice settings.");
      return null;
    }

    return savedAgent;
  }

  async function startWebCall() {
    if (!selectedAgentId) return;

    eventRequestIdRef.current += 1;
    setStartState("saving");
    setEventsError(null);
    setLiveCallError(null);
    setEvents([]);
    if (selectedCallId) {
      clearConnectionForCall(selectedCallId);
    }

    let createdCall: CallRecord | null = null;

    try {
      const syncedAgent = await syncRuntimeForCallStart();
      if (!syncedAgent) {
        setStartState("failed");
        return;
      }

      const result = await postJson<StartLiveCallResponse>("/api/livekit/web-call/start", {
        agentId: syncedAgent.id,
      });
      createdCall = result.call;
      liveKitRoomByCallRef.current[result.call.id] = result.livekit.roomName;
      upsertCall(result.call);
      setSelectedCallId(result.call.id);
      setEvents(result.events);
      setIsLoadingEvents(false);
      setEndState("idle");
      setStartState("saved");
      setCallPanelTab("transcript");
      setIsSetupCollapsed(true);

      try {
        await requestMicrophonePermission();
      } catch (error) {
        const message = error instanceof Error && error.message === "microphone_capture_unavailable"
          ? "microphone_permission_failed: This browser cannot access microphone capture. Open this page in Chrome or Safari for live voice, or use Start demo call here."
          : "microphone_permission_failed: Microphone permission is required for a live browser call. Allow microphone access in the browser and click Start live call again.";
        const ended = await postJson<{ call: CallRecord; events: CallEvent[] }>(
          `/api/calls/${result.call.id}/end`,
          { status: "failed", failureReason: "microphone_permission_failed" },
        ).catch(() => null);
        if (ended) {
          upsertCall(ended.call);
          appendEventsWithoutDuplicates(ended.events);
        }
        setLiveCallError(message);
        setStartState("failed");
        return;
      }

      const connection = await connectLiveKitCall({
        wsUrl: result.livekit.wsUrl,
        token: result.livekit.token,
        onDisconnected: () => {
          clearConnectionForCall(result.call.id);
          setEndState("saved");
        },
      });

      clearConnectionForCall(result.call.id);
      liveKitConnectionsRef.current.set(result.call.id, connection);
      setStartState("saved");
    } catch (error) {
      if (createdCall) {
        const ended = await postJson<{ call: CallRecord; events: CallEvent[] }>(
          `/api/calls/${createdCall.id}/end`,
          { status: "failed", failureReason: "browser_livekit_connection_failed" },
        ).catch(() => null);
        if (ended) {
          upsertCall(ended.call);
          appendEventsWithoutDuplicates(ended.events);
        }
      }
      const message = error instanceof Error ? error.message : "Unable to start browser call.";
      setLiveCallError(message);
      setStartState("failed");
    }
  }

  async function startDemoCall() {
    if (!selectedAgentId) return;

    eventRequestIdRef.current += 1;
    setDemoState("saving");
    setEventsError(null);
    setLiveCallError(null);
    setEvents([]);
    if (selectedCallId) {
      clearConnectionForCall(selectedCallId);
    }

    try {
      const syncedAgent = await syncRuntimeForCallStart();
      if (!syncedAgent) {
        setDemoState("failed");
        return;
      }

      const result = await postJson<{ call: CallRecord; events: CallEvent[] }>("/api/calls/simulate", {
        agentId: syncedAgent.id,
      });
      upsertCall(result.call);
      setSelectedCallId(result.call.id);
      setEvents(result.events);
      setIsLoadingEvents(false);
      setEndState("idle");
      setDemoState("saved");
      setCallPanelTab("transcript");
      setIsSetupCollapsed(true);
    } catch (error) {
      setLiveCallError(error instanceof Error ? error.message : "Unable to start demo call.");
      setDemoState("failed");
    }
  }

  async function selectCall(callId: string) {
    const requestId = eventRequestIdRef.current + 1;
    eventRequestIdRef.current = requestId;
    setSelectedCallId(callId);
    setIsLoadingEvents(true);
    setEventsError(null);
    setEndState("idle");
    setEvents([]);

    try {
      const nextEvents = await getJson<CallEvent[]>(`/api/calls/${callId}/events`);
      if (eventRequestIdRef.current !== requestId) return;

      setEvents(nextEvents);
    } catch (error) {
      if (eventRequestIdRef.current !== requestId) return;

      setEventsError(error instanceof Error ? error.message : "Unable to load call events.");
    } finally {
      if (eventRequestIdRef.current === requestId) {
        setIsLoadingEvents(false);
      }
    }
  }

  async function endSelectedCall() {
    if (!selectedCall) return;

    setEndState("saving");
    clearConnectionForCall(selectedCall.id);

    try {
      const result = await postJson<{ call: CallRecord; events: CallEvent[] }>(
        `/api/calls/${selectedCall.id}/end`,
        {},
      );
      setCalls((currentCalls) =>
        sortNewestCalls(currentCalls.map((call) => (call.id === result.call.id ? result.call : call))),
      );
      appendEventsWithoutDuplicates(result.events);
      setEndState("saved");
    } catch {
      setEndState("failed");
    }
  }

  if (isLoadingCalls) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Calls">
        <div className="rounded-lg border border-[#2a2c31] bg-[#111214] p-5 text-[#f5f7f8]">
          <h2 className="text-base font-semibold tracking-normal">Calls</h2>
          <p className="mt-2 text-sm text-[#8f939b]">Loading calls...</p>
        </div>
      </section>
    );
  }

  if (callsError) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Calls">
        <div className="rounded-lg border border-[#3f2628] bg-[#111214] p-5 text-[#f5f7f8]">
          <h2 className="text-base font-semibold tracking-normal">Calls</h2>
          <Badge variant="danger" className="mt-3">{callsError}</Badge>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto flex h-[calc(100vh-7.5rem)] min-h-[40rem] w-full max-w-none flex-col" aria-label="Calls">
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[#2b2d32] bg-[#0f1012] text-[#f3f4f6] shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
          <div className="flex min-h-0 min-w-0 flex-col border-b border-[#2b2d32] lg:border-b-0 lg:border-r">
            <header className="grid gap-3 border-b border-[#2b2d32] bg-[#101113] p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-[#30333a] bg-[#15171a] text-[#2dd4bf]">
                  <Bot className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-2xl font-semibold leading-7 tracking-normal">
                    {selectedAgent?.name ?? "Call Assistant"}
                  </div>
                  {selectedCallTransport ? (
                    <div className="mt-1 truncate font-mono text-xs text-[#6f7682]">
                      {selectedCallTransport}
                    </div>
                  ) : null}
                  <div className="mt-1 truncate font-mono text-sm text-[#858992]">
                    {activeCall ? abbreviatedId(activeCall.id) : "No active call"}
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#2f3d3d] bg-[#15191a] text-[#f3f4f6] hover:bg-[#1b2223]"
                  onClick={() => void startWebCall()}
                  disabled={!selectedAgentId || startState === "saving"}
                >
                  <Sparkles className="text-[#2dd4bf]" aria-hidden="true" />
                  Start live call
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#30343b] bg-[#15171a] text-[#d8dbe1] hover:bg-[#1b1f24]"
                  onClick={() => void startDemoCall()}
                  disabled={!selectedAgentId || demoState === "saving"}
                >
                  <ListChecks className="text-[#8debd8]" aria-hidden="true" />
                  {demoState === "saving" ? "Starting demo..." : "Start demo call"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#7f3537] bg-[#2a1719] text-[#ff8585] hover:bg-[#361c1f]"
                  onClick={() => void endSelectedCall()}
                  disabled={!selectedCall || !isActiveCall(selectedCall) || endState === "saving"}
                >
                  <PhoneOff aria-hidden="true" />
                  {endState === "saving" ? "Ending..." : "End call"}
                </Button>
                <Badge className="h-10 rounded-md bg-[#152421] px-4 text-sm text-[#8debd8]">
                  {liveConnectionLabel}
                </Badge>
              </div>
              {liveCallError ? (
                <div className="xl:col-span-2 rounded-md border border-[#7f3537] bg-[#2a1719] px-3 py-2 text-sm text-[#ffb4b4]">
                  {liveCallError.includes("microphone_permission_failed") ? (
                    <Badge variant="danger" className="mb-2">microphone_permission_failed</Badge>
                  ) : null}
                  {liveCallError}
                </div>
              ) : null}
              <div className="xl:col-span-2 flex items-start gap-2 rounded-md border border-[#604a1f] bg-[#241b0e] px-3 py-2 text-sm text-[#f7d58a]">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Live calls use LiveKit on the remote server. If a browser participant fails to connect, verify microphone permission and LiveKit logs.
                </span>
              </div>
            </header>

            <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-[#2b2d32] bg-[#101113] px-4 py-3 text-sm font-medium text-[#868a92]">
              <span className="flex items-center gap-2 text-[#2dd4bf]">
                <Bot className="h-4 w-4" aria-hidden="true" />
                Call adjustment
              </span>
              <button
                type="button"
                aria-label={isSetupCollapsed ? "Show setup" : "Hide setup"}
                className="flex items-center gap-2 rounded-md border border-[#30343b] px-3 py-1.5 hover:bg-[#191b1f]"
                onClick={() => setIsSetupCollapsed((collapsed) => !collapsed)}
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", isSetupCollapsed && "-rotate-90")} aria-hidden="true" />
                {isSetupCollapsed ? "Show adjustment panel" : "Hide adjustment panel"}
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md border border-[#30343b] px-3 py-1.5 hover:bg-[#191b1f]"
                onClick={() => setCallPanelTab("log")}
              >
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                Open call log
              </button>
            </div>

            <div className={cn("min-h-0 overflow-y-auto p-4 md:p-6", isSetupCollapsed ? "hidden" : "grid gap-5")}>
              <section className="rounded-lg bg-[#151719] p-5" aria-label="Call adjustment panel">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold tracking-normal">Call adjustment panel</h3>
                    <p className="mt-1 text-sm text-[#a0a4ac]">Tune the receptionist voice, pace, and Nepali call style.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      aria-label="Save runtime stack"
                      variant="outline"
                      className="border-[#2f3d3d] bg-[#15191a] text-[#f3f4f6] hover:bg-[#1b2223]"
                      onClick={() => void saveRuntimeStack()}
                      disabled={!selectedAgent || runtimeSaveState === "saving"}
                    >
                      <Check className="text-[#2dd4bf]" aria-hidden="true" />
                      {runtimeSaveState === "saving" ? "Saving..." : "Save voice & tuning"}
                    </Button>
                    {runtimeSaveState === "saved" ? (
                      <Badge variant="success">
                        Voice tuning saved
                        <span className="sr-only">Runtime stack saved</span>
                      </Badge>
                    ) : runtimeSaveState === "failed" ? (
                      <Badge variant="danger">Voice tuning save failed</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-3 xl:grid-cols-[minmax(18rem,1.1fr)_repeat(3,minmax(12rem,0.75fr))]">
                  <div className="grid gap-2">
                    <Label className="flex items-center gap-2 text-[#d8dbe1]" htmlFor="call-tts-voice">
                      <Volume2 className="h-4 w-4 text-[#2dd4bf]" aria-hidden="true" />
                      Voice
                    </Label>
                    <select
                      id="call-tts-voice"
                      aria-label="TTS voice"
                      className="h-11 rounded-md border border-[#333740] bg-black px-3 text-sm text-[#f3f4f6] outline-none focus:border-[#2dd4bf]"
                      value={selectedAgent?.voiceId ?? ""}
                      onChange={(event) => patchSelectedAgent({ voiceId: event.target.value })}
                    >
                      {voices.length === 0 ? <option value="">No voices</option> : null}
                      {displayVoices.map((voice) => {
                        const runtime = runtimes.find((candidate) => candidate.id === voice.runtimeId);

                        return (
                          <option key={voice.id} value={voice.id}>
                            {formatVoiceOption(voice, formatAdapter(runtime?.adapter))}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[#d8dbe1]" htmlFor="call-tone">Tone</Label>
                    <select
                      id="call-tone"
                      aria-label="Tone"
                      className="h-11 rounded-md border border-[#333740] bg-black px-3 text-sm text-[#f3f4f6] outline-none focus:border-[#2dd4bf]"
                      value={callTone}
                      onChange={(event) => setCallTone(event.target.value as CallTone)}
                    >
                      {toneOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[#d8dbe1]" htmlFor="call-pace">Speaking pace</Label>
                    <select
                      id="call-pace"
                      aria-label="Speaking pace"
                      className="h-11 rounded-md border border-[#333740] bg-black px-3 text-sm text-[#f3f4f6] outline-none focus:border-[#2dd4bf]"
                      value={callPace}
                      onChange={(event) => setCallPace(event.target.value as CallPace)}
                    >
                      {paceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[#d8dbe1]" htmlFor="call-acknowledgement">Acknowledgement</Label>
                    <select
                      id="call-acknowledgement"
                      aria-label="Acknowledgement"
                      className="h-11 rounded-md border border-[#333740] bg-black px-3 text-sm text-[#f3f4f6] outline-none focus:border-[#2dd4bf]"
                      value={acknowledgementStyle}
                      onChange={(event) => setAcknowledgementStyle(event.target.value as AcknowledgementStyle)}
                    >
                      {acknowledgementOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 rounded-md border border-[#2e3138] bg-[#111315] p-3 text-sm text-[#b8bcc4] md:grid-cols-3">
                  <div className="flex items-start gap-2">
                    <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-[#2dd4bf]" aria-hidden="true" />
                    <span>Professional insurance receptionist, less casual filler.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-[#f7d58a]" aria-hidden="true" />
                    <span>Brisk Nepali call-center pace by default.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-[#8debd8]" aria-hidden="true" />
                    <span>Uses हजुर / हस् and reads numbers in groups.</span>
                  </div>
                </div>
              </section>

              <section className="rounded-lg bg-[#151719] p-5" aria-label="Provider routing">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold tracking-normal">Provider routing</h3>
                    <p className="mt-1 text-sm text-[#a0a4ac]">Advanced routing for listening and reasoning.</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label className="text-[#d8dbe1]" htmlFor="call-stt-provider">Listening</Label>
                    <select
                      id="call-stt-provider"
                      aria-label="STT provider"
                      className="h-11 rounded-md border border-[#333740] bg-black px-3 text-sm text-[#f3f4f6] outline-none focus:border-[#2dd4bf]"
                      value={selectedAgent?.transcriberRuntimeId ?? ""}
                      onChange={(event) => patchSelectedAgent({ transcriberRuntimeId: event.target.value })}
                    >
                      {sttRuntimes.length === 0 ? <option value="">No listening runtimes</option> : null}
                      {sttRuntimes.map((runtime) => {
                        const model = modelAssets.find((asset) => asset.id === runtime.defaultModelId);

                        return (
                          <option key={runtime.id} value={runtime.id}>
                            {model?.name ?? formatAdapter(runtime.adapter)} - {formatAdapter(runtime.adapter)}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[#d8dbe1]" htmlFor="call-llm-provider">Reasoning</Label>
                    <select
                      id="call-llm-provider"
                      aria-label="LLM provider"
                      className="h-11 rounded-md border border-[#333740] bg-black px-3 text-sm text-[#f3f4f6] outline-none focus:border-[#2dd4bf]"
                      value={selectedAgent?.modelRuntimeId ?? ""}
                      onChange={(event) => updateSelectedModelRuntime(event.target.value)}
                    >
                      {llmRuntimes.length === 0 ? <option value="">No reasoning runtimes</option> : null}
                      {llmRuntimes.map((runtime) => {
                        const model = modelAssets.find((asset) => asset.id === runtime.defaultModelId);

                        return (
                          <option key={runtime.id} value={runtime.id}>
                            {model?.name ?? formatAdapter(runtime.adapter)} - {formatAdapter(runtime.adapter)}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              </section>

              <section className="rounded-lg bg-[#151719] p-5" aria-label="Assistant metrics">
                <div className="grid gap-5 xl:grid-cols-2">
                  <MetricStrip
                    label="Average cost"
                    value={formatRate(costRate)}
                    suffix="/min"
                    color="teal"
                    segments={["bg-[#14b8a6]", "bg-[#14b8a6]", "bg-[#f97316]", "bg-[#3b82f6]", "bg-[#c026d3]"]}
                  />
                  <MetricStrip
                    label="Average latency"
                    value={`~${latencyMs.toLocaleString()}`}
                    suffix="ms"
                    color="amber"
                    segments={["bg-[#f97316]", "bg-[#3b82f6]", "bg-[#3b82f6]", "bg-[#c026d3]", "bg-[#22c55e]"]}
                  />
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <RuntimeCard
                    accent="bg-[#f97316]"
                    label="Transcriber"
                    title={selectedSttModelAsset?.name ?? formatAdapter(selectedSttRuntime?.adapter)}
                    provider={formatAdapter(selectedSttRuntime?.adapter)}
                    price="$0.01/min"
                    latency="100ms"
                  />
                  <RuntimeCard
                    accent="bg-[#3b82f6]"
                    label="Model"
                    title={selectedModelAsset?.name ?? formatAdapter(selectedModelRuntime?.adapter)}
                    provider={formatAdapter(selectedModelRuntime?.adapter)}
                    price="$0.06/min"
                    latency="700ms"
                    latencyClassName="text-[#f4c20d]"
                  />
                  <RuntimeCard
                    accent="bg-[#c026d3]"
                    label="Voice"
                    title={selectedVoice?.name ?? selectedAgent?.voiceId ?? "No voice"}
                    provider={selectedVoice ? voiceTonalityLabel(selectedVoice) : formatAdapter(selectedVoiceRuntime?.adapter)}
                    price="$0.02/min"
                    latency="250ms"
                  />
                </div>
              </section>

              <section className="rounded-lg bg-[#151719] p-5" aria-label="First message">
                <div className="grid gap-4 xl:grid-cols-[12rem_minmax(0,1fr)]">
                  <Label className="pt-2 text-base text-[#f3f4f6]" htmlFor="first-message-mode">
                    First Message
                  </Label>
                  <div className="relative">
                    <button
                      id="first-message-mode"
                      type="button"
                      className="flex h-12 w-full max-w-md items-center justify-between rounded-md border border-[#333740] bg-black px-4 text-left text-base text-[#f3f4f6]"
                      onClick={() => setIsFirstMessageMenuOpen((isOpen) => !isOpen)}
                    >
                      {selectedFirstMode.label}
                      <ChevronDown className="h-4 w-4 text-[#a0a4ac]" aria-hidden="true" />
                    </button>
                    {isFirstMessageMenuOpen ? (
                      <div className="absolute z-10 mt-2 w-full max-w-2xl rounded-lg border border-[#333740] bg-[#17191d] p-2 shadow-2xl">
                        {firstMessageModes.map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            className={cn(
                              "flex w-full items-center justify-between rounded-md px-3 py-3 text-left text-sm text-[#f3f4f6] hover:bg-[#24262b]",
                              mode.id === firstMessageMode && "bg-[#2a2c31]",
                            )}
                            onClick={() => {
                              setFirstMessageMode(mode.id);
                              setIsFirstMessageMenuOpen(false);
                            }}
                          >
                            {mode.label}
                            {mode.id === firstMessageMode ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <textarea
                      className="mt-4 min-h-28 w-full rounded-md border border-[#333740] bg-black px-4 py-3 text-sm leading-6 text-[#f3f4f6] outline-none focus:border-[#2dd4bf]"
                      value={selectedAgent?.greeting ?? ""}
                      readOnly
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-lg bg-[#151719] p-5" aria-label="System prompt">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold tracking-normal">System Prompt</h3>
                  <Badge className="bg-[#202329] text-[#b8bcc4]">Read only</Badge>
                </div>
                <div className="max-h-72 overflow-auto rounded-md border border-[#333740] bg-black p-4 text-sm leading-7 text-[#f3f4f6]">
                  <pre className="whitespace-pre-wrap font-sans">
                    {selectedAgent?.systemPrompt ?? "Select an agent to review its call instructions."}
                  </pre>
                </div>
              </section>

            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-[#101113]" aria-label="Call side panel">
            <header className="border-b border-[#2b2d32] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <MessageSquareText className="h-5 w-5 text-[#2dd4bf]" aria-hidden="true" />
                  <h2 className="truncate text-lg font-semibold tracking-normal">Call workspace</h2>
                </div>
                <Badge className="bg-[#202329] text-[#b8bcc4]">{transcriptEvents.length} turns</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-[#2c3036] bg-[#15171a] p-1">
                <button
                  type="button"
                  aria-pressed={callPanelTab === "transcript"}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    callPanelTab === "transcript" ? "bg-[#1c302d] text-[#8debd8]" : "text-[#a3a8b1] hover:bg-[#1d2025]",
                  )}
                  onClick={() => setCallPanelTab("transcript")}
                >
                  Transcript
                </button>
                <button
                  type="button"
                  aria-pressed={callPanelTab === "log"}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    callPanelTab === "log" ? "bg-[#1c302d] text-[#8debd8]" : "text-[#a3a8b1] hover:bg-[#1d2025]",
                  )}
                  onClick={() => setCallPanelTab("log")}
                >
                  Call log
                </button>
              </div>
            </header>

            {callPanelTab === "transcript" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div
                  ref={transcriptScrollRef}
                  className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-5"
                  aria-label="Transcript messages"
                >
                  {transcriptEvents.length === 0 ? (
                    <TranscriptBubble
                      actor="assistant"
                      text={selectedAgent?.greeting ?? "No transcript segments yet."}
                    />
                  ) : (
                    transcriptEvents.map((event) => (
                      <TranscriptBubble key={event.id} actor={event.actor} text={formatPayload(event.payload)} />
                    ))
                  )}
                </div>
                <ActiveCallBar
                  activeCall={activeCall}
                  selectedAgentName={selectedAgent?.name}
                  selectedCall={selectedCall}
                  endState={endState}
                  onEnd={() => void endSelectedCall()}
                />
              </div>
            ) : (
              <CallLogPanel
                calls={calls}
                filteredCalls={filteredCalls}
                selectedCallId={selectedCallId}
                debugEvents={debugEvents}
                eventsError={eventsError}
                isLoadingEvents={isLoadingEvents}
                channelFilter={channelFilter}
                statusFilter={statusFilter}
                onChannelFilterChange={setChannelFilter}
                onStatusFilterChange={setStatusFilter}
                onSelectCall={(callId) => void selectCall(callId)}
              />
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

function CallLogPanel({
  calls,
  filteredCalls,
  selectedCallId,
  debugEvents,
  eventsError,
  isLoadingEvents,
  channelFilter,
  statusFilter,
  onChannelFilterChange,
  onStatusFilterChange,
  onSelectCall,
}: {
  calls: CallRecord[];
  filteredCalls: CallRecord[];
  selectedCallId: string | null;
  debugEvents: CallEvent[];
  eventsError: string | null;
  isLoadingEvents: boolean;
  channelFilter: CallChannelFilter;
  statusFilter: CallStatusFilter;
  onChannelFilterChange: (filter: CallChannelFilter) => void;
  onStatusFilterChange: (filter: CallStatusFilter) => void;
  onSelectCall: (callId: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5" aria-label="Call log">
      <section className="rounded-lg bg-[#151719] p-4" aria-label="Call records">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#8d929b]">Call detail</h3>
            <p className="mt-1 text-sm text-[#a0a4ac]">Records and event timeline</p>
          </div>
          <Badge className="bg-[#202329] text-[#b8bcc4]">
            {filteredCalls.length} of {calls.length} recorded
          </Badge>
        </div>
        <div className="mb-4 grid gap-3 rounded-md border border-[#2e3138] bg-[#111315] p-3">
          <FilterGroup
            label="Channel"
            options={channelFilters}
            activeId={channelFilter}
            onSelect={onChannelFilterChange}
          />
          <FilterGroup
            label="Status"
            options={statusFilters}
            activeId={statusFilter}
            onSelect={onStatusFilterChange}
          />
        </div>
        {calls.length === 0 ? (
          <p className="rounded-md border border-[#2f333a] bg-[#111315] p-3 text-sm text-[#90959e]">
            No calls recorded.
          </p>
        ) : filteredCalls.length === 0 ? (
          <p className="rounded-md border border-[#2f333a] bg-[#111315] p-3 text-sm text-[#90959e]">
            No calls match the current filters.
          </p>
        ) : (
          <div className="grid gap-2">
            {filteredCalls.map((call) => {
              const isSelected = call.id === selectedCallId;

              return (
                <button
                  key={call.id}
                  type="button"
                  className={cn(
                    "grid min-h-12 grid-cols-[minmax(7rem,1fr)_5.5rem_5.5rem] items-center gap-2 rounded-md border border-transparent px-3 py-2 text-left text-sm text-[#d9dce1] transition-colors hover:border-[#333740] hover:bg-[#1a1d21]",
                    isSelected && "border-[#2c4f4d] bg-[#172220]",
                  )}
                  onClick={() => onSelectCall(call.id)}
                >
                  <span className="truncate font-mono">{call.id}</span>
                  <Badge variant={callStatusVariant(call)}>{displayCallStatus(call)}</Badge>
                  <span className="text-[#8f949e]">{formatDuration(call.durationSeconds)}</span>
                  <span className="col-span-3 truncate text-xs text-[#8f949e]">
                    {`${call.direction ?? "inbound"} ${call.channel}`} · {formatMoney(call.costEstimateUsd)}
                  </span>
                  <span className="sr-only">{displayFailureReason(call)}</span>
                </button>
              );
            })}
          </div>
        )}

        {debugEvents.length > 0 || eventsError || isLoadingEvents ? (
          <div className="mt-4 grid gap-2">
            {isLoadingEvents ? (
              <p className="text-sm text-[#8f949e]">Loading events...</p>
            ) : eventsError ? (
              <Badge variant="danger">{eventsError}</Badge>
            ) : (
              debugEvents.map((event) => (
                <div key={event.id} className="grid gap-1 border-l border-[#333740] pl-3 text-sm">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 font-medium">
                      <ListChecks className="h-4 w-4 shrink-0 text-[#8f949e]" aria-hidden="true" />
                      <span className="truncate">{event.type}</span>
                    </span>
                    <Badge variant={event.severity === "error" ? "danger" : "outline"}>{event.actor}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#8f949e]">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{event.timestamp}</span>
                  </div>
                  <p className="break-words text-sm text-[#b8bcc4]">{formatPayload(event.payload)}</p>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ActiveCallBar({
  activeCall,
  selectedAgentName,
  selectedCall,
  endState,
  onEnd,
}: {
  activeCall: CallRecord | null;
  selectedAgentName: string | undefined;
  selectedCall: CallRecord | null;
  endState: "idle" | "saving" | "saved" | "failed";
  onEnd: () => void;
}) {
  return (
    <div className="mt-auto border-t border-[#2e3138] bg-[#14161a] p-4">
      <div className="flex items-center gap-3 rounded-lg border border-[#373a41] bg-[#17191d] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8d929b]">Active call</div>
          <div className="mt-1 truncate text-base font-semibold">
            {selectedAgentName ?? activeCall?.id ?? "No active call"}
          </div>
          <div className="mt-1 font-mono text-sm text-[#8d929b]">
            {activeCall ? formatDuration(activeCall.durationSeconds) : "00:00"}
          </div>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="icon"
          className="bg-[#ef4444] text-white hover:bg-[#dc2626]"
          aria-label="End active call"
          onClick={onEnd}
          disabled={!selectedCall || !isActiveCall(selectedCall) || endState === "saving"}
        >
          <PhoneOff aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function MetricStrip({
  label,
  value,
  suffix,
  segments,
}: {
  label: string;
  value: string;
  suffix: string;
  color: "teal" | "amber";
  segments: string[];
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8c919a]">{label}</div>
      <div className="mt-4 flex items-center gap-4">
        <div className="whitespace-nowrap text-3xl font-semibold tracking-normal">
          <span className="text-[#f4f6f8]">{value}</span>
          <span className="ml-1 text-base text-[#8f949e]">{suffix}</span>
        </div>
        <div className="flex h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-[#262a30]">
          {segments.map((segment, index) => (
            <span key={`${segment}-${index}`} className={cn("h-full", segment, index === 0 ? "flex-[1.35]" : "flex-1")} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterGroup<TFilter extends string>({
  label,
  options,
  activeId,
  onSelect,
}: {
  label: string;
  options: Array<{ id: TFilter; label: string }>;
  activeId: TFilter;
  onSelect: (id: TFilter) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-center">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8d929b]">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.id === activeId;

          return (
            <button
              key={option.id}
              type="button"
              aria-label={`${label}: ${option.label}`}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                isActive
                  ? "border-[#2d6f69] bg-[#132825] text-[#8debd8]"
                  : "border-[#32363d] bg-[#17191d] text-[#b8bcc4] hover:border-[#424852] hover:bg-[#202329]",
              )}
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeCard({
  accent,
  label,
  title,
  provider,
  price,
  latency,
  latencyClassName = "text-[#2dd4bf]",
}: {
  accent: string;
  label: string;
  title: string;
  provider: string;
  price: string;
  latency: string;
  latencyClassName?: string;
}) {
  return (
    <div className="rounded-lg bg-[#1b1e22] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#858a93]">
            <Circle className={cn("h-3 w-3 fill-current stroke-none", accent)} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </div>
          <div className="mt-5 truncate text-lg font-semibold">{title}</div>
          <div className="mt-2 flex items-center gap-2 truncate text-sm text-[#8d929b]">
            {label === "Model" ? (
              <Brain className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : label === "Voice" ? (
              <Headphones className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <Gauge className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {provider}
          </div>
        </div>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#363a42] text-[#a6abb4]">
          {label === "Model" ? (
            <Brain className="h-4 w-4" aria-hidden="true" />
          ) : label === "Voice" ? (
            <Headphones className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Gauge className="h-4 w-4" aria-hidden="true" />
          )}
        </div>
      </div>
      <div className="mt-5 flex items-center gap-4 text-sm">
        <span>{price}</span>
        <span className={latencyClassName}>{latency}</span>
      </div>
    </div>
  );
}

function TranscriptBubble({ actor, text }: { actor: string; text: string }) {
  const isAssistant = actor === "assistant";

  return (
    <div className={cn("max-w-[36rem]", isAssistant ? "mr-auto" : "ml-auto")}>
      <div className="mb-2 text-sm font-semibold capitalize text-[#2dd4bf]">{actor}</div>
      <div
        className={cn(
          "rounded-[2rem] px-5 py-4 text-base leading-7",
          isAssistant ? "rounded-tl-md bg-[#142022] text-[#f5f7f8]" : "rounded-tr-md bg-[#223243] text-[#f5f7f8]",
        )}
      >
        {text}
      </div>
    </div>
  );
}
