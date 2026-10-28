import { useEffect, useMemo, useRef, useState } from "react";
import { loadArtifactBundle, type ArtifactBundle } from "./artifacts";
import { appendEvent, appendInteraction, appendSessionManipulation as appendPostStudyManipulation, createSession, finalizeSession, readSession, remoteConfigured, signInAnonymously, type ParticipantInfo, type RemoteEvent, type RemoteSession, type Trial, unlockTrial } from "./remote";
import type { Artifact, CaseResponseOption, Response } from "./state";
import "./styles.css";

const TOKEN_KEY = "hg2_participant_access_token_v1";
const SESSION_MARKER = "hg2_active_session_v2";
const TRIAL_ORDERS = [1, 2, 3] as const;
const EVENT_LABELS: Record<string, string> = {
  session_open: "进入案件",
  consent_recorded: "知情同意",
  vignette_shown: "阅读案情",
  pre_ai_judgment_submitted: "独立判断",
  condition_unlocked: "准备证据核查",
  ai_artifact_shown: "AI 证据核查",
  ai_review_completed: "完成证据核查",
  post_ai_judgment_submitted: "AI 后判断",
  session_locked: "案件完成",
};
type Stage = "starting" | "consent" | "pre" | "unlocking" | "ai" | "ai_review" | "post" | "locking" | "post_study_check" | "complete";
type SaveState = "idle" | "saving" | "saved" | "error";
type StudyRating = { understandability: number | null; informationAmount: number | null; trust: number | null };
type StudyRatingKey = keyof StudyRating;

function emptyStudyRatings(): Record<number, StudyRating> {
  return { 1: { understandability: null, informationAmount: null, trust: null }, 2: { understandability: null, informationAmount: null, trust: null }, 3: { understandability: null, informationAmount: null, trust: null } };
}
function eventsFor(session: RemoteSession, trial: Trial) { return session.events.filter(event => event.trial_id === trial.trial_id).sort((a, b) => a.server_seq - b.server_seq); }
function hasEvent(events: RemoteEvent[], type: string) { return events.some(event => event.event_type === type); }
function payloadOf(events: RemoteEvent[], type: string) { return events.find(event => event.event_type === type)?.payload_json ?? {}; }
function participantError(reason: unknown) { return reason instanceof Error && reason.message ? `系统提示：${reason.message}` : "系统暂时无法连接，请稍后重试。"; }
function caseLabel(order: number) { return `任务${["一", "二", "三"][order - 1] ?? order}`; }
function stageLabel(stage: Stage) { return stage === "pre" ? "独立判断" : stage === "post" ? "AI 后判断" : stage === "ai" || stage === "ai_review" ? "AI 证据核查" : stage === "post_study_check" ? "研究结束评价" : stage === "locking" ? "保存任务" : stage === "consent" ? "参加确认" : ""; }
function shortText(value: string | undefined) { return (value ?? "").replace(/\[[Ee]\d+(?:-[^\]]+)?\]/g, "").replace(/\s+/g, " ").trim(); }

function SevenPointControl({ title, low, high, value, onChange, ariaLabel }: { title: string; low: string; high: string; value: number | null; onChange: (value: number) => void; ariaLabel: string }) {
  return <div className={`scale-control ${value === null ? "unselected" : ""}`}><p><strong>{title}</strong></p><p className="subtle">请在 1–7 中选择一个数字。1 表示“{low}”，7 表示“{high}”。数字越大，表示程度越高。</p><div className="scale-line"><span>{low}</span><input aria-label={ariaLabel} type="range" min="1" max="7" step="1" value={value ?? 1} onPointerDown={() => { if (value === null) onChange(1); }} onChange={event => onChange(Number(event.target.value))} /><span>{high}</span></div><div className="scale-numbers"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span></div><div className="scale-value">{value === null ? "尚未选择" : value}</div></div>;
}

function ConfidenceControl({ value, onChange }: { value: number | null; onChange: (value: number) => void }) {
  return <SevenPointControl title="你对自己刚才这个选择有多确定？" low="非常不确定" high="非常确定" value={value} onChange={onChange} ariaLabel="确定程度 1 到 7" />;
}

function ResponseOptions({ options, value, onChange }: { options: CaseResponseOption[]; value: Response | null; onChange: (value: Response) => void }) {
  return <fieldset className="response-row"><legend>根据上述案件事实，你目前更倾向于哪一种理解？</legend><div className="case-options">{options.map(option => <label className={`case-option ${value === option.option_id ? "selected" : ""}`} key={option.option_id}><input type="radio" name="case-response" checked={value === option.option_id} onChange={() => onChange(option.option_id)} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></fieldset>;
}

function EvidenceCards({ title, entries, onOpen }: { title: string; entries: Array<{ source_title?: string; source_type?: string; source_origin?: string; key_sentence?: string; paragraphs?: string[] }>; onOpen: () => void }) {
  if (!entries.length) return null;
  return <details className="evidence-section" onToggle={event => { if ((event.target as HTMLDetailsElement).open) onOpen(); }}><summary>{title}（{entries.length}）</summary><div className="evidence-cards">{entries.map((entry, index) => <article className="evidence-card" key={index}><div className="evidence-header"><strong>{shortText(entry.source_title) || "来源材料"}</strong><small>{shortText(entry.source_type)}{entry.source_origin ? ` · ${shortText(entry.source_origin)}` : ""}</small></div>{entry.key_sentence && <p className="key-sentence">“{shortText(entry.key_sentence)}”</p>}<details className="source-fulltext"><summary>查看来源原文</summary><div className="fulltext-paragraphs">{(entry.paragraphs ?? []).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{shortText(paragraph)}</p>)}</div></details></article>)}</div></details>;
}

function ProgressiveArtifact({ artifact, onInteraction }: { artifact: Artifact; onInteraction: (type: string, payload: Record<string, unknown>) => void }) {
  const support = artifact.supporting_material ?? [];
  const counter = artifact.counter_weakening_material ?? [];
  const alternative = artifact.alternative_explanation ?? [];
  const uncertainty = artifact.uncertainty_statements ?? [];
  const coreReasons = artifact.core_reasons ?? [];
  const hasStructuredEvidence = support.length > 0 || counter.length > 0 || alternative.length > 0;

  if (!hasStructuredEvidence) {
    return <div className="ai-material"><p className="ai-review-explanation">基于你刚才的判断，AI 对案件材料进行了进一步分析。以下为 AI 根据现有材料形成的综合评估，供你重新判断。</p><section className="assessment"><h3>AI 综合评估</h3><p className="answer">{shortText(artifact.ai_summary)}</p></section></div>;
  }

  return <div className="ai-material"><p className="ai-review-explanation">基于你刚才的判断，AI 对相关证据进行了进一步核查。下面同时展示可能支持该判断、可能削弱该判断以及其他合理解释的材料，供你重新评估。</p>{support.length > 0 && <EvidenceCards title="支持当前判断的依据" entries={support} onOpen={() => onInteraction("audit_open", { section: "support" })} />}{counter.length > 0 && <EvidenceCards title="可能削弱当前判断的依据" entries={counter} onOpen={() => onInteraction("counter_expand", { section: "counter" })} />}{alternative.length > 0 && <EvidenceCards title="其他合理解释" entries={alternative} onOpen={() => onInteraction("audit_open", { section: "alternative" })} />}{uncertainty.length > 0 && <section className="uncertainty-section"><h3>仍需进一步核实的信息</h3><ul>{uncertainty.map((text, index) => <li key={index}>{shortText(text)}</li>)}</ul></section>}{artifact.audit_panel?.coverage && <section className="coverage-panel"><h3>本次材料检索覆盖说明</h3><p>{artifact.audit_panel.coverage.coverage_note}</p></section>}{coreReasons.length > 0 && <section className="review-points"><h3>核查要点</h3><ul className="core-reasons">{coreReasons.slice(0, 3).map((text, index) => <li key={index}>{shortText(text)}</li>)}</ul></section>}<section className="assessment"><h3>综合核查结果</h3><p className="subtle">这是基于上述证据核查形成的综合评估，供你重新判断。</p><p className="answer">{shortText(artifact.ai_summary)}</p></section></div>;
}

function CaseProgress({ session, activeTrial }: { session: RemoteSession; activeTrial?: Trial }) {
  return <nav className="case-progress" aria-label="任务进度"><ol>{TRIAL_ORDERS.map(order => { const trial = session.trials.find(item => item.trial_order === order); const completed = trial?.status === "locked"; const current = order === activeTrial?.trial_order; return <li key={order} className={completed ? "completed" : current ? "current" : "upcoming"}><span className="case-marker" aria-hidden="true">{completed ? "✓" : current ? "●" : "○"}</span><span>{caseLabel(order)}</span></li>; })}</ol></nav>;
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
  const [studyRatings, setStudyRatings] = useState<Record<number, StudyRating>>(emptyStudyRatings);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [retryAction, setRetryAction] = useState<(() => Promise<unknown>) | null>(null);
  const [hydrating, setHydrating] = useState(() => Boolean(localStorage.getItem(TOKEN_KEY)));
  const [legacyRecoveryAllowed, setLegacyRecoveryAllowed] = useState(() => !localStorage.getItem(SESSION_MARKER));
  const autoKey = useRef("");
  const progressionRun = useRef(0);
  const hydrationRun = useRef(0);

  const refresh = async (activeToken = token) => {
    if (!activeToken) return;
    const runId = ++hydrationRun.current;
    setHydrating(true);
    try {
      const result = await readSession(activeToken);
      if (runId === hydrationRun.current) setSession(result.session);
    } finally {
      if (runId === hydrationRun.current) setHydrating(false);
    }
  };
  useEffect(() => { loadArtifactBundle().then(setBundle).catch(() => setError("冻结版研究材料加载失败。")); }, []);
  useEffect(() => { if (token) refresh().catch(reason => setError(participantError(reason))); }, [token]);

  const resetSession = () => { progressionRun.current += 1; hydrationRun.current += 1; localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(SESSION_MARKER); setToken(""); setSession(null); setStudyRatings(emptyStudyRatings()); setLegacyRecoveryAllowed(true); setHydrating(false); };
  const sortedTrials = useMemo(() => [...(session?.trials ?? [])].sort((a, b) => a.trial_order - b.trial_order), [session?.trials]);
  const activeTrial: Trial | undefined = useMemo(() => session?.status === "locked" ? undefined : sortedTrials.find(trial => trial.status !== "locked"), [session?.status, sortedTrials]);
  const trialEvents = activeTrial && session ? eventsFor(session, activeTrial) : [];
  const caseData = activeTrial && bundle ? bundle.cases.find(item => item.case_id === activeTrial.case_id) : undefined;
  const conditionUnlockedPayload = payloadOf(trialEvents, "condition_unlocked");
  const condition = activeTrial && session ? String(conditionUnlockedPayload.condition ?? "") : "";
  const artifactKey = activeTrial && session ? String(conditionUnlockedPayload.artifact_key ?? "") : "";
  const legacyArtifactRecovery = legacyRecoveryAllowed && !artifactKey && hasEvent(trialEvents, "condition_unlocked");
  const artifactLookupKey = artifactKey || (legacyArtifactRecovery && activeTrial ? activeTrial.case_id : "");
  const artifact = condition && bundle && activeTrial && artifactLookupKey ? bundle.conditions[condition]?.[artifactLookupKey] : undefined;
  const artifactUnavailable = Boolean(bundle && hasEvent(trialEvents, "condition_unlocked") && (!condition || !artifact));
  const allTrialsLocked = Boolean(session && session.trials.length === 3 && session.trials.every(trial => trial.status === "locked"));
  const postStudyCheckSubmitted = Boolean(session && hasEvent(session.events, "post_study_manipulation_check_submitted"));
  const stage: Stage = !session ? "starting" : !activeTrial ? allTrialsLocked ? postStudyCheckSubmitted ? "complete" : "post_study_check" : "starting" : !hasEvent(trialEvents, "session_open") ? "starting" : activeTrial.trial_order === 1 && !hasEvent(trialEvents, "consent_recorded") ? "consent" : !hasEvent(trialEvents, "pre_ai_judgment_submitted") ? "pre" : !hasEvent(trialEvents, "condition_unlocked") ? "unlocking" : !hasEvent(trialEvents, "ai_artifact_shown") ? "ai" : !hasEvent(trialEvents, "ai_review_completed") ? "ai_review" : !hasEvent(trialEvents, "post_ai_judgment_submitted") ? "post" : "locking";

  useEffect(() => { setAnswer(null); setConfidence(null); setRationale(""); setSaveState("idle"); setError(""); }, [activeTrial?.trial_id, stage]);

  const save = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setSaveState("saving");
    setError("");
    setRetryAction(() => action);
    try {
      await action();
    } catch (reason) {
      setSaveState("error");
      setError(participantError(reason));
      setBusy(false);
      return;
    }
    try {
      await refresh();
      setSaveState("saved");
      setRetryAction(null);
    } catch (reason) {
      setSaveState("error");
      setError(participantError(reason));
      setRetryAction(() => () => refresh());
    } finally {
      setBusy(false);
    }
  };
  const append = (eventType: string, payload: Record<string, unknown>) => { if (activeTrial) void save(() => appendEvent(token, activeTrial.trial_id, eventType, payload)); };
  const interaction = (type: string, payload: Record<string, unknown>) => { if (activeTrial) void appendInteraction(token, activeTrial.trial_id, type, payload).catch(() => setError("部分页面交互暂未保存，您仍可继续完成当前任务。")); };
  const basePayload = activeTrial && caseData ? { case_id: caseData.case_id, trial_order: activeTrial.trial_order } : {};

  useEffect(() => {
    if (!activeTrial || !caseData || !session || !bundle || busy) return;
    const key = `${activeTrial.trial_id}:${trialEvents.map(event => event.event_type).join(",")}:${session.status}`;
    if (autoKey.current === key) return;
    const runId = ++progressionRun.current;
    const trialId = activeTrial.trial_id;
    const isCurrent = () => runId === progressionRun.current && activeTrial.trial_id === trialId;
    const currentTrial = (result: { session: RemoteSession | null }) => { const trial = result.session?.trials.find(item => item.trial_id === trialId); return trial ? { trial, events: result.session ? eventsFor(result.session, trial) : [] } : null; };
    const advance = async () => {
      autoKey.current = key;
      let currentResult = await readSession(token);
      let currentEntry = currentTrial(currentResult);
      if (!isCurrent() || !currentEntry) return;
      let current = currentEntry.events;
      const currentPayload = { case_id: caseData.case_id, trial_order: currentEntry.trial.trial_order };
      if (!hasEvent(current, "session_open")) {
        await appendEvent(token, trialId, "session_open", currentPayload);
        currentResult = await readSession(token); currentEntry = currentTrial(currentResult);
        if (!isCurrent() || !currentEntry) return; current = currentEntry.events;
      }
      if (currentEntry.trial.trial_order === 1 && !hasEvent(current, "consent_recorded")) return;
      if (!hasEvent(current, "vignette_shown")) {
        await appendEvent(token, trialId, "vignette_shown", currentPayload);
        currentResult = await readSession(token); currentEntry = currentTrial(currentResult);
        if (!isCurrent() || !currentEntry) return; current = currentEntry.events;
      }
      if (!hasEvent(current, "pre_ai_judgment_submitted")) return;
      if (!hasEvent(current, "condition_unlocked")) {
        await unlockTrial(token, trialId);
        currentResult = await readSession(token); currentEntry = currentTrial(currentResult);
        if (!isCurrent() || !currentEntry) return; current = currentEntry.events;
      }
      const currentUnlockedPayload = payloadOf(current, "condition_unlocked");
      const unlockCondition = String(currentUnlockedPayload.condition ?? "");
      const unlockArtifactKey = String(currentUnlockedPayload.artifact_key ?? "");
      const lookupKey = unlockArtifactKey || (legacyRecoveryAllowed ? currentEntry.trial.case_id : "");
      const resolvedArtifact = unlockCondition && lookupKey ? bundle.conditions[unlockCondition]?.[lookupKey] : undefined;
      if (hasEvent(current, "condition_unlocked") && (!unlockCondition || !resolvedArtifact)) throw new Error("当前案件的 AI 核查材料暂时无法恢复，请返回重试；本次不会记录为已展示。");
      if (unlockCondition && resolvedArtifact && !hasEvent(current, "ai_artifact_shown")) {
        await appendEvent(token, trialId, "ai_artifact_shown", { ...currentPayload, condition: unlockCondition, artifact_key: lookupKey, artifact_id: `${session.artifact_version}|${unlockCondition}|${lookupKey}` });
        currentResult = await readSession(token); currentEntry = currentTrial(currentResult);
        if (!isCurrent() || !currentEntry) return; current = currentEntry.events;
      }
      if (!hasEvent(current, "ai_review_completed")) return;
      if (!hasEvent(current, "post_ai_judgment_submitted")) return;
      if (!hasEvent(current, "session_locked")) {
        await appendEvent(token, trialId, "session_locked", { ...currentPayload, lock_reason: "participant_complete" });
        currentResult = await readSession(token); currentEntry = currentTrial(currentResult);
        if (!isCurrent() || !currentEntry) return;
      }
      if (isCurrent()) await refresh();
    };
    void advance().catch(reason => { autoKey.current = ""; setError(participantError(reason)); setRetryAction(() => () => refresh()); });
    return () => { if (progressionRun.current === runId) progressionRun.current += 1; };
  }, [activeTrial?.trial_id, trialEvents.length, caseData?.case_id, bundle, busy, token, session?.status, session?.artifact_version, legacyRecoveryAllowed]);

  useEffect(() => {
    if (!session || activeTrial || busy || !allTrialsLocked || !postStudyCheckSubmitted || session.status === "locked") return;
    const runId = ++progressionRun.current;
    const complete = async () => { await finalizeSession(token); if (runId === progressionRun.current) await refresh(); };
    void complete().catch(reason => { setError(participantError(reason)); setRetryAction(() => () => refresh()); });
    return () => { if (progressionRun.current === runId) progressionRun.current += 1; };
  }, [session?.session_id, session?.events.length, session?.status, activeTrial?.trial_id, busy, token, allTrialsLocked, postStudyCheckSubmitted]);

  const start = async () => { setBusy(true); setError(""); try { const participant: ParticipantInfo = { participant_name: participantName.trim(), age: Number(age), gender }; const auth = await signInAnonymously(); await createSession(auth.access_token, participant); localStorage.setItem(TOKEN_KEY, auth.access_token); localStorage.setItem(SESSION_MARKER, auth.access_token); setLegacyRecoveryAllowed(false); setStudyRatings(emptyStudyRatings()); setToken(auth.access_token); setSession((await readSession(auth.access_token)).session); } catch (reason) { setError(participantError(reason)); } finally { setBusy(false); } };
  const validForm = participantName.trim().length > 0 && Number.isInteger(Number(age)) && Number(age) >= 18 && Number(age) <= 120 && Boolean(gender) && agreed;
  const validAnswer = answer !== null && confidence !== null;
  const updateStudyRating = (order: number, key: StudyRatingKey, value: number) => setStudyRatings(previous => ({ ...previous, [order]: { ...previous[order], [key]: value } }));
  const validStudy = TRIAL_ORDERS.every(order => { const rating = studyRatings[order]; return rating.understandability !== null && rating.informationAmount !== null && rating.trust !== null; });
  const submitPostStudy = () => { const payload = Object.fromEntries(TRIAL_ORDERS.map(order => { const rating = studyRatings[order]; return [`task_${order}`, { trial_order: order, understandability: rating.understandability, information_amount: rating.informationAmount, trust: rating.trust }]; })); void save(() => appendPostStudyManipulation(token, payload)); };
  const saveStatus = saveState === "saving" ? "正在保存……" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "";

  if (!remoteConfigured()) return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 暂不可用</span><h1>研究系统尚未配置</h1><p>当前页面缺少研究服务配置，暂时无法开始。</p></header></main>;
  if (token && !session) return hydrating ? <main className="shell"><section className="card"><h2>正在恢复研究进度</h2><p>正在从研究服务恢复你上次保存的阶段，请不要关闭页面。</p></section></main> : <main className="shell"><section className="card"><h2>研究进度恢复失败</h2><p>当前无法恢复已保存的研究进度。请检查网络连接后重试；系统不会自动开始新会话。</p><button onClick={() => { setHydrating(true); refresh().catch(reason => setError(participantError(reason))); }}>重新尝试恢复</button>{error && <p className="notice error">{error}</p>}</section></main>;
  if (!token || !session) return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 司法辅助决策研究</span><h1>欢迎参加本研究</h1><p className="subtle">本研究通过模拟司法辅助决策情境，了解不同 AI 信息呈现方式下的人机协同过程。</p></header><section className="card"><h2>研究说明</h2><p>请先阅读案件事实并独立判断，随后阅读系统提供的 AI 辅助信息，再完成 AI 后判断和研究结束评价。AI 信息仅供参考，不代表标准答案。</p><p>系统会记录三个任务的判断、确定程度以及材料呈现评价，用于分析不同信息呈现方式下的人机协同过程。</p><h2>开始前请填写</h2><label>姓名<input value={participantName} onChange={event => setParticipantName(event.target.value)} autoComplete="name" maxLength={100} /></label><label>年龄（周岁）<input type="number" min="18" max="120" value={age} onChange={event => setAge(event.target.value)} /></label><label>性别<select value={gender} onChange={event => setGender(event.target.value)}><option value="">请选择</option><option value="男">男</option><option value="女">女</option><option value="其他">其他</option><option value="不便透露">不便透露</option></select></label><label className="consent-check"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />我已阅读研究说明并同意参加</label><button disabled={busy || !validForm} onClick={() => void start()}>{busy ? "正在建立会话……" : "开始研究"}</button>{error && <p className="error">{error}</p>}</section><footer>参与信息仅用于本研究记录；你可以在开始前退出。</footer></main>;
  if (stage === "complete") return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 司法辅助决策研究</span><h1>感谢参与</h1></header><section className="card"><p>您的回答已经成功保存。</p><button onClick={resetSession}>开始新的测试会话</button></section><footer>参与信息仅用于本研究记录。</footer></main>;
  if (stage === "post_study_check") return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 司法辅助决策研究</span><h1>研究结束评价</h1></header><CaseProgress session={session} />{saveStatus && <div className={`save-status ${saveState}`}>{saveStatus}</div>}{error && <section className="notice error">{error}{retryAction && <button className="secondary" onClick={() => void save(retryAction)}>重新尝试</button>}</section>}<section className="card"><h2>材料呈现评价</h2><p>请分别评价三个任务中刚才看到的 AI 辅助信息。这里不涉及案件答案判断。</p>{TRIAL_ORDERS.map(order => { const rating = studyRatings[order]; return <fieldset className="study-rating" key={order}><legend>{caseLabel(order)}</legend><SevenPointControl title="AI 信息是否容易理解？" low="非常难理解" high="非常容易理解" value={rating.understandability} onChange={value => updateStudyRating(order, "understandability", value)} ariaLabel={`${caseLabel(order)} AI 信息易理解程度 1 到 7`} /><SevenPointControl title="AI 信息量是否合适？" low="完全不合适" high="非常合适" value={rating.informationAmount} onChange={value => updateStudyRating(order, "informationAmount", value)} ariaLabel={`${caseLabel(order)} AI 信息量合适程度 1 到 7`} /><SevenPointControl title="你对该次 AI 辅助信息的信任程度？" low="完全不信任" high="非常信任" value={rating.trust} onChange={value => updateStudyRating(order, "trust", value)} ariaLabel={`${caseLabel(order)} AI 信息信任程度 1 到 7`} /></fieldset>; })}<button disabled={busy || !validStudy} onClick={submitPostStudy}>提交研究结束评价</button></section><footer><span>参与信息仅用于本研究记录。</span></footer></main>;

  const currentOptions = caseData?.response_options ?? [];
  const pageHeader = <><header><span className="eyebrow">HUMAN GATE V2 · 司法辅助决策研究</span><h1>{caseLabel(activeTrial?.trial_order ?? 1)}</h1><p className="subtle">当前阶段：{stageLabel(stage)}</p></header><CaseProgress session={session} activeTrial={activeTrial} />{saveStatus && <div className={`save-status ${saveState}`}>{saveStatus}</div>}{error && <section className="notice error">{error}{retryAction && <button className="secondary" onClick={() => void save(retryAction)}>重新尝试</button>}</section>}</>;
  const caseFacts = caseData && <section className="case-facts"><h2>{caseData.display_name}</h2><p>{caseData.facts}</p></section>;
  const consentPage = <><h2>参加确认</h2><p>请确认你已阅读研究说明并愿意继续。确认后，系统将记录一次同意事件。</p><button disabled={busy} onClick={() => append("consent_recorded", { ...basePayload, consent: true })}>确认并继续</button></>;
  const prePage = <>{caseFacts}<h2>独立判断</h2><p>请根据现有案件事实独立作出判断。案件事实与判断选项在同一页面展示。</p><ResponseOptions options={currentOptions} value={answer} onChange={setAnswer} /><ConfidenceControl value={confidence} onChange={setConfidence} /><label>你可以简要说明作出选择时考虑的理由（可选）<textarea value={rationale} onChange={event => setRationale(event.target.value)} rows={4} /></label><button disabled={busy || !validAnswer} onClick={() => append("pre_ai_judgment_submitted", { ...basePayload, response_option_id: answer, confidence, rationale })}>提交独立判断</button></>;
  const aiPage = <><h2>AI 证据核查</h2>{artifactUnavailable ? <p>当前案件的核查材料暂时无法恢复，本次不会记录为已展示。请刷新重试。</p> : artifact ? <ProgressiveArtifact artifact={artifact} onInteraction={interaction} /> : <p>材料正在加载……</p>}<button disabled={busy || !artifact} onClick={() => append("ai_review_completed", { ...basePayload, review_completed: true })}>完成 AI 信息阅读</button></>;
  const postPage = <><h2>AI 后判断</h2><p>请结合你最初的判断和刚才看到的 AI 信息，再次作出判断。</p><ResponseOptions options={currentOptions} value={answer} onChange={setAnswer} /><ConfidenceControl value={confidence} onChange={setConfidence} /><label>你可以简要说明现在作出选择时考虑的理由（可选）<textarea value={rationale} onChange={event => setRationale(event.target.value)} rows={4} /></label><button disabled={busy || !validAnswer} onClick={() => append("post_ai_judgment_submitted", { ...basePayload, response_option_id: answer, confidence, rationale })}>提交 AI 后判断</button></>;
  return <main className="shell">{pageHeader}<section className="card">{stage === "starting" || stage === "unlocking" || stage === "locking" ? <p>正在保存当前进度……</p> : stage === "consent" ? consentPage : stage === "pre" ? prePage : stage === "ai" || stage === "ai_review" ? aiPage : stage === "post" ? postPage : <p>正在恢复案件进度……</p>}</section><footer><span>参与信息仅用于本研究记录；你可以在开始前退出。</span>{token && <button className="secondary" style={{ marginLeft: "12px", fontSize: "12px", padding: "4px 8px" }} onClick={resetSession}>重新开始测试（清除本地会话）</button>}</footer></main>;
}
