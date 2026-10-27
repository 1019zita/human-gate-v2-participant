import type { Artifact, Challenge, Vignette } from "./state";

export const fixtureVignette: Vignette = {
  case_id: "CASE-01",
  display_name: "冻结案件 vignette（开发 fixture）",
  facts: "这是 TEST_ONLY 开发 fixture。正式部署必须从版本化 HG2 artifact manifest 加载冻结案件事实。",
  response_options: [
    { option_id: "A", label: "方案 A", description: "示例解释一。" },
    { option_id: "B", label: "方案 B", description: "示例解释二。" },
    { option_id: "C", label: "方案 C", description: "示例解释三。" },
    { option_id: "U", label: "现有信息不足以判断", description: "当前材料不足以作出选择。" },
  ],
};

export const fixtureArtifacts: Record<string, Artifact> = {
  "HG2-C0_STANDARD_RAG": { case_summary: "开发 fixture 案件事实。", ai_summary: "开发 fixture 基线文本。", presentation_note: "仅用于 TEST_ONLY 表面 smoke。" },
  "HG2-C1_COMPETITIVE": {
    case_summary: "开发 fixture 案件事实。",
    ai_summary: "开发 fixture 结构化回答。",
    presentation_note: "结构化字段是机器呈现，不是法律正确性判断。",
    core_reasons: ["示例理由。"],
    supporting_material: [{ source_title: "示例来源", source_type: "示例材料", paragraphs: ["示例原文。"] }],
    counter_weakening_material: [{ source_title: "示例反向来源", source_type: "示例材料", paragraphs: ["示例反向材料。"] }],
    alternative_explanation: [],
    uncertainty_statements: ["开发 fixture。"],
  },
  "HG2-C2_COMPETITIVE_AUDIT": {
    case_summary: "开发 fixture 案件事实。",
    ai_summary: "开发 fixture 结构化回答与描述性材料说明。",
    presentation_note: "材料说明不是公平或正确性结论。",
    audit_panel: { display_note: "材料说明不代表法律正确性或公平性结论。" },
  },
};

export const fixtureChallenge: Challenge = {
  challenge_id: "CASE-01-challenge-fixture",
  challenge_text: "这是统一挑战材料的开发 fixture。阅读后可重新判断，但系统不提供正确答案。",
  evidence: [{ source_title: "示例挑战来源", source_type: "示例材料", paragraphs: ["示例挑战证据文本。"] }],
};
