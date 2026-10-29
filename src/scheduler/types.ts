export interface Counts {
  networks: number
  candidates: number
  matchesRunning: number
  episodes: number
  episodeGames: number
  workers: number
  evalResults: number
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
  paused: boolean
  initialRevealed: number
  dataKind: DataKind
  minClientVersion: string
  sprt: Sprt
  best: Network | null
  counts: Counts
  eval: EvalConfig
  /** 绝对强度判据置位的停机信号（trainer 轮询 GetInfo 后优雅停止） */
  shouldStop: boolean
  stopReason: string
  /** 生成-消费平衡的自动暂停（trainer 消费停滞时由 balance 策略置位） */
  autoPaused: boolean
  autoPauseReason: string
}

/** 绝对强度评估配置快照（opponents/stopWinRate 恒为当前生效值：在线覆盖优先于配置文件） */
export interface EvalConfig {
  enabled: boolean
  opponents: string[]
  games: number
  mctsSims: number
  mode: string
  everyNPromotions: number
  noProgressN: number
  noProgressEps: number
  /** 达标停机：material_expectimax 胜率 ≥ 该值即置位 should_stop；0 = 关闭 */
  stopWinRate: number
  /** 待下发评估任务数 */
  pending: number
}

/** GET /api/eval-config 响应：在线覆盖 + 生效值 */
export interface EvalConfigView {
  override: {
    enabled?: boolean
    opponents?: string[]
    stopWinRate?: number
  } | null
  effective: {
    enabled: boolean
    opponents: string[]
    stopWinRate: number
  }
}

/** PUT /api/eval-config 请求体：null = 该项回落配置文件值；clear = 全清 */
export interface EvalConfigUpdate {
  clear?: boolean
  enabled?: boolean | null
  opponents?: string[] | null
  stopWinRate?: number | null
}

/** 单次评估结果（被测网络 × 对手标识） */
export interface EvalResult {
  networkSha: string
  opponentSpec: string
  /** 主网络视角胜负和（聚合，向后兼容） */
  wins: number
  draws: number
  losses: number
  /** 明细四分：红/黑方获胜（绝对色彩）+ 平局成因拆分；旧数据为 0 */
  redWins: number
  blackWins: number
  drawNoCapture: number
  drawTruncation: number
  numGames: number
  winRate: number
  avgMoves: number
  createdAt: number
}

/** 单对手的版本序列（升序）与「连续无提升」计数 */
export interface EvalTrend {
  opponent: string
  versions: number
  noProgress: number
  latestWinRate: number
  points: EvalResult[]
}

/** 进行中的评估作业（eval_queue 累计进度 + 在飞局数） */
export interface EvalRunning {
  networkSha: string
  spec: string
  numGames: number
  targetGames: number
  inFlight: number
}

export interface EvalView {
  config: EvalConfig
  shouldStop: boolean
  stopReason: string
  latest: EvalResult[]
  trends: EvalTrend[]
  running: EvalRunning[]
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
}

export interface EpisodePage {
  items: Episode[]
  nextBefore: number
  hasMore: boolean
}

/** —— 对局回放（上帝视角，未翻开暗子以 revealedAt 标记明暗）—— */
export interface ReplayGameSummary {
  index: number
  steps: number
  gameLength: number
  winner: number | null
  termination: string
  hasSeed: boolean
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
  seed: number
  hasSeed: boolean
  /** 对局双方：A = 产数据方，B = 对手；RedIsA = 第 0 步行棋方（红先）是否为 A */
  sideA: string
  sideB: string
  redIsA: boolean
  /** 单方面视角录制（仅产数据方行动步，对手行动未记录） */
  aSideOnly: boolean
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
  /** eval 任务的对手标识（rule:capture_first 等）；其余任务为空 */
  opponentSpec: string
  games: number
  createdAt: number
}

/** [balance] 配置快照（生成-消费平衡策略） */
export interface BalanceConfig {
  enabled: boolean
  mode: string
  trainerOnlineSeconds: number
  stalledSeconds: number
  backlogPauseBatches: number
  pauseReanalysis: boolean
}

/** 单个 trainer 的消费快照（/api/trainers） */
export interface TrainerInfo {
  id: string
  lastSeen: number
  online: boolean
  variant: string
  dataKind: DataKind
  /** 消费水位：训练线程最后取走的记录所属对象键与映射 episodes.id */
  consumedKey: string
  consumedId: number
  /** 服务端权威积压：该类别已登记最大 id 与未消费批数 */
  registeredMaxId: number
  unconsumedBatches: number
  /** 训练线程累计取走记录数（单调递增 = 消费在推进） */
  samplesConsumed: number
  /** trainer 自报：本地积压估计与就绪缓冲存量 */
  backlog: number
  buffered: number
  /** 进程内健康状态：ok | degraded | fatal（空 = 旧客户端，按 ok 语义） */
  healthStatus?: string
  lastError?: string
  /** 训练节奏快照（JSON 透传，结构见 NnueTrainer.progress()；空 = 旧客户端） */
  progress?: string
}

/** /api/trainers 视图：平衡策略配置 + 自动暂停状态 + trainer 快照 */
export interface TrainersView {
  config: BalanceConfig
  autoPaused: boolean
  autoPauseReason: string
  trainers: TrainerInfo[]
}
