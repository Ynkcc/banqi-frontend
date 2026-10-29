import { Alert, Card, Col, Descriptions, Progress, Row, Space, Statistic, Tag, Typography } from 'antd'
import { api } from '../api'
import { fmtAgo } from '../format'
import { usePoll } from '../usePoll'

// 下一候选的导出目标（步数）＝ trainer 节拍 NNUE_MIN_NEW_SAMPLES ×
// NNUE_EXPORT_EVERY_ROUNDS（当前 25000 × 5）。trainer 侧修改节拍后此处同步。
const GENERATION_TARGET_STEPS = 125_000

/** trainer 心跳透传的训练节奏快照（NnueTrainer.progress() 的 JSON） */
interface TrainerProgress {
  round: number
  new_samples: number
  target: number
  pool: number
  last_round_ts: number
  export_every: number
  next_export_round: number
  last_export_ts: number
  baseline_holdout_mse: number | null
  last_gate: { ts: number; mse: number | null; baseline: number | null; blocked: boolean } | null
}

export default function Generation() {
  const { data, error } = usePoll(api.dataStats, 3000)
  const { data: trainers } = usePoll(api.trainers, 3000)

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/data-stats 失败" description={error} />
  }

  const g = data?.generation
  const pct = g ? Math.min(100, Math.round((g.steps / GENERATION_TARGET_STEPS) * 100)) : 0
  // 本代已持续时长（秒）→ 实时产数据速率（步/分钟）
  const elapsedMin = g && g.since > 0 ? Math.max(0.1, (Date.now() / 1000 - g.since) / 60) : 0
  const stepsPerMin = g && g.since > 0 ? g.steps / elapsedMin : 0
  // 按当前速率预计距目标的小时数
  const etaHours = stepsPerMin > 0 ? Math.max(0, (GENERATION_TARGET_STEPS - g!.steps) / stepsPerMin / 60) : 0

  // 取第一个在线 trainer 的节奏快照（TrainerHeartbeat progress_json 透传）
  const tinfo = trainers?.trainers?.find((t) => t.online && t.progress)
  let p: TrainerProgress | null = null
  if (tinfo?.progress) {
    try {
      p = JSON.parse(tinfo.progress) as TrainerProgress
    } catch {
      p = null
    }
  }
  const roundPct = p && p.target > 0 ? Math.min(100, Math.round((p.new_samples / p.target) * 100)) : 0
  // 1 样本 = 1 步：距下一轮训练 ≈ (目标 - 已积累) / 产样速率（分钟）
  const roundEtaMin = p && stepsPerMin > 0 ? Math.max(0, (p.target - p.new_samples) / stepsPerMin) : 0
  // 距下一候选导出 = 剩余轮数 × 每轮目标 / 产样速率（分钟）
  const exportEtaMin =
    p && stepsPerMin > 0
      ? Math.max(0, ((p.next_export_round - p.round) * p.target - p.new_samples) / stepsPerMin)
      : 0

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small" title="本代数据（下一候选的训练集）" extra={<Tag color="processing">3s 刷新</Tag>}>
        <Row gutter={16}>
          <Col span={6}>
            <Card size="small">
              <Statistic title="本代步数" value={g?.steps ?? 0} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="本代局数" value={g?.games ?? 0} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="本代训练批次" value={g?.episodes ?? 0} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="实时速率"
                value={stepsPerMin > 0 ? Math.round(stepsPerMin) : 0}
                suffix="步/分钟"
              />
            </Card>
          </Col>
        </Row>
        <div style={{ marginTop: 16 }}>
          <Progress
            percent={pct}
            status={pct >= 100 ? 'success' : 'active'}
            format={() => `${(g?.steps ?? 0).toLocaleString()} / ${GENERATION_TARGET_STEPS.toLocaleString()} 步`}
          />
          <Typography.Text type="secondary">
            导出目标 = trainer 节拍 25000 新样本/轮 × 5 轮/代（fresh-only：每代只用本代数据，
            导出登记后池清空）。{etaHours > 0 && `按当前速率约 ${etaHours.toFixed(1)} 小时后导出下一候选。`}
          </Typography.Text>
        </div>
      </Card>

      <Card
        size="small"
        title="训练节奏（trainer 心跳）"
        extra={<Tag color={p ? 'success' : 'warning'}>{p ? '在线' : '等待心跳'}</Tag>}
      >
        {!p ? (
          <Typography.Text type="secondary">
            暂无 trainer 节奏数据（trainer 离线或心跳版本过旧，需重启 trainer 生效）。
          </Typography.Text>
        ) : (
          <>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="训练轮次" value={p.round} />
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic title="上一轮训练" value={p.last_round_ts > 0 ? fmtAgo(p.last_round_ts) : '-'} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="下一导出轮次"
                    value={`${p.next_export_round}（每 ${p.export_every} 轮）`}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="上一代导出"
                    value={p.last_export_ts > 0 ? fmtAgo(p.last_export_ts) : '-'}
                  />
                </Card>
              </Col>
            </Row>
            <div style={{ marginTop: 16 }}>
              <Progress
                percent={roundPct}
                status={roundPct >= 100 ? 'success' : 'active'}
                format={() =>
                  `${p.new_samples.toLocaleString()} / ${p.target.toLocaleString()} 新样本（round ${p.round} → ${p.round + 1}）`
                }
              />
              <Typography.Text type="secondary">
                下一轮训练（round {p.round + 1}）：
                {roundPct >= 100
                  ? '条件已满足，正在训练'
                  : roundEtaMin > 0
                    ? `还需约 ${roundEtaMin < 1 ? '<1' : Math.round(roundEtaMin)} 分钟（按当前产样速率）`
                    : '等待产样数据'}
                。下一候选导出（round {p.next_export_round}）：
                {exportEtaMin > 0 ? `约 ${Math.round(exportEtaMin)} 分钟后` : '条件已满足'}；
                导出须过门槛（holdout_mse ≤ 基线
                {p.baseline_holdout_mse != null ? ` ${p.baseline_holdout_mse.toFixed(5)}` : '（首发）'})
                才会登记并触发 gatekeeper。
                {p.last_gate && p.last_gate.mse != null && (
                  <>
                    {' '}最近一次导出判定：
                    <Tag color={p.last_gate.blocked ? 'warning' : 'success'}>
                      {p.last_gate.blocked ? '拦截' : '通过'}
                    </Tag>
                    holdout_mse {p.last_gate.mse.toFixed(5)} vs 基线 {p.last_gate.baseline?.toFixed(5)}
                    （{fmtAgo(p.last_gate.ts)}）。
                  </>
                )}
              </Typography.Text>
            </div>
          </>
        )}
      </Card>

      <Card size="small" title="代际信息">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="本代起点">
            {g && g.since > 0 ? fmtAgo(g.since) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="边界网络（最近导出的候选）">
            <Typography.Text code>{g?.candidate ? g.candidate.slice(0, 16) : '-'}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  )
}
