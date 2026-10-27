import type { Artifact, Challenge, Vignette } from "./state";

export const fixtureVignette: Vignette = {
  case_id: "CASE-01",
  display_name: "冻结案件 vignette（开发 fixture）",
  facts: "这是 TEST_ONLY 开发 fixture。正式部署必须从版本化 HG2 artifact manifest 加载冻结案件事实。",
  issues: [{ issue_id: "CASE-01-ISS-01", issue_text: "冻结争点：请根据事实与后续材料独立判断该假设。" }],
  response_options: [
    { option_id: "A", label: "方案 A", description: "示例解释一。" },
    { option_id: "B", label: "方案 B", description: "示例解释二。" },
    { option_id: "C", label: "方案 C", description: "示例解释三。" },
    { option_id: "U", label: "现有信息不足以判断", description: "当前材料不足以作出选择。" },
  ],
};

export const fixtureArtifacts: Record<string, Artifact> = {
  "HG2-C0_STANDARD_RAG": { condition: "HG2-C0_STANDARD_RAG", answer: "开发 fixture 基线文本。", presentation_note: "仅用于 TEST_ONLY 表面 smoke。" },
  "HG2-C1_COMPETITIVE": {
    condition: "HG2-C1_COMPETITIVE", answer: "开发 fixture 结构化回答。", presentation_note: "结构化字段是机器呈现，不是法律正确性判断。",
    claims: [{ claim_id: "C1", claim_text: "示例 claim。", claim_type: "governing_rule", support_status: "supported", citations: [{ quote_id: "Q1", quote: "示例原文引文。" }] }],
    route_evidence: { neutral_governing: [{ chunk_id: "fixture-1", doc_id: "fixture-doc", role: "示例", note: "开发 fixture" }] },
    conflicts: [], gaps: [], uncertainty: { level: "medium", reasons: ["开发 fixture"] },
  },
  "HG2-C2_COMPETITIVE_AUDIT": {
    condition: "HG2-C2_COMPETITIVE_AUDIT", answer: "开发 fixture 结构化回答与描述性审计面板。", presentation_note: "面板不是公平或正确性结论。",
    audit_panel: { descriptive_only: true, not_correctness_or_fairness_evidence: true, signals: [] },
  },
};

export const fixtureChallenge: Challenge = {
  challenge_id: "CASE-01-challenge-fixture",
  challenge_text: "这是统一挑战材料的开发 fixture。阅读后可重新判断，但系统不提供正确答案。",
  evidence: [{ alias: "E1", chunk_id: "fixture-1", doc_id: "fixture-doc", text: "示例挑战证据文本。" }],
};
