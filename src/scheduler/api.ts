import type {
  CollectSpecBody,
  DataKind,
  DataStats,
  EpisodeGame,
  EpisodePage,
  GameLookupPage,
  JobControlView,
  JobListPage,
  JobView,
  Match,
  MatchPairsPage,
  Network,
  RatingSpecBody,
  ReplayGame,
  ReplayList,
  RunningTask,
  Status,
  StorageView,
  SubmitJobResult,
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
  /** 预签名 GET：获取网络权重文件下载 URL（TTL 1 小时，直连对象存储） */
  networkDownload: (sha: string) =>
    request<{ url: string; objectKey: string }>(
      `/api/networks/${encodeURIComponent(sha)}/download`,
    ),
  matches: () => request<Match[]>('/api/matches'),
  workers: () => request<WorkerInfo[]>('/api/workers'),
  setWorkerNote: (id: string, note: string) =>
    request<{ ok: boolean }>(`/api/workers/${encodeURIComponent(id)}/note`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }),
  /** 删除 worker 登记记录（调度器仅允许删除离线 worker） */
  deleteWorker: (id: string) =>
    request<{ ok: boolean }>(`/api/workers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
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
  /** 提交任务（kind=collect 带 collect 规格 / kind=rating 带 rating 规格） */
  submitJob: (body: {
    kind: 'collect' | 'rating'
    priority?: number
    requester?: string
    collect?: CollectSpecBody
    rating?: RatingSpecBody
  }) =>
    request<SubmitJobResult>('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  controlJob: (jobId: string, action: 'pause' | 'resume' | 'cancel') =>
    request<JobControlView>(`/api/jobs/${encodeURIComponent(jobId)}/${action}`, { method: 'POST' }),
  episodes: (before: number, limit = 100, matchId?: number, offset = 0) =>
    request<EpisodePage>(
      `/api/episodes?before=${before}&limit=${limit}${matchId ? `&match=${matchId}` : ''}${offset > 0 ? `&offset=${offset}` : ''}`,
    ),
  /** 某 match 的"对"级六分类明细（LL/LD/DD/WL/DW/WW，候选视角） */
  matchPairs: (id: number | string) => request<MatchPairsPage>(`/api/matches/${id}/pairs`),
  /** 某 episode 的逐局标识（换手/种子/配对） */
  episodeGames: (id: number | string) =>
    request<EpisodeGame[]>(`/api/episodes/${id}/games`),
  /** 按对局种子反查所在 episode */
  lookupGame: (seed: string | number) =>
    request<GameLookupPage>(`/api/episodes/lookup-game?seed=${seed}`),
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
