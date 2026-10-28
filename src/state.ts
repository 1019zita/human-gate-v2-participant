export type CaseResponseOption = {
  option_id: string;
  label: string;
  description: string;
};

export type Response = string;
export type Condition = "HG2-C0_STANDARD_RAG" | "HG2-C1_COMPETITIVE" | "HG2-C2_COMPETITIVE_AUDIT";
export type SourceMaterial = {
  source_title: string;
  source_type: string;
  source_origin?: string;
  key_sentence?: string;
  paragraphs: string[];
};
export type Artifact = {
  condition?: Condition;
  case_summary: string;
  ai_summary: string;
  presentation_note?: string;
  core_reasons?: string[];
  supporting_material?: SourceMaterial[];
  counter_weakening_material?: SourceMaterial[];
  alternative_explanation?: SourceMaterial[];
  uncertainty_statements?: string[];
  audit_panel?: { display_note: string };
};
export type Vignette = {
  case_id: string;
  display_name: string;
  facts: string;
  response_options: CaseResponseOption[];
};
export type Challenge = {
  challenge_id: string;
  challenge_text: string;
  evidence: SourceMaterial[];
};
