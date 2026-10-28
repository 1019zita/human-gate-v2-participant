export type Trial = { trial_id: string; trial_order: number; case_id: string; status: "open" | "locked" | "incomplete" };
export type RemoteEvent = { event_id: string; session_id: string; trial_id: string; event_type: string; server_seq: number; server_timestamp: string; sequence_id?: string; payload_json: Record<string, unknown> };
export type RemoteInteraction = { interaction_id: string; session_id: string; trial_id: string; interaction_type: string; server_timestamp: string; payload_json: Record<string, unknown> };
export type RemoteSession = { session_id: string; protocol_version: string; artifact_version: string; status: string; trials: Trial[]; events: RemoteEvent[]; interactions: RemoteInteraction[] };
export type ParticipantInfo = { participant_name: string; age: number; gender: string };

type AuthConfig = { supabaseUrl: string; anonKey: string; functionUrl: string };
const config: AuthConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  functionUrl: import.meta.env.VITE_HG2_FUNCTION_URL ?? "",
};

export function remoteConfigured(): boolean { return Boolean(config.supabaseUrl && config.anonKey && config.functionUrl); }

export async function signInAnonymously(): Promise<{ access_token: string; user_id: string }> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/signup`, { method: "POST", headers: { apikey: config.anonKey, "content-type": "application/json" }, body: JSON.stringify({}) });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body.msg ?? body.error_description ?? "无法建立研究会话");
  return { access_token: body.access_token, user_id: body.user?.id ?? body.user_id };
}

async function call(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${config.functionUrl}${path}`, { ...init, headers: { apikey: config.anonKey, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `远程服务请求失败（${response.status}）`);
  return body;
}

export function createSession(token: string, participant: ParticipantInfo) { return call("/v1/session", token, { method: "POST", body: JSON.stringify(participant) }) as Promise<{ trials: Trial[]; condition_hidden: boolean }>; }
export function readSession(token: string) { return call("/v1/session", token) as Promise<{ session: RemoteSession | null; condition_hidden: boolean }>; }
export function appendEvent(token: string, trialId: string, eventType: string, payload: Record<string, unknown>) { return call(`/v1/trials/${encodeURIComponent(trialId)}/events`, token, { method: "POST", body: JSON.stringify({ event_type: eventType, payload }) }) as Promise<{ event: RemoteEvent; condition?: string | null }>; }
export function unlockTrial(token: string, trialId: string) { return call(`/v1/trials/${encodeURIComponent(trialId)}/unlock`, token, { method: "POST", body: "{}" }) as Promise<{ event: RemoteEvent; condition: string; artifact_key?: string }>; }
export function appendInteraction(token: string, trialId: string, interactionType: string, payload: Record<string, unknown>) { return call(`/v1/trials/${encodeURIComponent(trialId)}/interactions`, token, { method: "POST", body: JSON.stringify({ interaction_type: interactionType, payload }) }) as Promise<{ interaction_id: string; server_timestamp: string; acknowledged: true }>; }
export function finalizeSession(token: string) { return call("/v1/session/finalize", token, { method: "POST", body: "{}" }) as Promise<{ session: { session_id: string; status: string; already_complete: boolean }; acknowledged: true }>; }
