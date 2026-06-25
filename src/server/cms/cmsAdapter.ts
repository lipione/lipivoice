import { nanoid } from "nanoid";
import type { Customer, Policy } from "@/domain/types";
import type { Repositories } from "@/server/store/repositories";

export interface CmsAdapterConfig {
  baseUrl: string;
  authMode: "none" | "bearer" | "api_key" | "basic";
  authValue: string;
  customerEndpoint: string;
  policyEndpoint: string;
  fetcher?: typeof fetch;
}

interface CmsCustomerRecord {
  id?: string;
  name?: string;
  full_name?: string;
  phone?: string;
  phone_number?: string;
  mobile?: string;
  email?: string;
  address?: string;
  preferred_language?: string;
  language?: string;
}

interface CmsPolicyRecord {
  id?: string;
  policy_number?: string;
  policyNumber?: string;
  customer_id?: string;
  customerId?: string;
  type?: string;
  policy_type?: string;
  status?: string;
  insured_name?: string;
  insuredName?: string;
  premium?: number;
  sum_insured?: number;
  sumInsured?: number;
  start_date?: string;
  startDate?: string;
  end_date?: string;
  endDate?: string;
  renewal_due_date?: string;
  renewalDueDate?: string;
  claim_count?: number;
  claimCount?: number;
  notes?: string;
}

export interface CmsSyncResult {
  customers: { created: number; updated: number; errors: number };
  policies: { created: number; updated: number; errors: number };
  syncedAt: string;
}

export function createCmsAdapter(config: CmsAdapterConfig) {
  const fetcher = config.fetcher ?? fetch;

  function authHeaders(): Record<string, string> {
    if (config.authMode === "bearer") {
      return { Authorization: `Bearer ${config.authValue}` };
    }
    if (config.authMode === "api_key") {
      return { "X-API-Key": config.authValue };
    }
    if (config.authMode === "basic") {
      return { Authorization: `Basic ${Buffer.from(config.authValue).toString("base64")}` };
    }
    return {};
  }

  async function fetchCustomers(): Promise<CmsCustomerRecord[]> {
    const url = `${config.baseUrl.replace(/\/$/, "")}${config.customerEndpoint}`;
    const response = await fetcher(url, {
      headers: { "content-type": "application/json", ...authHeaders() },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`CMS customer fetch failed: ${response.status}`);
    }

    const data = await response.json() as unknown;
    if (Array.isArray(data)) return data as CmsCustomerRecord[];
    if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
      return (data as { data: CmsCustomerRecord[] }).data;
    }
    if (data && typeof data === "object" && "results" in data && Array.isArray((data as { results: unknown }).results)) {
      return (data as { results: CmsCustomerRecord[] }).results;
    }
    return [];
  }

  async function fetchPolicies(): Promise<CmsPolicyRecord[]> {
    const url = `${config.baseUrl.replace(/\/$/, "")}${config.policyEndpoint}`;
    const response = await fetcher(url, {
      headers: { "content-type": "application/json", ...authHeaders() },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`CMS policy fetch failed: ${response.status}`);
    }

    const data = await response.json() as unknown;
    if (Array.isArray(data)) return data as CmsPolicyRecord[];
    if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
      return (data as { data: CmsPolicyRecord[] }).data;
    }
    if (data && typeof data === "object" && "results" in data && Array.isArray((data as { results: unknown }).results)) {
      return (data as { results: CmsPolicyRecord[] }).results;
    }
    return [];
  }

  function normalizeCmsCustomer(raw: CmsCustomerRecord, now: string): Omit<Customer, "id"> & { cmsId: string } {
    const cmsId = String(raw.id ?? "");
    return {
      cmsId,
      name: String(raw.full_name ?? raw.name ?? "Unknown"),
      phoneNumber: String(raw.phone_number ?? raw.phone ?? raw.mobile ?? ""),
      email: raw.email ? String(raw.email) : null,
      address: String(raw.address ?? ""),
      preferredLanguage: String(raw.preferred_language ?? raw.language ?? "ne"),
      notes: "",
      source: "import" as const,
      lastCallId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  function normalizeCmsPolicy(
    raw: CmsPolicyRecord,
    customerId: string,
    now: string,
  ): Omit<Policy, "id"> & { cmsId: string } {
    const endDate = String(raw.end_date ?? raw.endDate ?? "");
    return {
      cmsId: String(raw.id ?? ""),
      customerId,
      policyNumber: String(raw.policy_number ?? raw.policyNumber ?? ""),
      type: normalizePolicyType(String(raw.policy_type ?? raw.type ?? "miscellaneous")),
      status: normalizePolicyStatus(String(raw.status ?? "active")),
      insuredName: String(raw.insured_name ?? raw.insuredName ?? ""),
      premium: Number(raw.premium ?? 0),
      sumInsured: Number(raw.sum_insured ?? raw.sumInsured ?? 0),
      startDate: String(raw.start_date ?? raw.startDate ?? ""),
      endDate,
      renewalDueDate: String(raw.renewal_due_date ?? raw.renewalDueDate ?? "") || null,
      claimCount: Number(raw.claim_count ?? raw.claimCount ?? 0),
      notes: String(raw.notes ?? ""),
      cmsSource: config.baseUrl,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  async function syncToRepositories(repositories: Repositories): Promise<CmsSyncResult> {
    const nowStr = new Date().toISOString();
    const result: CmsSyncResult = {
      customers: { created: 0, updated: 0, errors: 0 },
      policies: { created: 0, updated: 0, errors: 0 },
      syncedAt: nowStr,
    };

    const [cmsCustomers, cmsPolicies] = await Promise.all([
      fetchCustomers().catch(() => [] as CmsCustomerRecord[]),
      fetchPolicies().catch(() => [] as CmsPolicyRecord[]),
    ]);

    const cmsIdToCustomerId = new Map<string, string>();

    for (const raw of cmsCustomers) {
      try {
        const normalized = normalizeCmsCustomer(raw, nowStr);
        if (!normalized.phoneNumber) continue;

        const existing = normalized.phoneNumber
          ? repositories.customers.findByPhone(normalized.phoneNumber)
          : null;

        if (existing) {
          repositories.customers.save({ ...existing, ...normalized, id: existing.id, updatedAt: nowStr });
          cmsIdToCustomerId.set(normalized.cmsId, existing.id);
          result.customers.updated++;
        } else {
          const saved = repositories.customers.save({ id: `cust_${nanoid(10)}`, ...normalized });
          cmsIdToCustomerId.set(normalized.cmsId, saved.id);
          result.customers.created++;
        }
      } catch {
        result.customers.errors++;
      }
    }

    for (const raw of cmsPolicies) {
      try {
        const cmsCustomerId = String(raw.customer_id ?? raw.customerId ?? "");
        const customerId = cmsIdToCustomerId.get(cmsCustomerId);
        if (!customerId) continue;

        const normalized = normalizeCmsPolicy(raw, customerId, nowStr);
        const existing = normalized.cmsId
          ? repositories.policies.findByCmsId(normalized.cmsId)
          : null;

        if (existing) {
          repositories.policies.save({ ...existing, ...normalized, id: existing.id, updatedAt: nowStr });
          result.policies.updated++;
        } else {
          repositories.policies.save({ id: `pol_${nanoid(10)}`, ...normalized });
          result.policies.created++;
        }
      } catch {
        result.policies.errors++;
      }
    }

    return result;
  }

  return { syncToRepositories, fetchCustomers, fetchPolicies };
}

export type CmsAdapter = ReturnType<typeof createCmsAdapter>;

function normalizePolicyType(raw: string): Policy["type"] {
  const map: Record<string, Policy["type"]> = {
    motor: "motor",
    vehicle: "motor",
    car: "motor",
    property: "property",
    home: "property",
    house: "property",
    health: "health",
    medical: "health",
    life: "life",
    marine: "marine",
    engineering: "engineering",
    agriculture: "agriculture",
    micro: "micro",
  };
  return map[raw.toLowerCase()] ?? "miscellaneous";
}

function normalizePolicyStatus(raw: string): Policy["status"] {
  const map: Record<string, Policy["status"]> = {
    active: "active",
    expired: "expired",
    inactive: "expired",
    pending: "pending",
    cancelled: "cancelled",
    canceled: "cancelled",
    lapsed: "lapsed",
  };
  return map[raw.toLowerCase()] ?? "active";
}
