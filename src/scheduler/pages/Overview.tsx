import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  InputNumber,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtAgo, kindTagColor, shortSha } from '../format'
import type { DataKind, KindStats, Match, RunningTask, TrainerInfo } from '../types'
import { usePoll } from '../usePoll'

const DATA_KIND_OPTIONS = [
  { value: 'resnet' as DataKind, label: 'resnet（Gumbel MCTS 稠密特征）' },
  { value: 'nnue' as DataKind, label: 'nnue（Expectimax 稀疏特征）' },
]

const taskColumns: TableProps<RunningTask>['columns'] = [
  { title: '任务', dataIndex: 'taskId', render: (v: string) => <Typography.Text code>{v.slice(0, 12)}</Typography.Text> },
  {
    title: '类型',
    dataIndex: 'kind',
    render: (v: string) => <Tag color={v === 'TASK_RATING' ? 'gold' : 'blue'}>{v.replace('TASK_', '')}</Tag>,
  },
  { title: 'Worker', dataIndex: 'workerId' },
  { title: '网络', dataIndex: 'networkSha', render: (v: string) => <Typography.Text code>{shortSha(v)}</Typography.Text> },
  { title: '对手', dataIndex: 'opponentSha', render: (v: string) => (v ? <Typography.Text code>{shortSha(v)}</Typography.Text> : '-') },
  { title: '局数', dataIndex: 'games', width: 80 },
  { title: 'Match', dataIndex: 'matchId', width: 90, render: (v: number) => (v > 0 ? v : '-') },
  { title: '下发时间', dataIndex: 'createdAt', render: (v: number) => fmtAgo(v) },
]

const trainerColumns: TableProps<TrainerInfo>['columns'] = [
  {
    title: 'Trainer',
    dataIndex: 'id',
    render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
  },
  {
    title: '状态',
    dataIndex: 'online',
    width: 90,
    render: (v: boolean, t: TrainerInfo) => (
      <Tag color={v ? (t.healthStatus === 'fatal' ? 'red' : t.healthStatus === 'degraded' ? 'orange' : 'green') : 'red'}>
        {v ? (t.healthStatus || 'ok') : '离线'}
      </Tag>
    ),
  },
  { title: '类别', dataIndex: 'dataKind', width: 80, render: (v: string) => <Tag color={v === 'nnue' ? 'purple' : 'blue'}>{v}</Tag> },
  {
    title: '消费进度',
    dataIndex: 'samplesConsumed',
    render: (v: number, t: TrainerInfo) => (
      <span>
        {v.toLocaleString()} 条
        <Typography.Text type="secondary">（水位 #{t.consumedId}）</Typography.Text>
      </span>
    ),
  },
  {
    title: '未消费批',
    width: 100,
    render: (_, t: TrainerInfo) => (
      <span style={{ color: t.unconsumedBatches > 0 ? '#d46b08' : undefined }}>{t.unconsumedBatches}</span>
    ),
  },
  { title: '缓冲', dataIndex: 'buffered', width: 80 },
  { title: '心跳', dataIndex: 'lastSeen', render: (v: number) => fmtAgo(v) },
]

export default function Overview() {
  const { message } = App.useApp()
  const { data, error } = usePoll(api.status, 5000)
  const tasks = usePoll(api.tasks, 5000)
  // SPRT 实时状态与数据流入速率（混合任务形态的核心观测面）
  const matches = usePoll(api.matches, 5000)
  const dstats = usePoll(api.dataStats, 5000)
  // 任务状态机快照（assigned/completed/expired，僵尸任务诊断）
  const tstats = usePoll(api.taskStats, 5000)
  // trainer 消费状态（生成-消费平衡：停滞自动暂停的观测面）
  const trainers = usePoll(api.trainers, 5000)
  const [revealed, setRevealed] = useState<number | null>(null)
  const [kind, setKind] = useState<DataKind | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data && revealed === null) {
      setRevealed(data.initialRevealed)
    }
    if (data && kind === null) {
      setKind(data.dataKind)
    }
  }, [data, revealed, kind])

  const report = (e: unknown) => message.error(`操作失败：${e instanceof Error ? e.message : String(e)}`)

  const setPaused = async (paused: boolean) => {
    setBusy(true)
    try {
      await api.control({ paused })
      message.success(paused ? '已暂停 selfplay（rating 继续）' : '已恢复 selfplay')
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }

  const applyRevealed = async () => {
    if (revealed === null) return
    setBusy(true)
    try {
      await api.control({ initialRevealed: revealed })
      message.success(`课程阶段已切换：initial_revealed_pieces=${revealed}`)
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }

  const applyDataKind = async () => {
    if (kind === null) return
    setBusy(true)
    try {
      await api.control({ dataKind: kind })
      message.success(`数据类别已切换：${kind}（对之后下发的任务生效）`)
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/status 失败" description={error} />
  }

  const counts = data?.counts
  const best = data?.best

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {data?.autoPaused && (
        <Alert
          type="error"
          showIcon
          message="已自动暂停 selfplay 生成（trainer 消费停滞）"
          description={
            <>
              生成-消费平衡（balance）判定训练侧已停止消费：{data.autoPauseReason}
              <br />
              任务派发暂停中（eval 不受影响）；trainer 恢复消费后自动解除。详情见下方「Trainer 消费」。
            </>
          }
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="网络" value={counts?.networks ?? '-'} suffix={counts ? `(${counts.candidates} 候选)` : ''} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="进行中对战" value={counts?.matchesRunning ?? '-'} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="对局记录" value={counts?.episodes ?? '-'} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="累计自对弈局数" value={counts?.episodeGames ?? '-'} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="Worker" value={counts?.workers ?? '-'} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="变体" value={data?.variant ?? '-'} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={10}>
          <Card size="small" title="运行控制">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              {/* wrap 允许控件行在窄窗口换行，长提示独立成行避免撑破卡片 */}
              <Space wrap>
                <Switch checked={data?.paused} disabled={!data || busy} onChange={setPaused} />
                <span>暂停 selfplay</span>
                <Typography.Text type="secondary">暂停后仅下发 rating 任务</Typography.Text>
              </Space>
              <Space wrap>
                <span>初始翻子数</span>
                <InputNumber
                  min={0}
                  max={32}
                  value={revealed}
                  disabled={busy}
                  onChange={(v) => setRevealed(typeof v === 'number' ? v : null)}
                />
                <Button
                  type="primary"
                  loading={busy}
                  disabled={revealed === null || revealed === data?.initialRevealed}
                  onClick={applyRevealed}
                >
                  应用
                </Button>
                <Typography.Text type="secondary">0 = 使用变体默认值</Typography.Text>
              </Space>
              <div>
                <Space wrap>
                  <span>数据类别</span>
                  <Select<DataKind>
                    style={{ width: 'min(280px, 100%)' }}
                    value={kind ?? undefined}
                    options={DATA_KIND_OPTIONS}
                    disabled={busy}
                    onChange={setKind}
                  />
                  <Button
                    type="primary"
                    loading={busy}
                    disabled={kind === null || kind === data?.dataKind}
                    onClick={applyDataKind}
                  >
                    应用
                  </Button>
                </Space>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
                  自对弈产哪类训练数据；nnue 需 collector 具备 Expectimax 采集路径
                </Typography.Paragraph>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card size="small" title="当前 best 网络">
            {best ? (
              <Descriptions column={1} size="small">
                <Descriptions.Item label="sha">
                  <Typography.Text code copyable>
                    {best.sha}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="父网络">{best.parentSha || '-'}</Descriptions.Item>
                <Descriptions.Item label="登记时间">{fmtAgo(best.createdAt)}</Descriptions.Item>
                <Descriptions.Item label="状态">{best.status}</Descriptions.Item>
              </Descriptions>
            ) : (
              <Typography.Text type="secondary">尚未登记任何网络</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          <Card
            size="small"
            title={`SPRT 状态（${matches.data?.filter((m) => m.status === 'running').length ?? 0} 进行中）`}
            extra={<Typography.Text type="secondary">5s 刷新</Typography.Text>}
          >
            <Table<Match>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={matches.data ?? []}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: '无 gatekeeper 对战' }}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 60 },
                {
                  title: '候选',
                  dataIndex: 'candidate',
                  render: (v: string) => <Typography.Text code>{shortSha(v)}</Typography.Text>,
                },
                {
                  title: '对手',
                  dataIndex: 'opponent',
                  render: (v: string) => <Typography.Text code>{shortSha(v)}</Typography.Text>,
                },
                {
                  title: '进度（局）',
                  width: 150,
                  render: (_, m: Match) => (
                    <Progress
                      size="small"
                      percent={m.targetGames > 0 ? Math.min(100, Math.round((m.numGames / (m.targetGames * 2)) * 100)) : 0}
                      format={() => `${m.numGames}/${m.targetGames * 2}`}
                    />
                  ),
                },
                {
                  title: 'LLR',
                  width: 170,
                  render: (_, m: Match) => (
                    <span>
                      {m.llr.toFixed(2)}{' '}
                      <Typography.Text type="secondary">
                        ({m.lower.toFixed(2)}~{m.upper.toFixed(2)})
                      </Typography.Text>
                    </span>
                  ),
                },
                {
                  title: '判定',
                  dataIndex: 'verdict',
                  width: 90,
                  render: (v: string) => (
                    <Tag color={v === 'accept' ? 'green' : v === 'reject' ? 'red' : 'blue'}>{v}</Tag>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card size="small" title="对局记录流入（批 / 局 / 步）">
            <Table<{ kind: string; win: KindStats; w24: KindStats; total: KindStats }>
              rowKey="kind"
              size="small"
              pagination={false}
              locale={{ emptyText: '尚无数据登记' }}
              dataSource={(() => {
                const total = dstats.data?.total ?? {}
                const l1 = dstats.data?.last1h ?? {}
                const l24 = dstats.data?.last24h ?? {}
                const kinds = new Set([...Object.keys(total), ...Object.keys(l1), ...Object.keys(l24)])
                return [...kinds].sort().map((kind) => ({
                  kind,
                  win: l1[kind] ?? { episodes: 0, games: 0, steps: 0 },
                  w24: l24[kind] ?? { episodes: 0, games: 0, steps: 0 },
                  total: total[kind] ?? { episodes: 0, games: 0, steps: 0 },
                }))
              })()}
              columns={[
                {
                  title: '类别',
                  dataIndex: 'kind',
                  width: 80,
                  render: (v: string) => <Tag color={kindTagColor(v)}>{v}</Tag>,
                },
                {
                  title: '近 1h',
                  render: (_, r) => `${r.win.games}局/${r.win.steps}步`,
                },
                {
                  title: '近 24h',
                  render: (_, r) => `${r.w24.games}局/${r.w24.steps}步`,
                },
                {
                  title: '累计',
                  render: (_, r) => `${r.total.games}局/${r.total.steps}步`,
                },
              ]}
            />
            {dstats.data && dstats.data.recent.length > 0 && (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 8, fontSize: 12 }}>
                最近登记：#{dstats.data.recent[0].id} {dstats.data.recent[0].gameCount}局/
                {dstats.data.recent[0].totalSteps}步（{dstats.data.recent[0].dataKind}，{fmtAgo(dstats.data.recent[0].createdAt)}）
              </Typography.Paragraph>
            )}
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="Trainer 消费（生成-消费平衡）"
        extra={
          trainers.data ? (
            <Space size={8}>
              <Tag color={trainers.data.config.enabled ? (trainers.data.config.mode === 'pause' ? 'red' : 'orange') : 'default'}>
                {trainers.data.config.enabled ? `balance: ${trainers.data.config.mode}` : 'balance: off'}
              </Tag>
              {trainers.data.config.pauseReanalysis && <Tag>含 reanalysis</Tag>}
              <Typography.Text type="secondary">5s 刷新</Typography.Text>
            </Space>
          ) : null
        }
      >
        <Table<TrainerInfo>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={trainers.data?.trainers ?? []}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '尚无 trainer 心跳（trainer 需支持 TrainerHeartbeat；balance 未启用时无观测）' }}
          columns={trainerColumns}
        />
        {trainers.data?.trainers.some((t) => t.lastError) && (
          <Typography.Paragraph type="warning" style={{ marginBottom: 0, marginTop: 8, fontSize: 12 }}>
            {trainers.data.trainers
              .filter((t) => t.lastError)
              .map((t) => `${t.id}: ${t.lastError}`)
              .join('；')}
          </Typography.Paragraph>
        )}
      </Card>

      <Card
        size="small"
        title={`进行中任务（进程内，${tasks.data?.length ?? 0}）`}
        extra={
          tstats.data ? (
            <Space size={8}>
              <Tag color="processing">assigned {tstats.data.counts.assigned}</Tag>
              <Tag color="success">completed {tstats.data.counts.completed}</Tag>
              <Tag color="default">expired {tstats.data.counts.expired}</Tag>
              {tstats.data.oldestAssignedAgeSeconds > 0 && (
                <Typography.Text type="secondary">
                  最老在途 {Math.round(tstats.data.oldestAssignedAgeSeconds / 60)} 分钟
                </Typography.Text>
              )}
            </Space>
          ) : null
        }
      >
        <Table<RunningTask>
          rowKey="taskId"
          size="small"
          columns={taskColumns}
          dataSource={tasks.data ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '无进行中任务' }}
        />
      </Card>
    </Space>
  )
}
