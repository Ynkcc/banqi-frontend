export interface Counts {
  networks: number
  candidates: number
  matchesRunning: number
  episodes: number
  episodeGames: number
  workers: number
}

export interface Network {
  sha: string
  parentSha: string
  createdAt: number
  isBest: boolean
  status: string
  notes: string
}

export interface Sprt {
  elo0: number
  elo1: number
  alpha: number
  beta: number
}

/** 自对弈产出的数据类别（与 proto DataKind 对应） */
export type DataKind = 'resnet' | 'nnue'

export interface Status {
  variant: string
  initialRevealed: number
  dataKind: DataKind
  minClientVersion: string
  sprt: Sprt
  counts: Counts
  /** 停机信号（collector 轮询 GetInfo 后优雅停止） */
  shouldStop: boolean
  stopReason: string
}

export interface Match {
  id: number
  candidate: string
  opponent: string
  status: string
  pairs: number[]
  numGames: number
  targetGames: number
  score: number | null
  llr: number
  lower: number
  upper: number
  verdict: string
}

export interface WorkerInfo {
  id: string
  /** 运维备注（WebUI 手工标注的名称/用途，心跳不覆盖） */
  note: string
  lastSeen: number
  online: boolean
  threads: number
  completedGames: number
  clientVersion: string
  memoryMb: number
  /** 进程内健康状态：ok | degraded | fatal（空 = 旧客户端，按 ok 语义） */
  healthStatus?: string
  /** 最近一次降级/致命摘要（空 = 无） */
  lastError?: string
  /** 生产效率：近 1h / 24h 窗口内登记的 episode 批数与局数（trainer 恒为 0） */
  episodes1h: number
  games1h: number
  episodes24h: number
  games24h: number
  /** 估算效率：按最近 24 批 episode 的时间跨度推算的稳态速率（局/h）与单线程速率 */
  estGamesPerHour: number
  estPerThreadHour: number
  estSamples: number
}

/** 单条任务状态记录（/api/task-stats 的 expired 列表项）。 */
export interface TaskStateRecord {
  taskId: string
  workerId: string
  kind: string
  state: string
  games: number
  createdAt: number
  ageSeconds: number
}

/** 任务状态机快照：assigned / completed / expired 计数 + 最近过期任务。 */
export interface TaskStateStats {
  counts: { assigned: number; completed: number; expired: number }
  expired: TaskStateRecord[]
  oldestAssignedAgeSeconds: number
}

/** 单数据类别的登记统计（窗口口径由字段决定：total / last1h / last24h）。 */
export interface KindStats {
  episodes: number
  games: number
  steps: number
}

/** /api/data-stats 数据流入实时总览。 */
export interface DataStats {
  total: Record<string, KindStats>
  last1h: Record<string, KindStats>
  last24h: Record<string, KindStats>
  recent: Episode[]
  /** 本代数据：最近一次候选导出（最新登记网络）以来的 episode 统计。
   *  fresh-only 训练语义下 = 下一候选的训练集。 */
  generation: {
    since: number
    candidate: string
    episodes: number
    games: number
    steps: number
  }
}

export interface Episode {
  id: number
  workerId: string
  taskId: string
  networkSha: string
  gameCount: number
  totalSteps: number
  winner: number
  dataKind: DataKind
  objectKey: string
  /** 对局双方：对手模型 hash（mix/gatekeeper 对打）或规则对手标识（对打训练） */
  opponentSha: string
  opponentSpec: string
  /** gatekeeper 对打关联（matches 表 id，0 = 无），可反查对战记录 */
  matchId: number
  /** 逐局结果四分（红黑绝对色彩视角 + 平局按成因）；旧数据为 0 */
  redWins: number
  blackWins: number
  drawNoCapture: number
  drawTruncation: number
  createdAt: number
  /** 任务下发的基础种子（无符号十进制字符串，未上报为 null） */
  seedBase?: string | null
  /** 配对语义快照：成对并行（未上报为 null） */
  pairsParallel?: boolean | null
  /** 配对语义快照：对内第二局是否刷新种子（未上报为 null） */
  pairSeedRefresh?: boolean | null
}

export interface EpisodePage {
  items: Episode[]
  nextBefore: number
  hasMore: boolean
}

/** 逐局标识（/api/episodes/{id}/games）：对局反查与配对关联的最小单元 */
export interface EpisodeGame {
  /** 任务内全局序号（0-based） */
  gameIndex: number
  /** 对序号 = gameIndex / 2 */
  pairIndex: number
  /** 对内位置：0 = 第一局，1 = 第二局 */
  pairPosition: number
  gameSeed: string | null
  /** 玩家 A（产数据方）是否执红：对内两局应互补（换手） */
  aIsRed: boolean
  /** 本局种子是否为对内刷新种子 */
  seedRefreshed: boolean
  winner: number | null
  steps: number
}

/** 种子反查命中项（/api/episodes/lookup-game） */
export interface GameLookupItem {
  episode: Episode
  game: EpisodeGame
}

export interface GameLookupPage {
  items: GameLookupItem[]
}

/** —— 对局回放（上帝视角，未翻开暗子以 revealedAt 标记明暗）—— */
export interface ReplayGameSummary {
  index: number
  steps: number
  gameLength: number
  winner: number | null
  termination: string
  hasSeed: boolean
  /** 玩家 A（产数据方）是否执红（对内两局应互补；旧数据按首步行棋方回填） */
  redIsA: boolean
  /** 对局种子（无符号十进制字符串） */
  seed: string | null
  /** 本局种子是否为对内刷新种子 */
  seedRefreshed: boolean
  /** 对序号（旧数据按批内序号回填） */
  pairIndex: number
  /** 对内位置 0/1 */
  pairPosition: number
}

export interface ReplayList {
  id: number
  kind: DataKind
  variant: string
  gameCount: number
  games: ReplayGameSummary[]
}

/** 步前双方剩余暗子按类型计数（兵炮马车相士帅 = 下标 0..6） */
export interface HiddenBag {
  red: number[]
  black: number[]
}

export interface ReplayStep {
  ply: number
  player: 'Red' | 'Black'
  action: number
  from: number
  to: number
  kind: 'flip' | 'move' | 'capture' | 'reveal-attack'
  isChance?: boolean
  revealed?: string
  captured?: string
  moveCounter: number
  scores: [number, number]
  board: string[]
  /** 步前快照 BFEN（与 board 同一局面；旧版后端可能缺失） */
  fen?: string
  revealedAt: boolean[]
  /** 步前暗子袋（上帝视角） */
  hiddenBag: HiddenBag
  /** 局面来源：恒为 snapshot = 步前快照精确重建（旧数据动作推断已移除） */
  boardSource: 'snapshot'
  /** 每步诊断（教师标注器 / 搜索观测；旧数据为 0 / null） */
  searchValue: number
  playerValue: number
  hiddenCount: number
  searchDepth: number
  searchNodes: number
  chosenValueGap: number
  /** 因探索采样偏离产方搜索 argmax 的动作（旧数据恒 false） */
  explRandom: boolean
  labelerFallback: boolean
  labelerAction: number | null
  policyActions: number[] | null
  policyValues: number[] | null
}

export interface ReplayGame {
  index: number
  steps: number
  gameLength: number
  winner: number | null
  termination: string
  /** 对局种子（无符号十进制字符串；hasSeed=false 时为空串） */
  seed: string
  hasSeed: boolean
  /** 对局双方：A = 产数据方，B = 对手；RedIsA = 第 0 步行棋方（红先）是否为 A */
  sideA: string
  sideB: string
  redIsA: boolean
  /** 单方面视角录制（仅产数据方行动步，对手行动未记录） */
  aSideOnly: boolean
  /** 初始局面 BFEN（与 initialBoard 同一局面；旧版后端可能缺失） */
  initialFen?: string | null
  /** 终局局面 BFEN（与 finalBoard 同一局面；旧版后端可能缺失） */
  finalFen?: string | null
  initialBoard: string[]
  initialShown: boolean[]
  initialBag: HiddenBag
  finalBoard: string[]
  finalShown: boolean[]
  finalBag: HiddenBag
  moves: ReplayStep[]
  /** 教师 argmax 与实际动作的同意率（labeler_actions 有效步口径） */
  labelerAgree: number
  labelerTotal: number
  /** 探索采样偏离 argmax 的步数（expl_random = 1；旧数据恒 0） */
  explCount: number
}

/** 可远程调节的训练超参类型（与调度器 trainConfigSpecs 的 kind 对应） */
export type TrainConfigKind = 'float' | 'int' | 'bool' | 'enum'

/** 白名单字段描述：前端据此渲染表单与约束提示，无需硬编码字段名与取值范围 */
export interface TrainConfigField {
  name: string
  kind: TrainConfigKind
  min: number
  max: number
  hasMax: boolean
  gtZero: boolean
  enum?: string[]
}

/** 训练超参面板视图：当前覆盖项（全量语义）+ 可调字段清单 */
export interface TrainConfigView {
  overrides: Record<string, string>
  fields: TrainConfigField[]
}

/** 单个存储后端配置（secret 永不下发，accessKey 为掩码） */
export interface StorageProfile {
  name: string
  endpoint: string
  region: string
  accessKey: string
  hasSecret: boolean
  bucket: string
  pathStyle: boolean
}

/** /api/storage 视图：profiles + 当前生效名 */
export interface StorageView {
  active: string
  profiles: StorageProfile[]
}

export interface RunningTask {
  taskId: string
  workerId: string
  kind: string
  matchId: number
  networkSha: string
  opponentSha: string
  /** 评估/对打任务的对手标识（rule:capture_first 等）；其余任务为空 */
  opponentSpec: string
  games: number
  createdAt: number
  /** 所属 job（collect/selfplay/rating 派发来源）；旧调度器为空 */
  jobId?: string
}

/** —— collect/selfplay/rating job（/api/jobs）—— */

/** 对弈一方规格（与调度器 PlayerSpecJson 对应） */
export interface PlayerSpec {
  kind: string
  networkSha: string
  search?: unknown
}

/** 种子策略（kind: fixed/random/incremental/range） */
export interface SeedStrategyBody {
  kind: string
  fixedSeed: number
  baseSeed: number
  minSeed: number
  maxSeed: number
}

/** collect job 规格（调度器 CollectBody 回显，camelCase） */
export interface CollectSpecBody {
  variant: string
  scenario: string
  seedStrategy: SeedStrategyBody
  playerA: PlayerSpec
  playerB: PlayerSpec
  dataKind: string
  totalGames: number
  pairsParallel?: boolean
  pairSeedRefresh?: boolean
}

/** rating job 规格（调度器 RatingBody 回显，camelCase） */
export interface RatingSpecBody {
  variant: string
  candidateSha: string
  opponentSha: string
  totalGames: number
  sprtElo0: number
  sprtElo1: number
  sprtAlpha: number
  sprtBeta: number
  sideA?: PlayerSpec | null
  sideB?: PlayerSpec | null
  scenario: string
}

/** rating job 附带的 SPRT / 对战统计（调度器 RatingStatsView，camelCase） */
export interface RatingStats {
  ll: number
  ld: number
  dd: number
  wl: number
  dw: number
  ww: number
  numGames: number
  matchStatus: string
  sideAKind: string
  sideBKind: string
}

/** /api/jobs 列表项（spec 按 kind 解析：collect → CollectSpecBody，rating → RatingSpecBody） */
export interface JobView {
  jobId: string
  kind: 'collect' | 'selfplay' | 'rating' | string
  priority: number
  state: 'running' | 'paused' | 'completed' | 'cancelled' | string
  totalGames: number
  completedGames: number
  dispatchedGames: number
  createdAt: number
  updatedAt: number
  spec: CollectSpecBody | RatingSpecBody | Record<string, unknown> | null
  ratingStats?: RatingStats | null
}

/** /api/jobs 分页响应（total 为满足过滤条件的总条数，不受 limit/offset 影响） */
export interface JobListPage {
  jobs: JobView[]
  total: number
  limit: number
  offset: number
}

export interface JobControlView {
  accepted: boolean
  message: string
  state: string
}

/** POST /api/jobs 响应 */
export interface SubmitJobResult {
  accepted: boolean
  message: string
  jobId: string
}

