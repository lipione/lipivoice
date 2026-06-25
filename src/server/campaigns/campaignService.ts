import { nanoid } from "nanoid";
import type { Campaign, CampaignContact, CampaignRun } from "@/domain/types";
import type { Repositories } from "@/server/store/repositories";

export interface CampaignServiceDeps {
  repositories: Repositories;
  now?: () => Date;
  initiateOutboundCall?: (input: OutboundCallRequest) => Promise<{ callId: string } | null>;
}

export interface OutboundCallRequest {
  agentId: string;
  contact: CampaignContact;
  campaignId: string;
  campaignRunId: string;
  contextPromptSuffix: string;
}

export function createCampaignService(deps: CampaignServiceDeps) {
  const { repositories } = deps;
  const now = deps.now ?? (() => new Date());

  function buildContextSuffix(campaign: Campaign, contact: CampaignContact): string {
    const lines: string[] = [
      `\n\n[OUTBOUND CALL CONTEXT]`,
      `Campaign: ${campaign.name} (${campaign.type.replace(/_/g, " ")})`,
      `Caller name: ${contact.name}`,
      `Phone: ${contact.phoneNumber}`,
    ];

    if (contact.policyId) {
      const policy = repositories.policies.get(contact.policyId);
      if (policy) {
        lines.push(`Policy number: ${policy.policyNumber}`);
        lines.push(`Policy type: ${policy.type}`);
        lines.push(`Policy status: ${policy.status}`);
        lines.push(`Policy end date: ${policy.endDate}`);
        if (policy.renewalDueDate) {
          lines.push(`Renewal due: ${policy.renewalDueDate}`);
        }
        lines.push(`Premium: NPR ${policy.premium.toLocaleString()}`);
      }
    }

    if (contact.contextData) {
      for (const [key, value] of Object.entries(contact.contextData)) {
        lines.push(`${key}: ${value}`);
      }
    }

    if (campaign.type === "renewal_reminder") {
      lines.push(`Purpose: Remind the customer about their upcoming policy renewal and offer to assist with the renewal process.`);
    } else if (campaign.type === "claim_followup") {
      lines.push(`Purpose: Follow up on the customer's insurance claim and check if they need further assistance.`);
    }

    lines.push(`[END CONTEXT]`);
    return lines.join("\n");
  }

  async function launchCampaign(campaignId: string): Promise<{ launched: number; failed: number }> {
    const campaign = repositories.campaigns.get(campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);
    if (campaign.status !== "draft" && campaign.status !== "scheduled") {
      throw new Error(`Campaign ${campaignId} is not in a launchable state: ${campaign.status}`);
    }

    const nowStr = now().toISOString();
    repositories.campaigns.save({
      ...campaign,
      status: "running",
      updatedAt: nowStr,
    });

    const pendingRuns = repositories.campaignRuns.listPending(campaignId);
    let launched = 0;
    let failed = 0;

    for (const run of pendingRuns) {
      try {
        await dialContact(campaign, run);
        launched++;
      } catch {
        failed++;
        repositories.campaignRuns.save({ ...run, status: "failed", updatedAt: now().toISOString() });
      }
    }

    const updatedCampaign = repositories.campaigns.get(campaignId)!;
    if (pendingRuns.length === 0 || launched + failed >= updatedCampaign.totalContacts) {
      repositories.campaigns.save({
        ...updatedCampaign,
        status: "completed",
        completedAt: now().toISOString(),
        updatedAt: now().toISOString(),
      });
    }

    return { launched, failed };
  }

  async function dialContact(campaign: Campaign, run: CampaignRun): Promise<void> {
    const contact = campaign.contacts.find((c) => c.customerId === run.customerId);
    if (!contact) throw new Error(`Contact not found for customerId: ${run.customerId}`);

    const nowStr = now().toISOString();
    repositories.campaignRuns.save({
      ...run,
      status: "dialing",
      startedAt: nowStr,
      updatedAt: nowStr,
    });

    if (!deps.initiateOutboundCall) {
      repositories.campaignRuns.save({
        ...run,
        status: "failed",
        notes: "No outbound call handler configured",
        updatedAt: now().toISOString(),
      });
      return;
    }

    const contextSuffix = buildContextSuffix(campaign, contact);
    const result = await deps.initiateOutboundCall({
      agentId: campaign.agentId,
      contact,
      campaignId: campaign.id,
      campaignRunId: run.id,
      contextPromptSuffix: contextSuffix,
    });

    if (result) {
      repositories.campaignRuns.save({
        ...run,
        status: "connected",
        callId: result.callId,
        updatedAt: now().toISOString(),
      });
      const current = repositories.campaigns.get(campaign.id)!;
      repositories.campaigns.save({
        ...current,
        dialedCount: current.dialedCount + 1,
        answeredCount: current.answeredCount + 1,
        updatedAt: now().toISOString(),
      });
    } else {
      repositories.campaignRuns.save({
        ...run,
        status: "no_answer",
        updatedAt: now().toISOString(),
      });
      const current = repositories.campaigns.get(campaign.id)!;
      repositories.campaigns.save({
        ...current,
        dialedCount: current.dialedCount + 1,
        failedCount: current.failedCount + 1,
        updatedAt: now().toISOString(),
      });
    }
  }

  function createCampaignFromContacts(input: {
    name: string;
    type: Campaign["type"];
    agentId: string;
    contacts: CampaignContact[];
    scheduledAt?: string | null;
    notes?: string;
  }): Campaign {
    const nowStr = now().toISOString();
    const scheduledAt = input.scheduledAt ?? null;
    const campaign = repositories.campaigns.save({
      id: `campaign_${nanoid(10)}`,
      name: input.name,
      type: input.type,
      status: scheduledAt ? "scheduled" : "draft",
      agentId: input.agentId,
      contacts: input.contacts,
      scheduledAt,
      completedAt: null,
      totalContacts: input.contacts.length,
      dialedCount: 0,
      answeredCount: 0,
      failedCount: 0,
      notes: input.notes ?? "",
      createdAt: nowStr,
      updatedAt: nowStr,
    });

    for (const contact of input.contacts) {
      repositories.campaignRuns.save({
        id: `crun_${nanoid(10)}`,
        campaignId: campaign.id,
        customerId: contact.customerId,
        callId: null,
        status: "pending",
        attemptCount: 0,
        scheduledAt: scheduledAt ?? nowStr,
        startedAt: null,
        endedAt: null,
        notes: "",
        createdAt: nowStr,
        updatedAt: nowStr,
      });
    }

    return campaign;
  }

  function buildRenewalCampaign(input: { agentId: string; withinDays?: number; scheduledAt?: string | null }): Campaign {
    const policies = repositories.policies.findDueForRenewal(input.withinDays ?? 30);
    const contacts: CampaignContact[] = [];

    for (const policy of policies) {
      const customer = repositories.customers.get(policy.customerId);
      if (!customer) continue;

      contacts.push({
        customerId: customer.id,
        phoneNumber: customer.phoneNumber,
        name: customer.name,
        policyId: policy.id,
        contextData: {
          policyNumber: policy.policyNumber,
          policyType: policy.type,
          renewalDate: policy.endDate,
          premium: `NPR ${policy.premium.toLocaleString()}`,
        },
      });
    }

    return createCampaignFromContacts({
      name: `Policy Renewal Reminders — ${new Date().toLocaleDateString("en-GB")}`,
      type: "renewal_reminder",
      agentId: input.agentId,
      contacts,
      scheduledAt: input.scheduledAt ?? null,
      notes: `Auto-generated for ${contacts.length} policies due in ${input.withinDays ?? 30} days`,
    });
  }

  async function launchDueCampaigns(): Promise<{ launchedCampaigns: number; launchedCalls: number; failedCalls: number }> {
    const dueAt = now().toISOString();
    let launchedCampaigns = 0;
    let launchedCalls = 0;
    let failedCalls = 0;

    for (const campaign of repositories.campaigns.list()) {
      if (campaign.status !== "scheduled" || !campaign.scheduledAt || campaign.scheduledAt > dueAt) {
        continue;
      }

      const result = await launchCampaign(campaign.id);
      launchedCampaigns += 1;
      launchedCalls += result.launched;
      failedCalls += result.failed;
    }

    return { launchedCampaigns, launchedCalls, failedCalls };
  }

  return {
    createCampaignFromContacts,
    buildRenewalCampaign,
    launchCampaign,
    launchDueCampaigns,
    dialContact,
    buildContextSuffix,
  };
}

export type CampaignService = ReturnType<typeof createCampaignService>;
