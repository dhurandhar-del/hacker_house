/**
 * GENERATED — do not hand-edit.
 *
 * Emitted from the Python enums by:
 *   python -m api.contract emit --out frontend/src/lib/generated/contract.ts
 *
 * The 14 action identifiers, three routes and seven enums exist once, in
 * `backend/sentinel/domain/enums.py`. Hand-typing "BLOCK_ALL_CARDS" anywhere in
 * this app is how the third copy drifts. See HLD ADR-7.
 *
 * This file is checked in so the frontend can be built before the backend
 * exists; the emitter overwrites it and CI asserts the two agree.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export const ACTIONS = [
  "ALLOW_TRANSACTION",
  "DECLINE_TRANSACTION",
  "MONITOR_CARD",
  "MONITOR_CONNECTED_CARDS",
  "WARN_CUSTOMER",
  "VERIFY_WITH_CUSTOMER",
  "STEP_UP_AUTH",
  "BLOCK_CARD",
  "BLOCK_ALL_CARDS",
  "GENERATE_REPORT",
  "CREATE_CASE",
  "FILE_REPORT",
  "ESCALATE_TO_ANALYST",
  "CLOSE_NO_FRAUD",
] as const;
export type Action = (typeof ACTIONS)[number];

export type Route = "auto" | "L1" | "L2";
export type Role = "analyst" | "team_lead" | "fraud_manager";
export type Verdict = "fraud" | "legitimate" | "uncertain";
export type CaseStatus = "open" | "closed_fraud" | "closed_legitimate" | "escalated";
export type Pattern =
  | "card_testing"
  | "card_not_present_fraud"
  | "card_not_present_new_device"
  | "out_of_region_use"
  | "account_takeover"
  | "undocumented"
  | "none";
export type EvidenceSource = "graph" | "document" | "customer" | "external";
export type RequestType = "customer_validation" | "step_up_auth" | "analyst_info";
export type TriggerType = "risk_score" | "customer_report" | "analyst_request";

/** The auto/L1/L2 table. BLOCK_CARD is the only exposure-dependent action:
 *  L1 at exposure <= 2500.00 (inclusive), L2 above. */
export const FIXED_ROUTES: Partial<Record<Action, Route>> = {
  ALLOW_TRANSACTION: "auto",
  MONITOR_CARD: "auto",
  MONITOR_CONNECTED_CARDS: "auto",
  WARN_CUSTOMER: "auto",
  VERIFY_WITH_CUSTOMER: "auto",
  STEP_UP_AUTH: "auto",
  GENERATE_REPORT: "auto",
  CREATE_CASE: "auto",
  ESCALATE_TO_ANALYST: "auto",
  CLOSE_NO_FRAUD: "auto",
  DECLINE_TRANSACTION: "L1",
  BLOCK_ALL_CARDS: "L2",
  FILE_REPORT: "L2",
};

export const BLOCK_CARD_L2_THRESHOLD = 2500.0;
export const SAR_EXPOSURE_THRESHOLD = 1000.0;
export const CASE_PROBABILITY_THRESHOLD = 0.3;
export const VERIFY_BEFORE_BLOCK_THRESHOLD = 0.7;
export const ESCALATE_EXPOSURE_THRESHOLD = 500.0;
export const STOP_HIGH = 0.85;
export const STOP_LOW = 0.15;
export const GROUP_CAP = 1.2;

export const APPROVERS: Record<Route, Role[]> = {
  auto: ["analyst", "team_lead", "fraud_manager"],
  L1: ["team_lead", "fraud_manager"],
  L2: ["fraud_manager"],
};

/** Display-only. The route itself is always recomputed server-side. */
export function routeFor(action: Action, exposureUsd: number): Route {
  const fixed = FIXED_ROUTES[action];
  if (fixed) return fixed;
  if (action === "BLOCK_CARD") return exposureUsd <= BLOCK_CARD_L2_THRESHOLD ? "L1" : "L2";
  throw new Error(`no route defined for ${action}`);
}

// ─── The answer contract ─────────────────────────────────────────────────────

export interface Evidence {
  claim: string;
  source: EvidenceSource;
  ref: string;
  entity_ids: string[];
}

export interface EvidenceRequest {
  type: RequestType;
  asked_after_step: number;
  assumed_response: string;
}

export interface ActionRecommendation {
  action: Action;
  route: Route;
  reason: string;
}

export interface NextBestActions {
  initial: ActionRecommendation[];
  final: ActionRecommendation[];
  what_changed: string;
}

export interface SarReport {
  file: boolean;
  reason: string;
  narrative: string;
  subjects: string[];
  total_amount_usd: number;
  activity_dates: string[];
}

export interface Case {
  status: CaseStatus;
  verdict: Verdict;
  fraud_probability: number;
  pattern: Pattern;
  pattern_description: string;
  affected_txn_ids: string[];
  first_suspicious_txn_id: string;
  connected_card_ids: string[];
  /** "DeviceInfo | OS | browser | screen" — the label form, not a vertex key. */
  connected_device_profiles: string[];
  exposure_usd: number;
  evidence: Evidence[];
  similar_prior_cases: string[];
  summary: string;
  written_to_graph: boolean;
  graph_case_id: string;
}

export interface AnswerFile {
  case_id: string;
  case: Case;
  evidence_requests: EvidenceRequest[];
  next_best_actions: NextBestActions;
  sar: SarReport;
  stop_reason: string;
  tool_calls: number;
  tokens: number;
  latency_s: number;
}

// ─── The SSE stream ──────────────────────────────────────────────────────────

export type SentinelEventType =
  | "run.started"
  | "step.started"
  | "step.completed"
  | "tool.called"
  | "evidence.posted"
  | "retrieval.completed"
  | "policy.evaluated"
  | "evidence.requested"
  | "llm.completed"
  | "budget.updated"
  | "verdict.reached"
  | "case.written"
  | "validation.completed"
  | "run.completed"
  | "run.failed";

export const TERMINAL_EVENTS: SentinelEventType[] = ["run.completed", "run.failed"];

export type StepName =
  | "scope"
  | "plan"
  | "sweep"
  | "recall"
  | "assess"
  | "stop_test"
  | "request_evidence"
  | "decide"
  | "narrate"
  | "write";

export interface SseEnvelope<T extends SentinelEventType, P> {
  v: 1;
  /** == the SSE `id:` field. Monotonic per run from 1, so replay is `seq > n`. */
  seq: number;
  run_id: string;
  case_id: string;
  type: T;
  at: string;
  /** The investigation step. The SAME counter that fills
   *  answer.evidence_requests[].asked_after_step. Null on run-level events. */
  step: number | null;
  payload: P;
}

export interface BudgetSnapshot {
  tool_calls: number;
  max_tool_calls: number;
  evidence_rounds: number;
  max_evidence_rounds: number;
  tokens: number;
  max_tokens: number;
  usd: number;
  max_usd: number;
  elapsed_s: number;
  max_elapsed_s: number;
}

export interface RunStartedPayload {
  case_id: string;
  trigger_type: TriggerType;
  trigger_text: string;
  flagged_txn_id: string;
  card_id: string;
  customer_id: string;
  /** null when the alert carries the -1 missing-numeric sentinel (9 of the 20). */
  alert_risk_score: number | null;
  /** The ledger prior from the trigger type — NOT the model's risk score. */
  prior: number;
  mode: "live" | "replay";
  orchestrator: string;
  budget: BudgetSnapshot;
}

export interface StepStartedPayload {
  step: number;
  name: StepName;
  title: string;
  agent: string;
}

export interface StepCompletedPayload {
  step: number;
  name: StepName;
  elapsed_s: number;
  tool_calls_in_step: number;
  postings_in_step: number;
}

export interface ToolCalledPayload {
  step: number;
  tool: string;
  /** Exactly as it lands in answer.case.evidence[].ref. */
  ref: string;
  params: Record<string, string | number | boolean>;
  entity_ids: string[];
  elapsed_s: number;
  ok: boolean;
  error: string | null;
  summary: string;
}

export interface EvidencePostedPayload {
  step: number;
  feature: string;
  /** false => lr_absent was posted. Absence is evidence. */
  present: boolean;
  group: string;
  claim: string;
  source: EvidenceSource;
  ref: string;
  entity_ids: string[];
  lr: number;
  log_lr: number;
  p_before: number;
  p_after: number;
  /** GROUP_CAP clipped this posting — rendered as a hatched bar end. */
  capped: boolean;
}

export interface RetrievalHit {
  id: string;
  kind: "closed_case" | "policy_doc" | "fraud_case";
  score: number;
  title: string;
  snippet: string;
  ref: string;
}

export interface RetrievalCompletedPayload {
  step: number;
  kind: RetrievalHit["kind"];
  strategy: "vector" | "structural" | "hybrid";
  query: string;
  hits: RetrievalHit[];
}

export interface GateOutcome {
  gate: string;
  removed: Action[];
  added: Action[];
  reason: string;
}

export interface PolicyEvaluatedPayload {
  step: number;
  phase: "initial" | "final";
  fraud_probability: number;
  exposure_usd: number;
  verdict: Verdict;
  /** Distinct ledger groups that moved more than 0.05. Policy §6 counts these. */
  independent_support: number;
  recommendations: ActionRecommendation[];
  gates_applied: GateOutcome[];
  sar: { file: boolean; reason: string };
  stop: { should_stop: boolean; reason: string };
}

export interface EvidenceRequestedPayload {
  /** == asked_after_step in the answer file. */
  step: number;
  request_index: number;
  type: RequestType;
  rationale: string;
  assumed_response: string;
  /** The query refs the assumption rests on — never a guess. */
  assumption_basis: string[];
  branch: "denied" | "confirmed" | "no_reply" | "step_up_passed" | "step_up_failed";
  log_lr_applied: number;
}

export interface LlmCompletedPayload {
  step: number;
  purpose: "plan" | "claims" | "exonerate" | "summary" | "pattern_description" | "sar_narrative" | "what_changed" | "assumed_response";
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  usd: number;
  elapsed_s: number;
}

export interface VerdictReachedPayload {
  status: CaseStatus;
  verdict: Verdict;
  fraud_probability: number;
  pattern: Pattern;
  pattern_description: string;
  exposure_usd: number;
  affected_txn_ids: string[];
  connected_card_ids: string[];
  connected_device_profiles: string[];
  similar_prior_cases: string[];
  summary: string;
  stop_reason: string;
  /** [prior, ...p_after] — the full sparkline. */
  trajectory: number[];
}

export interface CaseWrittenPayload {
  graph_case_id: string;
  vertices_upserted: number;
  edges_upserted: number;
  edge_types: string[];
  embedded: boolean;
  answer_path: string;
}

export interface ValidationCompletedPayload {
  ok: boolean;
  errors: Array<{ code: string; path: string; message: string }>;
  warnings: Array<{ code: string; path: string; message: string }>;
  graph_checked: boolean;
}

export interface RunCompletedPayload {
  status: "completed";
  tool_calls: number;
  /** Must never be 0 on an agent run. */
  tokens: number;
  latency_s: number;
  validation_ok: boolean;
  answer_url: string;
}

export interface RunFailedPayload {
  code: "budget_exceeded" | "graph_unavailable" | "llm_unavailable" | "validation_failed" | "cancelled" | "internal";
  message: string;
  step: number | null;
  recoverable: boolean;
}

export type SentinelEvent =
  | SseEnvelope<"run.started", RunStartedPayload>
  | SseEnvelope<"step.started", StepStartedPayload>
  | SseEnvelope<"step.completed", StepCompletedPayload>
  | SseEnvelope<"tool.called", ToolCalledPayload>
  | SseEnvelope<"evidence.posted", EvidencePostedPayload>
  | SseEnvelope<"retrieval.completed", RetrievalCompletedPayload>
  | SseEnvelope<"policy.evaluated", PolicyEvaluatedPayload>
  | SseEnvelope<"evidence.requested", EvidenceRequestedPayload>
  | SseEnvelope<"llm.completed", LlmCompletedPayload>
  | SseEnvelope<"budget.updated", BudgetSnapshot>
  | SseEnvelope<"verdict.reached", VerdictReachedPayload>
  | SseEnvelope<"case.written", CaseWrittenPayload>
  | SseEnvelope<"validation.completed", ValidationCompletedPayload>
  | SseEnvelope<"run.completed", RunCompletedPayload>
  | SseEnvelope<"run.failed", RunFailedPayload>;

export const isEvent =
  <T extends SentinelEventType>(t: T) =>
  (e: SentinelEvent): e is Extract<SentinelEvent, { type: T }> =>
    e.type === t;
