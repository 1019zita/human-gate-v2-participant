import { useEffect, useMemo, useState } from "react";
import { firstGroupForCase, loadArtifactBundle, type ArtifactBundle } from "./artifacts";
import { appendEvent, createSession, readSession, remoteConfigured, signInAnonymously, unlockTrial, type ParticipantInfo, type RemoteEvent, type RemoteSession, type Trial } from "./remote";
import type { Response } from "./state";
import "./styles.css";

const EVENT_ORDER = [
  "session_open", "consent_recorded", "vignette_shown", "pre_ai_judgment_submitted", "condition_unlocked", "ai_artifact_shown",
  "post_ai_judgment_submitted", "challenge_opened", "challenge_completed", "final_judgment_submitted", "manipulation_check_submitted", "session_locked",
];
const EVENT_LABELS: Record<string, string> = {
  session_open: "打开试次", consent_recorded: "记录同意", vignette_shown: "展示案情", pre_ai_judgment_submitted: "提交前置判断",
  condition_unlocked: "解锁条件", ai_artifact_shown: "展示 AI 材料", post_ai_judgment_submitted: "提交 AI 后判断",
  challenge_opened: "打开质询", challenge_completed: "完成质询", final_judgment_submitted: "提交最终判断",
  manipulation_check_submitted: "提交材料呈现检验", session_locked: "锁定试次",
};
const RESPONSE_LABELS: Record<Response, string> = { accept: "支持", reject: "不支持", undetermined: "无法确定" };
const responseOptions: Response[] = ["accept", "reject", "undetermined"];
const TOKEN_KEY = "hg2_participant_access_token_v1";

function eventFor(events: RemoteEvent[], trialId: string) { return events.filter(event => event.trial_id === trialId).sort((a, b) => a.server_seq - b.server_seq); }
function payloadOf(event?: RemoteEvent) { return event?.payload_json ?? {}; }
function conditionOf(events: RemoteEvent[]): string | null { return (payloadOf(events.find(event => event.event_type === "condition_unlocked")).condition as string | undefined) ?? null; }
function participantError(reason: unknown): string { return reason instanceof Error && reason.message ? `系统提示：${reason.message}` : "系统暂时无法连接，请稍后重试。"; }

function ResponseRow({ id, text, value, onChange }: { id: string; text: string; value: Response | undefined; onChange: (value: Response) => void }) {
  return <fieldset className="response-row"><legend>{id}</legend><p>{text}</p><div className="choices">{responseOptions.map(option => <label key={option}><input type="radio" name={id} checked={value === option} onChange={() => onChange(option)} />{RESPONSE_LABELS[option]}</label>)}</div></fieldset>;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [bundle, setBundle] = useState<ArtifactBundle | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [response, setResponse] = useState<Response | undefined>();
  const [confidence, setConfidence] = useState(0.5);
  const [manipulation, setManipulation] = useState("undetermined");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async (activeToken = token) => { if (!activeToken) return; const result = await readSession(activeToken); setSession(result.session); };
  useEffect(() => { loadArtifactBundle().then(setBundle).catch(() => setError("冻结版研究材料加载失败。")); }, []);
  useEffect(() => { if (token) refresh().catch(reason => setError(participantError(reason))); }, [token]);

  const activeTrial: Trial | undefined = useMemo(() => session?.trials.find(trial => trial.status !== "locked"), [session]);
  const events = activeTrial && session ? eventFor(session.events, activeTrial.trial_id) : [];
  const nextEvent = activeTrial ? EVENT_ORDER[events.length] : null;
  const condition = conditionOf(events);
  const caseData = activeTrial && bundle ? bundle.cases.find(item => item.case_id === activeTrial.case_id) : undefined;
  const groupId = activeTrial && bundle ? firstGroupForCase(bundle, activeTrial.case_id) : null;
  const artifact = condition && groupId ? bundle?.conditions[condition]?.[groupId] : undefined;
  const challenge = groupId ? bundle?.challenges[groupId] : undefined;
  const hypothesis = caseData?.hypotheses[0];
  const trialLabel = activeTrial ? `第 ${activeTrial.trial_order}/3 次 · ${activeTrial.case_id}` : "本次会话已完成";

  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); await refresh(); } catch (reason) { setError(participantError(reason)); } finally { setBusy(false); } };
  const send = (eventType: string, payload: Record<string, unknown>) => activeTrial && run(() => appendEvent(token, activeTrial.trial_id, eventType, payload));
  const advance = () => {
    if (!activeTrial || !session || !caseData || !hypothesis) return;
    const base = { case_id: caseData.case_id, issue_id: caseData.issues[0]?.issue_id, hypothesis_id: hypothesis.hypothesis_id, trial_order: activeTrial.trial_order, sequence_id: session.sequence_id };
    if (nextEvent === "session_open") return send(nextEvent, base);
    if (nextEvent === "consent_recorded") return send(nextEvent, { ...base, consent: true });
    if (nextEvent === "vignette_shown") return send(nextEvent, { ...base, vignette_id: `${caseData.case_id}-v1` });
    if (nextEvent === "pre_ai_judgment_submitted") return send(nextEvent, { ...base, responses: { [hypothesis.hypothesis_id]: response }, confidence0: confidence });
    if (nextEvent === "condition_unlocked") return run(async () => { await unlockTrial(token, activeTrial.trial_id); await refresh(); });
    if (nextEvent === "ai_artifact_shown") return send(nextEvent, { ...base, condition, artifact_id: `HG2-0001|${condition}|${groupId}` });
    if (nextEvent === "post_ai_judgment_submitted") return send(nextEvent, { ...base, responses: { [hypothesis.hypothesis_id]: response }, confidence1: confidence });
    if (nextEvent === "challenge_opened") return send(nextEvent, { ...base, challenge_id: challenge?.challenge_id });
    if (nextEvent === "challenge_completed") return send(nextEvent, { ...base, challenge_id: challenge?.challenge_id, opened_source_ids: challenge?.evidence.map(item => item.chunk_id) ?? [] });
    if (nextEvent === "final_judgment_submitted") return send(nextEvent, { ...base, responses: { [hypothesis.hypothesis_id]: response }, confidence2: confidence });
    if (nextEvent === "manipulation_check_submitted") return send(nextEvent, { ...base, manipulation_check: manipulation });
    if (nextEvent === "session_locked") return send(nextEvent, { ...base, lock_reason: "participant_complete" });
  };

  const start = async () => {
    setBusy(true); setError("");
    try {
      const participant: ParticipantInfo = { participant_name: participantName.trim(), age: Number(age), gender };
      const auth = await signInAnonymously();
      localStorage.setItem(TOKEN_KEY, auth.access_token); setToken(auth.access_token);
      await createSession(auth.access_token, participant);
      const result = await readSession(auth.access_token); setSession(result.session);
    } catch (reason) { setError(participantError(reason)); } finally { setBusy(false); }
  };
  const recover = () => run(() => refresh());
  const validForm = participantName.trim().length > 0 && Number.isInteger(Number(age)) && Number(age) >= 18 && Number(age) <= 120 && Boolean(gender) && agreed;

  if (!remoteConfigured()) return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 暂不可用</span><h1>研究系统尚未配置</h1><p>当前页面缺少研究服务配置，暂时无法开始。</p></header></main>;

  if (!token || !session) return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 司法辅助决策研究</span><h1>欢迎参加本研究</h1><p className="subtle">本研究通过模拟司法辅助决策情境，了解不同 AI 信息呈现方式下的人机协同过程。</p></header><section className="card"><h2>研究说明</h2><p>本研究将模拟一个司法辅助决策情境。实验过程中，您将首先根据案件材料独立作出判断；随后，系统会提供 AI 辅助信息，包括相关法律材料、证据摘要或系统分析结果，供您参考。</p><p>AI 提供的信息仅作为辅助依据，并不代表标准答案，也可能存在不完整或不准确之处。请根据您对案件事实和所呈现材料的综合理解作出判断。</p><p>您需要阅读每个案件的材料，先独立作出判断，再阅读系统提供的 AI 辅助信息，并根据综合理解完成后续判断、证据质询和材料呈现检验。</p><p>实验过程中，我们会记录您的判断、置信度以及部分页面交互行为，用于分析不同信息呈现方式下的人机协同过程。</p><h2>开始前请填写</h2><label>姓名<input value={participantName} onChange={event => setParticipantName(event.target.value)} autoComplete="name" maxLength={100} /></label><label>年龄（周岁）<input type="number" min="18" max="120" value={age} onChange={event => setAge(event.target.value)} /></label><label>性别<select value={gender} onChange={event => setGender(event.target.value)}><option value="">请选择</option><option value="男">男</option><option value="女">女</option><option value="其他">其他</option><option value="不便透露">不便透露</option></select></label><label className="consent-check"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />我已阅读并理解上述研究说明，同意参加本研究。</label><button disabled={busy || !validForm} onClick={start}>{busy ? "正在进入研究" : "开始研究"}</button>{error && <p className="error">{error}</p>}</section><footer>您的信息将用于本研究的数据分析，并按研究方案保存。</footer></main>;

  return <main className="shell"><header><span className="eyebrow">HUMAN GATE V2 · 司法辅助决策研究</span><h1>证据辅助法律审查</h1><p className="subtle">{trialLabel} · 服务端序列 {session.sequence_id}</p></header><div className="progress">{EVENT_ORDER.map(event => <span key={event} className={event === nextEvent ? "active" : events.some(item => item.event_type === event) ? "done" : ""}>{EVENT_LABELS[event]}</span>)}</div>{error && <section className="notice error">{error}</section>}
    {activeTrial && <section className="card"><h2>{trialLabel}</h2>{nextEvent === "session_open" && <><p>服务端已创建本次试次；点击开始后记录事件。</p><button disabled={busy} onClick={advance}>开始本次试次</button></>}{nextEvent === "consent_recorded" && <><h3>知情同意</h3><p>请确认您已阅读研究说明，并根据案件材料独立作出判断。</p><button disabled={busy} onClick={advance}>记录知情同意</button></>}{nextEvent === "vignette_shown" && caseData && <><h2>{caseData.display_name}</h2><p>{caseData.facts}</p>{caseData.issues.map(issue => <div className="issue" key={issue.issue_id}><b>{issue.issue_id}</b><p>{issue.issue_text}</p></div>)}<button disabled={busy} onClick={advance}>确认已阅读案情</button></>}{nextEvent === "pre_ai_judgment_submitted" && hypothesis && <><h2>H0 · 独立前置判断</h2><p>此时尚未返回条件或 AI 材料。</p><ResponseRow id={hypothesis.hypothesis_id} text={hypothesis.text} value={response} onChange={setResponse} /><label className="range">置信度：{confidence.toFixed(2)}<input type="range" min="0" max="1" step="0.01" value={confidence} onChange={event => setConfidence(Number(event.target.value))} /></label><button disabled={busy || !response} onClick={advance}>提交 H0 判断</button></>}{nextEvent === "condition_unlocked" && <><h2>解锁 AI 材料</h2><p>服务端将返回条件；浏览器不会提交或选择条件。</p><button disabled={busy} onClick={advance}>解锁 AI 材料</button></>}{nextEvent === "ai_artifact_shown" && artifact && <><div className="condition-badge">服务端条件：{condition}</div><h2>AI 材料</h2><p>{artifact.presentation_note}</p><p className="answer">{artifact.answer}</p><button disabled={busy} onClick={advance}>记录材料并继续 H1</button></>}{nextEvent === "post_ai_judgment_submitted" && hypothesis && <><h2>H1 · 阅读 AI 材料后的判断</h2><ResponseRow id={hypothesis.hypothesis_id} text={hypothesis.text} value={response} onChange={setResponse} /><button disabled={busy || !response} onClick={advance}>提交 H1 判断</button></>}{nextEvent === "challenge_opened" && challenge && <><h2>证据质询</h2><p>{challenge.challenge_text}</p>{challenge.evidence.map(item => <article className="evidence" key={item.alias}><b>{item.alias}</b><p>{item.text}</p><small>{item.chunk_id}</small></article>)}<button disabled={busy} onClick={advance}>记录已打开质询</button></>}{nextEvent === "challenge_completed" && <><h2>质询材料已打开</h2><p>完成证据质询后才能提交 H2 判断。</p><button disabled={busy} onClick={advance}>完成证据质询</button></>}{nextEvent === "final_judgment_submitted" && hypothesis && <><h2>H2 · 质询后的判断</h2><ResponseRow id={hypothesis.hypothesis_id} text={hypothesis.text} value={response} onChange={setResponse} /><button disabled={busy || !response} onClick={advance}>提交 H2 判断</button></>}{nextEvent === "manipulation_check_submitted" && <><h2>材料呈现检验</h2><select value={manipulation} onChange={event => setManipulation(event.target.value)}><option value="undetermined">请选择</option><option value="yes">是</option><option value="no">否</option></select><button disabled={busy || manipulation === "undetermined"} onClick={advance}>提交检验结果</button></>}{nextEvent === "session_locked" && <><h2>本次试次即将完成</h2><button disabled={busy} onClick={advance}>锁定本次试次</button></>}{events.length === EVENT_ORDER.length && <p>本次试次已完成；刷新后将恢复下一次试次。</p>}</section>}
    {!activeTrial && <section className="card"><h2>三次试次已完成</h2><p>会话编号：{session.session_id}</p><p>完整事件已从研究服务器恢复。</p></section>}
    <section className="card"><h2>事件记录</h2><table><thead><tr><th>试次</th><th>序号</th><th>事件</th><th>材料编号</th><th>质询编号</th></tr></thead><tbody>{session.events.map(event => <tr key={event.event_id}><td>{event.trial_id.slice(0, 8)}</td><td>{event.server_seq}</td><td>{EVENT_LABELS[event.event_type] ?? event.event_type}</td><td>{event.artifact_id ?? "—"}</td><td>{event.challenge_id ?? "—"}</td></tr>)}</tbody></table><button className="secondary" disabled={busy} onClick={recover}>刷新并恢复会话</button></section><footer>研究过程记录仅用于本研究分析。</footer></main>;
}
