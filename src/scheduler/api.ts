import type {
  DataKind,
  DataStats,
  EpisodePage,
  JobControlView,
  JobListPage,
  JobView,
  Match,
  Network,
  ReplayGame,
  ReplayList,
  RunningTask,
  Status,
  StorageView,
  TaskStateStats,
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
  /** 预签名 PUT：客户端自行上传权重文件到对象存储，再走 registerNetwork 登记 */
  signNetworkUpload: (body: { sha: string; format: string; contentLength?: number; contentSha256?: string }) =>
    request<{ uploadUrl: string; objectKey: string }>('/api/networks/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  registerNetwork: (body: { sha: string; parentSha?: string; notes?: string; format?: string }) =>
    request<{ accepted: boolean; message: string; matchTaskHint?: string }>('/api/networks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  matches: () => request<Match[]>('/api/matches'),
  workers: () => request<WorkerInfo[]>('/api/workers'),
  setWorkerNote: (id: string, note: string) =>
    request<{ ok: boolean }>(`/api/workers/${encodeURIComponent(id)}/note`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }),
  tasks: () => request<RunningTask[]>('/api/tasks'),
  taskStats: () => request<TaskStateStats>('/api/task-stats'),
  jobs: (
    kind?: string,
    state?: string,
    opts?: { jobId?: string; limit?: number; offset?: number },
  ) => {
    const q = new URLSearchParams()
    if (kind) q.set('kind', kind)
    if (state) q.set('state', state)
    if (opts?.jobId) q.set('jobId', opts.jobId)
    if (opts?.limit !== undefined) q.set('limit', String(opts.limit))
    if (opts?.offset !== undefined) q.set('offset', String(opts.offset))
    const qs = q.toString()
    return request<JobListPage>(`/api/jobs${qs ? `?${qs}` : ''}`)
  },
  job: (jobId: string) => request<JobView>(`/api/jobs/${encodeURIComponent(jobId)}`),
  controlJob: (jobId: string, action: 'pause' | 'resume' | 'cancel') =>
    request<JobControlView>(`/api/jobs/${encodeURIComponent(jobId)}/${action}`, { method: 'POST' }),
  episodes: (before: number, limit = 100) =>
    request<EpisodePage>(`/api/episodes?before=${before}&limit=${limit}`),
  replayGames: (id: number | string) =>
    request<ReplayList>(`/api/episodes/${id}/replay`),
  replayGame: (id: number | string, index: number) =>
    request<ReplayGame>(`/api/episodes/${id}/replay/${index}`),
  dataStats: () => request<DataStats>('/api/data-stats'),
  control: (body: { initialRevealed?: number; dataKind?: DataKind; clearStop?: boolean }) =>
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
