import type {
  DataKind,
  DataStats,
  EpisodePage,
  EvalConfigUpdate,
  EvalConfigView,
  EvalView,
  Match,
  Network,
  ReplayGame,
  ReplayList,
  RunningTask,
  Status,
  StorageView,
  TaskStateStats,
  TrainersView,
  TrainConfigView,
  WorkerInfo,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(readError(body) ?? `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

function readError(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: string }
    return parsed.error
  } catch {
    return body || undefined
  }
}

export const api = {
  status: () => request<Status>('/api/status'),
  networks: () => request<Network[]>('/api/networks'),
  promote: (sha: string) => request<{ ok: boolean }>(`/api/networks/${sha}/promote`, { method: 'POST' }),
  matches: () => request<Match[]>('/api/matches'),
  eval: () => request<EvalView>('/api/eval'),
  evalConfig: () => request<EvalConfigView>('/api/eval-config'),
  setEvalConfig: (body: EvalConfigUpdate) =>
    request<{ ok: boolean }>('/api/eval-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  triggerEval: () =>
    request<{ ok: boolean; triggered: number; message: string }>('/api/eval/trigger', { method: 'POST' }),
  workers: () => request<WorkerInfo[]>('/api/workers'),
  trainers: () => request<TrainersView>('/api/trainers'),
  setWorkerNote: (id: string, note: string) =>
    request<{ ok: boolean }>(`/api/workers/${encodeURIComponent(id)}/note`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }),
  tasks: () => request<RunningTask[]>('/api/tasks'),
  taskStats: () => request<TaskStateStats>('/api/task-stats'),
  episodes: (before: number, limit = 100) =>
    request<EpisodePage>(`/api/episodes?before=${before}&limit=${limit}`),
  replayGames: (id: number | string) =>
    request<ReplayList>(`/api/episodes/${id}/replay`),
  replayGame: (id: number | string, index: number) =>
    request<ReplayGame>(`/api/episodes/${id}/replay/${index}`),
  dataStats: () => request<DataStats>('/api/data-stats'),
  control: (body: {
    paused?: boolean
    initialRevealed?: number
    dataKind?: DataKind
    clearStop?: boolean
  }) =>
    request<{ ok: boolean }>('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  trainConfig: () => request<TrainConfigView>('/api/train-config'),
  setTrainConfig: (overrides: Record<string, string>) =>
    request<{ ok: boolean }>('/api/train-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides }),
    }),
  storage: () => request<StorageView>('/api/storage'),
  saveStorageProfile: (
    name: string,
    body: {
      endpoint?: string
      region?: string
      accessKey?: string
      secretKey?: string
      bucket?: string
      pathStyle?: boolean
    },
  ) =>
    request<{ ok: boolean }>(`/api/storage/profiles/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deleteStorageProfile: (name: string) =>
    request<{ ok: boolean }>(`/api/storage/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  activateStorage: (name: string) =>
    request<{ ok: boolean }>('/api/storage/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
}
