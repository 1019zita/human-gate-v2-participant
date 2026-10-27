export type CaseResponseOption = {
  option_id: string;
  label: string;
  description: string;
};

export type Response = string;
export type Condition = "HG2-C0_STANDARD_RAG" | "HG2-C1_COMPETITIVE" | "HG2-C2_COMPETITIVE_AUDIT";
export type Evidence = { alias: string; chunk_id: string; doc_id: string; text: string };
export type Artifact = {
  condition: Condition;
  answer?: string;
  presentation_note?: string;
  claims?: Array<{ claim_id?: string; claim_text?: string; claim_type?: string; support_status?: string; citations?: Array<{ quote_id?: string; quote?: string }> }>;
  route_evidence?: Record<string, Array<{ chunk_id?: string; doc_id?: string; role?: string; note?: string }>>;
  conflicts?: Array<{ conflict_id?: string; description?: string; resolution_status?: string }>;
  gaps?: Array<{ gap_id?: string; description?: string; route?: string; missing_aspect?: string }>;
  uncertainty?: { level?: string; reasons?: string[] };
  audit_panel?: { descriptive_only: boolean; not_correctness_or_fairness_evidence: boolean; signals: Array<Record<string, unknown>> };
};

export type Vignette = {
  case_id: string;
  display_name: string;
  facts: string;
  issues: Array<{ issue_id: string; issue_text: string }>;
  response_options: CaseResponseOption[];
};

export type Challenge = { challenge_id: string; challenge_text: string; evidence: Evidence[] };
