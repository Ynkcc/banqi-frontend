import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Modal,
  Progress,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtAgo, fmtCount, fmtTime, kindTagColor, shortSha } from '../format'
import type { CollectSpecBody, Episode, JobView, PlayerSpec, RunningTask, TaskStateStats } from '../types'
import { usePoll } from '../usePoll'

const EPISODE_LIMIT = 20

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

const specOf = (job: JobView): CollectSpecBody | null =>
  job.kind === 'collect' && job.spec && typeof job.spec === 'object'
    ? (job.spec as CollectSpecBody)
    : null

const seedKindText: Record<string, string> = {
  fixed: 'fixed（固定）',
  random: 'random（随机）',
  incremental: 'incremental（递增）',
  range: 'range（区间）',
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

export default function CollectJobs() {
  const { message } = App.useApp()
  // collect job 清单（持久化，含 running/paused/completed/cancelled 全状态；服务端分页）
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const jobs = usePoll(
    () => api.jobs('collect', undefined, { limit: pageSize, offset: (page - 1) * pageSize }),
    5000,
  )
  // 翻页 / 调整页大小后立即刷新（reload 稳定引用，轮询继续走新参数）
  useEffect(() => {
    void jobs.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize])
  // worker 领取的在途任务（进程内，assigned 态）
  const tasks = usePoll(api.tasks, 5000)
  // 任务状态机快照（completed/expired 计数 + 最近过期明细）
  const tstats = usePoll(api.taskStats, 5000)
  // 最近登记的对局批：collect 任务完成上报的直接产物
  const episodes = usePoll(() => api.episodes(0, EPISODE_LIMIT), 10000)

  const [busyId, setBusyId] = useState<string | null>(null)

  const collectTasks = (tasks.data ?? []).filter((t) => t.kind === 'TASK_COLLECT')
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
        // totalGames = 0：持续型采集（不收敛）
        return (
          <Tooltip title={`持续型 job（无上限）：已下发 ${fmtCount(j.dispatchedGames)}，已完成 ${fmtCount(j.completedGames)}`}>
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
        if (!spec) return <Typography.Text type="secondary">-</Typography.Text>
        return (
          <Space size={4} wrap>
            {playerCell(spec.playerA)}
            <Typography.Text type="secondary">vs</Typography.Text>
            {playerCell(spec.playerB)}
          </Space>
        )
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
      width: 120,
      render: (_, j: JobView) => {
        const spec = specOf(j)
        if (!spec?.scenario) return '-'
        return (
          <Tag color={spec.scenario === 'all_revealed' ? 'gold' : 'blue'}>
            {spec.scenario === 'all_revealed' ? '全明子' : '标准'}
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
        const extra =
          s.kind === 'fixed'
            ? `seed=${s.fixedSeed}`
            : s.kind === 'incremental'
              ? `base=${s.baseSeed}`
              : s.kind === 'range'
                ? `[${s.minSeed}, ${s.maxSeed}]`
                : ''
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
        title={`Collect 任务（共 ${jobs.data?.total ?? 0} 条）`}
        extra={<Typography.Text type="secondary">5s 刷新 · 含运行中/暂停/已完成/已取消 · 服务端分页</Typography.Text>}
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
          locale={{ emptyText: '尚无 collect job（可通过 POST /api/jobs 提交）' }}
          expandable={{
            expandedRowRender: (j) => {
              const spec = specOf(j)
              if (!spec) return <Typography.Text type="secondary">无规格详情</Typography.Text>
              return (
                <Descriptions column={3} size="small" bordered>
                  <Descriptions.Item label="variant">{spec.variant}</Descriptions.Item>
                  <Descriptions.Item label="场景">
                    {spec.scenario === 'all_revealed' ? '全明子（all_revealed）' : '标准（standard）'}
                  </Descriptions.Item>
                  <Descriptions.Item label="数据类别">{spec.dataKind}</Descriptions.Item>
                  <Descriptions.Item label="选手 A">{playerCell(spec.playerA)}</Descriptions.Item>
                  <Descriptions.Item label="选手 B">{playerCell(spec.playerB)}</Descriptions.Item>
                  <Descriptions.Item label="种子策略">{seedKindText[spec.seedStrategy?.kind] ?? spec.seedStrategy?.kind}</Descriptions.Item>
                  <Descriptions.Item label="目标局数">{fmtCount(spec.totalGames)}</Descriptions.Item>
                  <Descriptions.Item label="成对并行">{spec.pairsParallel ? '是' : '否'}</Descriptions.Item>
                  <Descriptions.Item label="成对种子刷新">{spec.pairSeedRefresh ? '是' : '否'}</Descriptions.Item>
                </Descriptions>
              )
            },
            rowExpandable: (j) => !!specOf(j),
          }}
        />
      </Card>

      <Card
        size="small"
        title={`Worker 领取的任务（${collectTasks.length} 在途）`}
        extra={<Typography.Text type="secondary">worker 经 gRPC GetTask 领取、未上报完成的任务</Typography.Text>}
      >
        <Table<RunningTask>
          rowKey="taskId"
          size="small"
          columns={claimedColumns}
          dataSource={collectTasks}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '无在途 collect 任务' }}
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
    </Space>
  )
}
