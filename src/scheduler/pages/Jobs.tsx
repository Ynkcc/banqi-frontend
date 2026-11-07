import Alert from 'antd/es/alert'
import App from 'antd/es/app'
import Button from 'antd/es/button'
import Card from 'antd/es/card'
import Descriptions from 'antd/es/descriptions'
import Modal from 'antd/es/modal'
import Progress from 'antd/es/progress'
import Segmented from 'antd/es/segmented'
import Space from 'antd/es/space'
import Table from 'antd/es/table'
import Tag from 'antd/es/tag'
import Tooltip from 'antd/es/tooltip'
import Typography from 'antd/es/typography'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtAgo, fmtCount, fmtTime, kindTagColor, shortSha } from '../format'
import type {
  CollectSpecBody,
  Episode,
  JobView,
  PlayerSpec,
  RatingSpecBody,
  RunningTask,
  SeedStrategyBody,
  TaskStateStats,
} from '../types'
import { usePoll } from '../usePoll'
import CreateJobModal from '../components/CreateJobModal'

const EPISODE_LIMIT = 20

const JOB_KINDS = ['all', 'collect', 'rating'] as const
const JOB_STATES = ['all', 'running', 'paused', 'completed', 'cancelled'] as const

const stateLabel: Record<(typeof JOB_STATES)[number], string> = {
  all: '全部',
  running: '运行中',
  paused: '暂停',
  completed: '已完成',
  cancelled: '已取消',
}

/** 类型/状态筛选持久化 key */
const JOBS_FILTER_KEY = 'scheduler.jobs::filters'

function loadJobFilters(): { kind: (typeof JOB_KINDS)[number]; state: (typeof JOB_STATES)[number] } {
  const fallback = { kind: 'all' as const, state: 'all' as const }
  try {
    const raw = window.localStorage.getItem(JOBS_FILTER_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<{ kind: string; state: string }>
    return {
      kind: JOB_KINDS.includes(parsed.kind as (typeof JOB_KINDS)[number])
        ? (parsed.kind as (typeof JOB_KINDS)[number])
        : 'all',
      state: JOB_STATES.includes(parsed.state as (typeof JOB_STATES)[number])
        ? (parsed.state as (typeof JOB_STATES)[number])
        : 'all',
    }
  } catch {
    return fallback
  }
}

const stateTag = (state: string) => {
  const color =
    state === 'running'
      ? 'processing'
      : state === 'paused'
        ? 'orange'
        : state === 'completed'
          ? 'green'
          : state === 'cancelled'
            ? 'red'
            : 'default'
  return <Tag color={color}>{state}</Tag>
}

const kindTag = (kind: string) => (
  <Tag color={kind === 'rating' ? 'gold' : kind === 'collect' ? 'blue' : 'default'}>{kind}</Tag>
)

const specOf = (job: JobView): CollectSpecBody | null =>
  job.kind === 'collect' && job.spec && typeof job.spec === 'object'
    ? (job.spec as CollectSpecBody)
    : null

const ratingSpecOf = (job: JobView): RatingSpecBody | null =>
  job.kind === 'rating' && job.spec && typeof job.spec === 'object'
    ? (job.spec as RatingSpecBody)
    : null

const seedKindText: Record<string, string> = {
  fixed: 'fixed（固定）',
  random: 'random（随机）',
  incremental: 'incremental（递增）',
  range: 'range（区间）',
}

/** 种子策略参数明细（fixed/incremental/range 各异） */
const seedExtra = (s?: SeedStrategyBody): string => {
  if (!s) return ''
  if (s.kind === 'fixed') return `seed=${s.fixedSeed}`
  if (s.kind === 'incremental') return `base=${s.baseSeed}`
  if (s.kind === 'range') return `[${s.minSeed}, ${s.maxSeed}]`
  return ''
}

/** 起始局面（start_fens）：空 = 默认随机开局 */
const startFensView = (fens?: string[]) => {
  if (!fens || fens.length === 0) {
    return <Typography.Text type="secondary">默认随机开局</Typography.Text>
  }
  return (
    <Space direction="vertical" size={0} wrap>
      {fens.map((f, i) => (
        <Typography.Text key={i} code style={{ fontSize: 12 }}>
          {f}
        </Typography.Text>
      ))}
    </Space>
  )
}

/** 搜索规格宽容渲染（字段多且随版本演进，仅展示非空项） */
const renderSearch = (search: unknown) => {
  if (!search || typeof search !== 'object') return null
  const entries = Object.entries(search as Record<string, unknown>).filter(
    ([, v]) =>
      v !== null &&
      v !== undefined &&
      v !== '' &&
      !(Array.isArray(v) && v.length === 0) &&
      !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0),
  )
  if (entries.length === 0) return null
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      搜索参数：
      {entries.map(([k, v]) => (
        <Tag key={k} style={{ fontSize: 12 }}>
          {k}={String(v)}
        </Tag>
      ))}
    </Typography.Text>
  )
}

/** 展开详情里的选手完整信息：kind + 完整 sha（可复制）+ 搜索参数 */
const playerDetail = (p?: PlayerSpec) => {
  if (!p) return <Typography.Text type="secondary">-</Typography.Text>
  return (
    <Space direction="vertical" size={2}>
      <Space size={4}>
        <Tag>{p.kind || 'network'}</Tag>
        {p.networkSha && (
          <Typography.Text code copyable={{ text: p.networkSha }}>
            {p.networkSha}
          </Typography.Text>
        )}
      </Space>
      {renderSearch(p.search)}
    </Space>
  )
}

const playerCell = (p?: PlayerSpec) => {
  if (!p) return <Typography.Text type="secondary">-</Typography.Text>
  return (
    <Space size={4}>
      <Tag>{p.kind || 'network'}</Tag>
      {p.networkSha && <Typography.Text code>{shortSha(p.networkSha)}</Typography.Text>}
    </Space>
  )
}

export default function Jobs() {
  const { message } = App.useApp()

  // —— 任务列表（持久化 job，全 kind/全状态；服务端分页）——
  const savedFilters = loadJobFilters()
  const [kindFilter, setKindFilter] = useState<(typeof JOB_KINDS)[number]>(savedFilters.kind)
  const [stateFilter, setStateFilter] = useState<(typeof JOB_STATES)[number]>(savedFilters.state)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 记住类型与状态选择
  useEffect(() => {
    try {
      window.localStorage.setItem(JOBS_FILTER_KEY, JSON.stringify({ kind: kindFilter, state: stateFilter }))
    } catch {
      // 忽略持久化失败
    }
  }, [kindFilter, stateFilter])
  const jobs = usePoll(
    () =>
      api.jobs(
        kindFilter === 'all' ? undefined : kindFilter,
        stateFilter === 'all' ? undefined : stateFilter,
        { limit: pageSize, offset: (page - 1) * pageSize },
      ),
    5000,
  )
  // 翻页 / 筛选 / 页大小变化后立即刷新（reload 稳定引用，轮询继续走新参数）
  useEffect(() => {
    void jobs.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, kindFilter, stateFilter])

  // —— 任务状态展示相关轮询 ——
  // worker 领取的在途任务（进程内 assigned 态）
  const tasks = usePoll(api.tasks, 5000)
  // 任务状态机快照（completed/expired 计数 + 最近过期明细）
  const tstats = usePoll(api.taskStats, 5000)
  // 最近登记的对局批：任务完成上报的直接产物
  const episodes = usePoll(() => api.episodes(0, EPISODE_LIMIT), 10000)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const jobById = new Map((jobs.data?.jobs ?? []).map((j) => [j.jobId, j]))

  const report = (e: unknown) => message.error(`操作失败：${e instanceof Error ? e.message : String(e)}`)

  const control = async (jobId: string, action: 'pause' | 'resume' | 'cancel') => {
    setBusyId(jobId)
    try {
      const res = await api.controlJob(jobId, action)
      message.success(res.message || `job ${jobId.slice(0, 12)} → ${res.state}`)
      void jobs.reload()
    } catch (e) {
      report(e)
    } finally {
      setBusyId(null)
    }
  }

  const confirmControl = (jobId: string, action: 'pause' | 'resume' | 'cancel') => {
    const text = action === 'pause' ? '暂停' : action === 'resume' ? '恢复' : '取消'
    Modal.confirm({
      title: `${text} job ${jobId.slice(0, 12)}？`,
      content:
        action === 'cancel'
          ? '取消后该 job 不再派发新任务，已领取的在途任务将被心跳回收。'
          : '仅影响后续任务派发，不影响在途任务。',
      okText: text,
      okButtonProps: { danger: action === 'cancel' },
      cancelText: '取消',
      onOk: () => control(jobId, action),
    })
  }

  const jobColumns: TableProps<JobView>['columns'] = [
    {
      title: 'Job',
      dataIndex: 'jobId',
      width: 150,
      render: (v: string) => (
        <Tooltip title={v}>
          <Typography.Text code copyable={{ text: v }}>
            {v.slice(0, 12)}
          </Typography.Text>
        </Tooltip>
      ),
    },
    { title: '类型', dataIndex: 'kind', width: 90, render: (v: string) => kindTag(v) },
    { title: '状态', dataIndex: 'state', width: 110, render: (v: string) => stateTag(v) },
    {
      title: '进度（局）',
      key: 'progress',
      width: 200,
      render: (_, j: JobView) => {
        const total = j.totalGames
        if (total > 0) {
          return (
            <Tooltip title={`已下发 ${fmtCount(j.dispatchedGames)} / 已完成 ${fmtCount(j.completedGames)} / 目标 ${fmtCount(total)}`}>
              <Progress
                size="small"
                percent={Math.min(100, Math.round((j.completedGames / total) * 100))}
                format={() => `${fmtCount(j.completedGames)}/${fmtCount(total)}`}
              />
            </Tooltip>
          )
        }
        // totalGames = 0：持续型任务（rating 仅 SPRT 判停）
        return (
          <Tooltip title={`无局数上限：已下发 ${fmtCount(j.dispatchedGames)}，已完成 ${fmtCount(j.completedGames)}`}>
            <span>
              {fmtCount(j.completedGames)} <Typography.Text type="secondary">/ 持续</Typography.Text>
            </span>
          </Tooltip>
        )
      },
    },
    {
      title: '选手',
      key: 'players',
      render: (_, j: JobView) => {
        const spec = specOf(j)
        if (spec) {
          return (
            <Space size={4} wrap>
              {playerCell(spec.playerA)}
              <Typography.Text type="secondary">vs</Typography.Text>
              {playerCell(spec.playerB)}
            </Space>
          )
        }
        const rs = ratingSpecOf(j)
        if (rs) {
          const stats = j.ratingStats
          return (
            <Space size={4} wrap>
              <Tag color="blue">候选</Tag>
              <Typography.Text code>{shortSha(rs.candidateSha)}</Typography.Text>
              <Typography.Text type="secondary">vs</Typography.Text>
              <Typography.Text code>{shortSha(rs.opponentSha)}</Typography.Text>
              {stats && (
                <Typography.Text type="secondary">
                  {stats.matchStatus} · {fmtCount(stats.numGames)} 局
                </Typography.Text>
              )}
            </Space>
          )
        }
        return <Typography.Text type="secondary">-</Typography.Text>
      },
    },
    {
      title: '类别',
      key: 'dataKind',
      width: 90,
      render: (_, j: JobView) => {
        const spec = specOf(j)
        return spec?.dataKind ? <Tag color={kindTagColor(spec.dataKind)}>{spec.dataKind}</Tag> : '-'
      },
    },
    {
      title: '场景',
      key: 'scenario',
      width: 90,
      render: (_, j: JobView) => {
        const spec = specOf(j)
        const scenario = spec?.scenario ?? ratingSpecOf(j)?.scenario
        if (!scenario) return '-'
        return (
          <Tag color={scenario === 'all_revealed' ? 'gold' : 'blue'}>
            {scenario === 'all_revealed' ? '全明子' : '标准'}
          </Tag>
        )
      },
    },
    {
      title: '种子策略',
      key: 'seed',
      width: 140,
      render: (_, j: JobView) => {
        const spec = specOf(j)
        if (!spec?.seedStrategy) return '-'
        const s = spec.seedStrategy
        const detail = seedKindText[s.kind] ?? s.kind
        const extra = seedExtra(s)
        return (
          <Tooltip title={extra ? `${detail} · ${extra}` : detail}>
            <span>
              {s.kind}
              {extra && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {' '}
                  {extra}
                </Typography.Text>
              )}
            </span>
          </Tooltip>
        )
      },
    },
    { title: '优先级', dataIndex: 'priority', width: 80 },
    { title: '创建', dataIndex: 'createdAt', width: 100, render: (v: number) => fmtAgo(v) },
    { title: '更新', dataIndex: 'updatedAt', width: 100, render: (v: number) => fmtAgo(v) },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, j: JobView) => {
        const busy = busyId === j.jobId
        const terminal = j.state === 'completed' || j.state === 'cancelled'
        return (
          <Space size={0}>
            {j.state === 'running' && (
              <Button type="text" size="small" disabled={busy} onClick={() => confirmControl(j.jobId, 'pause')}>
                暂停
              </Button>
            )}
            {j.state === 'paused' && (
              <Button type="text" size="small" disabled={busy} onClick={() => confirmControl(j.jobId, 'resume')}>
                恢复
              </Button>
            )}
            {!terminal && (
              <Button type="text" size="small" danger disabled={busy} onClick={() => confirmControl(j.jobId, 'cancel')}>
                取消
              </Button>
            )}
          </Space>
        )
      },
    },
  ]

  const claimedColumns: TableProps<RunningTask>['columns'] = [
    {
      title: '任务',
      dataIndex: 'taskId',
      width: 140,
      render: (v: string) => (
        <Tooltip title={v}>
          <Typography.Text code>{v.slice(0, 12)}</Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: '类型',
      dataIndex: 'kind',
      width: 110,
      render: (v: string) => <Tag>{v.replace('TASK_', '').toLowerCase()}</Tag>,
    },
    { title: 'Worker', dataIndex: 'workerId', ellipsis: true },
    {
      title: '所属 Job',
      key: 'job',
      width: 150,
      render: (_, t: RunningTask) => {
        if (!t.jobId) return <Typography.Text type="secondary">-</Typography.Text>
        const job = jobById.get(t.jobId)
        return (
          <Tooltip title={job ? `进度 ${fmtCount(job.completedGames)}/${fmtCount(job.totalGames)}（${job.state}）` : t.jobId}>
            <Typography.Text code>{t.jobId.slice(0, 12)}</Typography.Text>
          </Tooltip>
        )
      },
    },
    { title: '局数', dataIndex: 'games', width: 80 },
    {
      title: '网络',
      dataIndex: 'networkSha',
      width: 120,
      render: (v: string) => <Typography.Text code>{shortSha(v)}</Typography.Text>,
    },
    { title: '下发时间', dataIndex: 'createdAt', width: 110, render: (v: number) => fmtAgo(v) },
  ]

  const expiredColumns: TableProps<TaskStateStats['expired'][number]>['columns'] = [
    {
      title: '任务',
      dataIndex: 'taskId',
      width: 140,
      render: (v: string) => (
        <Tooltip title={v}>
          <Typography.Text code>{v.slice(0, 12)}</Typography.Text>
        </Tooltip>
      ),
    },
    { title: 'Worker', dataIndex: 'workerId', ellipsis: true },
    { title: '类型', dataIndex: 'kind', width: 130, render: (v: string) => <Tag>{v.replace('TASK_', '')}</Tag> },
    { title: '局数', dataIndex: 'games', width: 80 },
    { title: '下发时间', dataIndex: 'createdAt', width: 110, render: (v: number) => fmtAgo(v) },
    { title: '超时', dataIndex: 'ageSeconds', width: 110, render: (v: number) => `${Math.round(v / 60)} 分钟` },
  ]

  const episodeColumns: TableProps<Episode>['columns'] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: 'Worker', dataIndex: 'workerId', ellipsis: true },
    {
      title: '任务',
      dataIndex: 'taskId',
      width: 140,
      render: (v: string) =>
        v ? (
          <Tooltip title={v}>
            <Typography.Text code>{v.slice(0, 12)}</Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: '类别',
      dataIndex: 'dataKind',
      width: 90,
      render: (v: string) => <Tag color={kindTagColor(v)}>{v}</Tag>,
    },
    { title: '局数', dataIndex: 'gameCount', width: 80 },
    { title: '步数', dataIndex: 'totalSteps', width: 100 },
    { title: '登记时间', dataIndex: 'createdAt', width: 110, render: (v: number) => fmtAgo(v) },
  ]

  if (jobs.error) {
    return <Alert type="error" showIcon message="加载 /api/jobs 失败" description={jobs.error} />
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card
        size="small"
        title={`任务列表（共 ${jobs.data?.total ?? 0} 条）`}
        extra={
          <Space size={8} wrap>
            <Segmented
              size="small"
              value={kindFilter}
              onChange={(v) => {
                setKindFilter(v as (typeof JOB_KINDS)[number])
                setPage(1)
              }}
              options={JOB_KINDS.map((k) => ({ value: k, label: k === 'all' ? '全部类型' : k }))}
            />
            <Segmented
              size="small"
              value={stateFilter}
              onChange={(v) => {
                setStateFilter(v as (typeof JOB_STATES)[number])
                setPage(1)
              }}
              options={JOB_STATES.map((s) => ({ value: s, label: stateLabel[s] }))}
            />
            <Button type="primary" size="small" onClick={() => setCreateOpen(true)}>
              新建任务
            </Button>
          </Space>
        }
      >
        <Table<JobView>
          rowKey="jobId"
          size="small"
          columns={jobColumns}
          dataSource={jobs.data?.jobs ?? []}
          pagination={{
            current: page,
            pageSize,
            total: jobs.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '无符合条件的任务（可点击右上角「新建任务」提交）' }}
          expandable={{
            expandedRowRender: (j) => {
              const spec = specOf(j)
              if (spec) {
                const s = spec.seedStrategy
                const seedText = s
                  ? [seedKindText[s.kind] ?? s.kind, seedExtra(s)].filter(Boolean).join(' · ')
                  : '-'
                return (
                  <Descriptions column={3} size="small" bordered>
                    <Descriptions.Item label="variant">{spec.variant}</Descriptions.Item>
                    <Descriptions.Item label="场景">
                      {spec.scenario === 'all_revealed' ? '全明子（all_revealed）' : '标准（standard）'}
                    </Descriptions.Item>
                    <Descriptions.Item label="数据类别">{spec.dataKind}</Descriptions.Item>
                    <Descriptions.Item label="选手 A" span={3}>{playerDetail(spec.playerA)}</Descriptions.Item>
                    <Descriptions.Item label="选手 B" span={3}>{playerDetail(spec.playerB)}</Descriptions.Item>
                    <Descriptions.Item label="种子策略">{seedText}</Descriptions.Item>
                    <Descriptions.Item label="目标局数">{fmtCount(spec.totalGames)}</Descriptions.Item>
                    <Descriptions.Item label="成对并行">{spec.pairsParallel ? '是' : '否'}</Descriptions.Item>
                    <Descriptions.Item label="成对种子刷新">{spec.pairSeedRefresh ? '是' : '否'}</Descriptions.Item>
                    <Descriptions.Item label="起始局面" span={3}>{startFensView(spec.startFens)}</Descriptions.Item>
                  </Descriptions>
                )
              }
              const rs = ratingSpecOf(j)
              if (rs) {
                const stats = j.ratingStats
                return (
                  <Descriptions column={3} size="small" bordered>
                    <Descriptions.Item label="variant">{rs.variant || '-'}</Descriptions.Item>
                    <Descriptions.Item label="场景">
                      {rs.scenario === 'all_revealed' ? '全明子（all_revealed）' : '标准（standard）'}
                    </Descriptions.Item>
                    <Descriptions.Item label="目标局数">
                      {rs.totalGames > 0 ? fmtCount(rs.totalGames) : '仅 SPRT 判停'}
                    </Descriptions.Item>
                    <Descriptions.Item label="候选网络">
                      {rs.candidateSha ? (
                        <Typography.Text code copyable={{ text: rs.candidateSha }}>
                          {rs.candidateSha}
                        </Typography.Text>
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="对手网络">
                      {rs.opponentSha ? (
                        <Typography.Text code copyable={{ text: rs.opponentSha }}>
                          {rs.opponentSha}
                        </Typography.Text>
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="SPRT 参数">
                      {`elo0=${rs.sprtElo0} · elo1=${rs.sprtElo1} · α=${rs.sprtAlpha} · β=${rs.sprtBeta}`}
                    </Descriptions.Item>
                    <Descriptions.Item label="side A" span={3}>
                      {rs.sideA ? playerDetail(rs.sideA) : stats ? stats.sideAKind : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="side B" span={3}>
                      {rs.sideB ? playerDetail(rs.sideB) : stats ? stats.sideBKind : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Match 状态">{stats?.matchStatus ?? '-'}</Descriptions.Item>
                    <Descriptions.Item label="对局统计（对）" span={2}>
                      {stats ? `LL ${stats.ll} / LD ${stats.ld} / DD ${stats.dd} / WL ${stats.wl} / DW ${stats.dw} / WW ${stats.ww}` : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="已完成局数">{stats ? fmtCount(stats.numGames) : '-'}</Descriptions.Item>
                    <Descriptions.Item label="起始局面" span={3}>{startFensView(rs.startFens)}</Descriptions.Item>
                  </Descriptions>
                )
              }
              return <Typography.Text type="secondary">无规格详情</Typography.Text>
            },
            rowExpandable: (j) => !!specOf(j) || !!ratingSpecOf(j),
          }}
        />
      </Card>

      <Card
        size="small"
        title={`Worker 在途任务（${tasks.data?.length ?? 0}）`}
        extra={<Typography.Text type="secondary">worker 经 gRPC GetTask 领取、未上报完成的任务</Typography.Text>}
      >
        <Table<RunningTask>
          rowKey="taskId"
          size="small"
          columns={claimedColumns}
          dataSource={tasks.data ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '无在途任务' }}
        />
      </Card>

      <Card
        size="small"
        title="已完成 / 过期任务"
        extra={
          tstats.data ? (
            <Space size={8}>
              <Tag color="success">completed {tstats.data.counts.completed}</Tag>
              <Tag color="default">expired {tstats.data.counts.expired}</Tag>
              <Typography.Text type="secondary">5s 刷新</Typography.Text>
            </Space>
          ) : null
        }
      >
        <Descriptions column={2} size="small" style={{ marginBottom: 12 }}>
          <Descriptions.Item label="累计完成任务">
            {tstats.data ? tstats.data.counts.completed.toLocaleString() : '-'}
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              任务完成后以 episode 登记，下方为最近上报批次
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="累计过期任务">
            {tstats.data ? tstats.data.counts.expired.toLocaleString() : '-'}
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              超过 deadline 未上报（worker 掉线/卡死）会被置为 expired
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>
        {tstats.data && tstats.data.expired.length > 0 && (
          <>
            <Typography.Paragraph strong style={{ marginBottom: 4, fontSize: 13 }}>
              最近过期明细（≤32 条）
            </Typography.Paragraph>
            <Table<TaskStateStats['expired'][number]>
              rowKey="taskId"
              size="small"
              columns={expiredColumns}
              dataSource={tstats.data.expired}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
          </>
        )}
        <Typography.Paragraph strong style={{ marginBottom: 4, marginTop: 16, fontSize: 13 }}>
          最近完成上报（episode 登记流）
        </Typography.Paragraph>
        <Table<Episode>
          rowKey="id"
          size="small"
          columns={episodeColumns}
          dataSource={episodes.data?.items ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '尚无对局记录登记' }}
          footer={() => (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              完整列表见「对局记录」页；最新登记时间：{episodes.data?.items[0] ? fmtTime(episodes.data.items[0].createdAt) : '-'}
            </Typography.Text>
          )}
        />
      </Card>

      <CreateJobModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => void jobs.reload()} />
    </Space>
  )
}
