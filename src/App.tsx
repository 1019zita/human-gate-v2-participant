import { useEffect, useMemo, useRef, useState } from "react";
import { firstGroupForCase, loadArtifactBundle, type ArtifactBundle } from "./artifacts";
import { appendEvent, appendInteraction, createSession, readSession, remoteConfigured, signInAnonymously, type ParticipantInfo, type RemoteEvent, type RemoteSession, type Trial, unlockTrial } from "./remote";
import type { Artifact, CaseResponseOption, Challenge, Response } from "./state";
import "./styles.css";

const TOKEN_KEY = "hg2_participant_access_token_v1";
const EVENT_LABELS: Record<string, string> = {
  session_open: "进入案件", consent_recorded: "知情同意", vignette_shown: "阅读案情", pre_ai_judgment_submitted: "独立判断",
  condition_unlocked: "准备 AI 材料", ai_artifact_shown: "AI 辅助", ai_review_completed: "完成 AI 阅读",
  post_ai_judgment_submitted: "AI 后判断", challenge_opened: "证据质询", challenge_completed: "完成质询",
  final_judgment_submitted: "最终判断", manipulation_check_submitted: "材料呈现检验", session_locked: "案件完成",
};
const TRIAL_STAGES = ["vignette", "pre", "ai", "post", "challenge", "final", "manipulation"] as const;
type Stage = typeof TRIAL_STAGES[number] | "starting" | "consent" | "unlocking" | "ai_review" | "challenge_wait" | "locking" | "complete";
type SaveState = "idle" | "saving" | "saved" | "error";

function eventsFor(session: RemoteSession, trial: Trial) { return session.events.filter(event => event.trial_id === trial.trial_id).sort((a, b) => a.server_seq - b.server_seq); }
function hasEvent(events: RemoteEvent[], type: string) { return events.some(event => event.event_type === type); }
function payloadOf(events: RemoteEvent[], type: string) { return events.find(event => event.event_type === type)?.payload_json ?? {}; }
function participantError(reason: unknown) { return reason instanceof Error && reason.message ? `系统提示：${reason.message}` : "系统暂时无法连接，请稍后重试。"; }
function caseLabel(order: number) { return `案件${["一", "二", "三"][order - 1] ?? order}`; }
function stageLabel(stage: Stage) { return stage === "pre" ? "独立判断" : stage === "post" ? "AI 后判断" : stage === "final" ? "最终判断" : stage === "ai" || stage === "ai_review" ? "AI 辅助" : stage === "challenge" || stage === "challenge_wait" ? "证据质询" : stage === "manipulation" ? "材料呈现检验" : stage === "vignette" ? "案件阅读" : ""; }

function ConfidenceControl({ value, onChange }: { value: number | null; onChange: (value: number) => void }) {
  return <div className="confidence-control"><p><strong>你对自己刚才这个选择有多确信？</strong></p><p className="subtle">请在 0–100 中选择一个数。0 表示完全不确信，100 表示非常确信。</p><div className="confidence-line"><span>完全不确信</span><input aria-label="确信程度 0 到 100" type="range" min="0" max="100" step="1" value={value ?? 0} onChange={event => onChange(Number(event.target.value))} /><span>非常确信</span></div><div className="confidence-value">{value === null ? "尚未选择" : value}</div></div>;
}

function ResponseOptions({ options, value, onChange }: { options: CaseResponseOption[]; value: Response | null; onChange: (value: Response) => void }) {
  return <fieldset className="response-row"><legend>根据上述案件事实，你目前更倾向于哪一种理解？</legend><div className="case-options">{options.map(option => <label className="case-option" key={option.option_id}><input type="radio" name="case-response" checked={value === option.option_id} onChange={() => onChange(option.option_id)} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></fieldset>;
}

function ScaleQuestion({ title, value, onChange }: { title: string; value: number | null; onChange: (value: number) => void }) {
  return <label className="scale-question">{title}<select value={value ?? ""} onChange={event => onChange(Number(event.target.value))}><option value="">请选择 1–7</option>{[1, 2, 3, 4, 5, 6, 7].map(item => <option key={item} value={item}>{item}</option>)}</select></label>;
}

function ProgressiveArtifact({ artifact, onInteraction }: { artifact: Artifact; onInteraction: (type: string, payload: Record<string, unknown>) => void }) {
  const claims = artifact.claims ?? [];
  const conflicts = artifact.conflicts ?? [];
  const gaps = artifact.gaps ?? [];
  const sections = [
    { key: "support", title: "支持当前评估", body: claims.filter(item => item.support_status !== "contradicted").slice(0, 4).map(item => item.claim_text).filter(Boolean) },
    { key: "counter", title: "可能削弱当前评估", body: claims.filter(item => item.support_status === "contradicted").slice(0, 4).map(item => item.claim_text).filter(Boolean) },
    { key: "conflict", title: "其他合理解释", body: conflicts.map(item => item.description).filter(Boolean) },
    { key: "gap", title: "尚未解决的问题", body: gaps.map(item => item.missing_aspect || item.description).filter(Boolean) },
  ];
  return <div className="ai-material"><h3>系统当前证据评估</h3><p className="answer">{artifact.answer}</p><h3>核心理由</h3><ul>{claims.slice(0, 3).map((item, index) => <li key={index}>{item.claim_text}</li>)}</ul>{sections.map(section => <details key={section.key} onToggle={event => { if ((event.target as HTMLDetailsElement).open) onInteraction("audit_open", { section: section.key }); }}><summary>{section.title}</summary>{section.body.length ? <ul>{section.body.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>当前没有可展开的补充内容。</p>}</details>)}{artifact.audit_panel && <details onToggle={event => { if ((event.target as HTMLDetailsElement).open) onInteraction("audit_open", { section: "coverage" }); }}><summary>检索覆盖提示</summary><p>该提示用于说明材料覆盖情况，不代表法律正确性或公平性结论。</p></details>}</div>;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [bundle, setBundle] = useState<ArtifactBundle | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [answer, setAnswer] = useState<Response | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [rationale, setRationale] = useState("");
  const [explicitCounterEffect, setExplicitCounterEffect] = useState("");
  const [understandability, setUnderstandability] = useState<number | null>(null);
  const [trust, setTrust] = useState<number | null>(null);
  const [informationAmount, setInformationAmount] = useState<number | null>(null);
  const [selfAuthored, setSelfAuthored] = useState<number | null>(null);
  const [recognition, setRecognition] = useState("");
  const [openedEvidence, setOpenedEvidence] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [retryAction, setRetryAction] = useState<(() => Promise<unknown>) | null>(null);
  const autoKey = useRef("");

  const refresh = async (activeToken = token) => { if (!activeToken) return; const result = await readSession(activeToken); setSession(result.session); };
  useEffect(() => { loadArtifactBundle().then(setBundle).catch(() => setError("冻结版研究材料加载失败。")); }, []);
  useEffect(() => { if (token) refresh().catch(reason => setError(participantError(reason))); }, [token]);

  const activeTrial: Trial | undefined = useMemo(() => session?.trials.find(trial => trial.status !== "locked"), [session]);
  const trialEvents = activeTrial && session ? eventsFor(session, activeTrial) : [];
  const caseData = activeTrial && bundle ? bundle.cases.find(item => item.case_id === activeTrial.case_id) : undefined;
  const challenge: Challenge | undefined = activeTrial && bundle ? bundle.challenges[activeTrial.case_id] : undefined;
  const groupId = activeTrial && bundle ? firstGroupForCase(bundle, activeTrial.case_id) : null;
  const condition = activeTrial && session ? String(payloadOf(trialEvents, "condition_unlocked").condition ?? "") : "";
  const artifact = condition && groupId ? bundle?.conditions[condition]?.[groupId] : undefined;
  const stage: Stage = !activeTrial ? "complete" : !hasEvent(trialEvents, "session_open") ? "starting" : activeTrial.trial_order === 1 && !hasEvent(trialEvents, "consent_recorded") ? "consent" : !hasEvent(trialEvents, "vignette_shown") ? "vignette" : !hasEvent(trialEvents, "pre_ai_judgment_submitted") ? "pre" : !hasEvent(trialEvents, "condition_unlocked") ? "unlocking" : !hasEvent(trialEvents, "ai_artifact_shown") ? "ai" : !hasEvent(trialEvents, "ai_review_completed") ? "ai_review" : !hasEvent(trialEvents, "post_ai_judgment_submitted") ? "post" : !hasEvent(trialEvents, "challenge_opened") ? "challenge" : !hasEvent(trialEvents, "challenge_completed") ? "challenge_wait" : !hasEvent(trialEvents, "final_judgment_submitted") ? "final" : !hasEvent(trialEvents, "manipulation_check_submitted") ? "manipulation" : "locking";

  useEffect(() => { setAnswer(null); setConfidence(null); setRationale(""); setExplicitCounterEffect(""); setUnderstandability(null); setTrust(null); setInformationAmount(null); setSelfAuthored(null); setRecognition(""); setOpenedEvidence(new Set()); setSaveState("idle"); setError(""); }, [activeTrial?.trial_id, stage]);

  const save = async (action: () => Promise<unknown>) => { setBusy(true); setSaveState("saving"); setError(""); setRetryAction(() => action); try { await action(); await refresh(); setSaveState("saved"); setRetryAction(null); } catch (reason) { setSaveState("error"); setError(participantError(reason)); } finally { setBusy(false); } };
  const append = (eventType: string, payload: Record<string, unknown>) => { if (activeTrial) void save(() => appendEvent(token, activeTrial.trial_id, eventType, payload)); };
  const interaction = (type: string, payload: Record<string, unknown>) => { if (activeTrial) void appendInteraction(token, activeTrial.trial_id, type, payload).catch(() => setError("部分页面交互暂未保存，您仍可继续完成当前任务。")); };
  const basePayload = activeTrial && caseData ? { case_id: caseData.case_id, trial_order: activeTrial.trial_order } : {};

  useEffect(() => {
    if (!activeTrial || !caseData || !session || !bundle || busy) return;
    const key = `${activeTrial.trial_id}:${trialEvents.map(event => event.event_type).join(",")}`;
    if (autoKey.current === key) return;
    const advance = async () => {
      autoKey.current = key;
      let currentResult = await readSession(token);
      let current = currentResult.session ? eventsFor(currentResult.session, activeTrial) : [];
      if (!hasEvent(current, "session_open")) { await appendEvent(token, activeTrial.trial_id, "session_open", basePayload); currentResult = await readSession(token); current = currentResult.session ? eventsFor(currentResult.session, activeTrial) : []; }
      if (activeTrial.trial_order === 1 && !hasEvent(current, "consent_recorded")) return;
      if (!hasEvent(current, "vignette_shown")) { await appendEvent(token, activeTrial.trial_id, "vignette_shown", basePayload); currentResult = await readSession(token); current = currentResult.session ? eventsFor(currentResult.session, activeTrial) : []; }
      if (hasEvent(current, "pre_ai_judgment_submitted") && !hasEvent(current, "condition_unlocked")) { await unlockTrial(token, activeTrial.trial_id); currentResult = await readSession(token); current = currentResult.session ? eventsFor(currentResult.session, activeTrial) : []; }
      const unlockCondition = String(payloadOf(current, "condition_unlocked").condition ?? "");
      if (unlockCondition && !hasEvent(current, "ai_artifact_shown")) await appendEvent(token, activeTrial.trial_id, "ai_artifact_shown", { ...basePayload, condition: unlockCondition, artifact_id: `HG2-0002|${unlockCondition}|${activeTrial.case_id}` });
      if (hasEvent(current, "manipulation_check_submitted") && !hasEvent(current, "session_locked")) await appendEvent(token, activeTrial.trial_id, "session_locked", { ...basePayload, lock_reason: "participant_complete" });
      await refresh();
    };
    void advance().catch(reason => { autoKey.current = ""; setError(participantError(reason)); });
  }, [activeTrial?.trial_id, trialEvents.length, caseData?.case_id, bundle, busy, token]);

  useEffect(() => { if ((stage === "challenge" || stage === "challenge_wait") && challenge && openedEvidence.size === challenge.evidence.length && challenge.evidence.length > 0 && activeTrial && !hasEvent(trialEvents, "challenge_completed")) void save(() => appendEvent(token, activeTrial.trial_id, "challenge_completed", { ...basePayload, opened_count: openedEvidence.size })); }, [stage, openedEvidence.size, challenge?.challenge_id]);

  const start = async () => { setBusy(true); setError(""); try { const participant: ParticipantInfo = { participant_name: participantName.trim(), age: Number(age), gender }; const auth = await signInAnonymously(); localStorage.setItem(TOKEN_KEY, auth.access_token); setToken(auth.access_token); await createSession(auth.access_token, participant); setSession((await readSession(auth.access_token)).session); } catch (reason) { setError(participantError(reason)); } finally { setBusy(false); } };
  const validForm = participantName.trim().length > 0 && Number.isInteger(Number(age)) && Number(age) >= 18 && Number(age) <= 120 && Boolean(gender) && agreed;
  const validConfidence = confidence !== null;
  const validAnswer = answer !== null && validConfidence;
  const saveStatus = saveState === "saving" ? "正在保存……" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "";

  if (!remoteConfigured()) return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 暂不可用</span><h1>研究系统尚未配置</h1><p>当前页面缺少研究服务配置，暂时无法开始。</p></header></main>;
  if (!token || !session) return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 司法辅助决策研究</span><h1>欢迎参加本研究</h1><p className="subtle">本研究通过模拟司法辅助决策情境，了解不同 AI 信息呈现方式下的人机协同过程。</p></header><section className="card"><h2>研究说明</h2><p>请先阅读案件材料并独立判断，随后阅读系统提供的 AI 辅助信息，再完成后续判断和材料呈现检验。AI 信息仅供参考，不代表标准答案。</p><p>系统会记录判断、置信度以及必要的页面交互，用于分析信息呈现方式。</p><h2>开始前请填写</h2><label>姓名<input value={participantName} onChange={event => setParticipantName(event.target.value)} autoComplete="name" maxLength={100} /></label><label>年龄（周岁）<input type="number" min="18" max="120" value={age} onChange={event => setAge(event.target.value)} /></label><label>性别<select value={gender} onChange={event => setGender(event.target.value)}><option value="">请选择</option><option value="男">男</option><option value="女">女</option><option value="其他">其他</option><option value="不便透露">不便透露</option></select></label><label className="consent-check"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />我已阅读研究说明并同意参加</label><button disabled={busy || !validForm} onClick={() => void start()}>{busy ? "正在建立会话……" : "开始研究"}</button>{error && <p className="error">{error}</p>}</section><footer>参与信息仅用于本研究记录；你可以在开始前退出。</footer></main>;
  if (stage === "complete") return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 司法辅助决策研究</span><h1>研究已完成</h1></header><section className="card"><p>感谢您完成三个案件的判断任务。</p></section></main>;

  const currentOptions = caseData?.response_options ?? [];
  const caseProgress = <nav className="case-progress" aria-label="案件进度">{[1, 2, 3].map(order => <span key={order} className={order < (activeTrial?.trial_order ?? 1) ? "done" : order === activeTrial?.trial_order ? "active" : ""}>{caseLabel(order)}</span>)}</nav>;
  const pageHeader = <><header><span className="eyebrow">HUMAN GATE V2 · 司法辅助决策研究</span><h1>{caseLabel(activeTrial?.trial_order ?? 1)}</h1><p className="subtle">当前阶段：{stageLabel(stage)}</p></header>{caseProgress}{saveStatus && <div className={`save-status ${saveState}`}>{saveStatus}</div>}{error && <section className="notice error">{error}{retryAction && <button className="secondary" onClick={() => void save(retryAction)}>重新尝试</button>}</section>}</>;
  const caseFacts = caseData && <section className="case-facts"><h2>{caseData.display_name}</h2><p>{caseData.facts}</p>{caseData.issues.map(issue => <div className="issue" key={issue.issue_id}><p>{issue.issue_text}</p></div>)}</section>;
  const consentPage = <><h2>参加确认</h2><p>请确认你已阅读研究说明并愿意继续。确认后，系统将记录一次同意事件。</p><button disabled={busy} onClick={() => append("consent_recorded", { ...basePayload, consent: true })}>确认并继续</button></>;
  const challengePage = <><h2>证据质询</h2><p>{challenge?.challenge_text ?? "请再查看一项可能影响你当前判断的重要材料。"}</p>{challenge?.evidence.map((item, index) => <details key={index} onToggle={event => { if ((event.target as HTMLDetailsElement).open) { setOpenedEvidence(previous => new Set(previous).add(index)); interaction("source_open", { evidence_index: index }); } }}><summary>查看材料 {index + 1}</summary><p>{item.text}</p></details>)}{stage === "challenge_wait" && <p className="subtle">请展开并阅读全部材料后继续。</p>}</>;
  return <main className="shell">{pageHeader}<section className="card">{stage === "starting" || stage === "unlocking" || stage === "locking" ? <p>正在保存当前进度……</p> : stage === "consent" ? consentPage : stage === "vignette" ? <>{caseFacts}<button disabled={busy} onClick={() => append("vignette_shown", basePayload)}>进入独立判断</button></> : stage === "pre" ? <>{caseFacts}<h2>独立判断</h2><ResponseOptions options={currentOptions} value={answer} onChange={setAnswer} /><ConfidenceControl value={confidence} onChange={setConfidence} /><label>你可以简要说明作出选择时考虑的理由（可选）<textarea value={rationale} onChange={event => setRationale(event.target.value)} rows={4} /></label><button disabled={busy || !validAnswer} onClick={() => append("pre_ai_judgment_submitted", { ...basePayload, response_option_id: answer, confidence, rationale })}>提交独立判断</button></> : stage === "ai" ? <>{caseFacts}<h2>AI 辅助材料</h2>{artifact ? <ProgressiveArtifact artifact={artifact} onInteraction={interaction} /> : <p>材料正在加载……</p>}<button disabled={busy || !artifact} onClick={() => append("ai_review_completed", { ...basePayload, review_completed: true })}>完成 AI 阅读</button></> : stage === "ai_review" ? <><h2>AI 辅助材料</h2>{artifact ? <ProgressiveArtifact artifact={artifact} onInteraction={interaction} /> : <p>材料正在加载……</p>}<button disabled={busy || !artifact} onClick={() => append("ai_review_completed", { ...basePayload, review_completed: true })}>完成 AI 阅读</button></> : stage === "post" ? <><h2>AI 后判断</h2><p>请使用与刚才相同的判断选项，重新评估案件。</p><ResponseOptions options={currentOptions} value={answer} onChange={setAnswer} /><ConfidenceControl value={confidence} onChange={setConfidence} /><label>你可以简要说明现在作出选择时考虑的理由（可选）<textarea value={rationale} onChange={event => setRationale(event.target.value)} rows={4} /></label><button disabled={busy || !validAnswer} onClick={() => append("post_ai_judgment_submitted", { ...basePayload, response_option_id: answer, confidence, rationale })}>提交 AI 后判断</button></> : stage === "challenge" ? <><p>准备查看质询材料。点击后才会记录材料已开放。</p><button disabled={busy || !challenge} onClick={() => append("challenge_opened", { ...basePayload, challenge_id: challenge?.challenge_id })}>查看质询材料</button></> : stage === "challenge_wait" ? challengePage : stage === "final" ? <><h2>最终判断</h2><p>请结合案件事实、AI 辅助材料和质询材料作出最终判断。</p><ResponseOptions options={currentOptions} value={answer} onChange={setAnswer} /><ConfidenceControl value={confidence} onChange={setConfidence} /><label>你可以简要说明最终判断的理由（可选）<textarea value={rationale} onChange={event => setRationale(event.target.value)} rows={4} /></label><label>刚才的质询材料对你的判断产生了什么影响？<select value={explicitCounterEffect} onChange={event => setExplicitCounterEffect(event.target.value)}><option value="">请选择</option><option value="明显改变">明显改变</option><option value="部分改变">部分改变</option><option value="没有改变">没有改变</option><option value="无法判断">无法判断</option></select></label><button disabled={busy || !validAnswer || !explicitCounterEffect} onClick={() => append("final_judgment_submitted", { ...basePayload, response_option_id: answer, confidence, rationale, explicit_counter_effect: explicitCounterEffect })}>提交最终判断</button></> : stage === "manipulation" ? <><h2>材料呈现检验</h2><p>请评价刚才的 AI 辅助信息和判断过程。</p><ScaleQuestion title="刚才的 AI 辅助信息是否容易理解？" value={understandability} onChange={setUnderstandability} /><ScaleQuestion title="你认为刚才的 AI 辅助信息有多可信？" value={trust} onChange={setTrust} /><ScaleQuestion title="你觉得刚才展示的信息量是否过大？" value={informationAmount} onChange={setInformationAmount} /><ScaleQuestion title="你是否感觉最终判断主要是由自己作出的？" value={selfAuthored} onChange={setSelfAuthored} /><label>你以前是否见过或听说过这个案件？<select value={recognition} onChange={event => setRecognition(event.target.value)}><option value="">请选择</option><option value="明确认得">明确认得</option><option value="好像见过">好像见过</option><option value="没见过">没见过</option></select></label><button disabled={busy || [understandability, trust, informationAmount, selfAuthored].some(item => item === null) || !recognition} onClick={() => append("manipulation_check_submitted", { ...basePayload, understandability, trust, information_amount: informationAmount, self_authored: selfAuthored, recognition })}>提交检验结果</button></> : <p>正在恢复案件进度……</p>}</section></main>;
}
