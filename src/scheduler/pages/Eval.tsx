import { Alert, App, Button, Card, Descriptions, InputNumber, Modal, Progress, Select, Space, Statistic, Switch, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { api } from '../api'
import { fmtAgo, shortSha } from '../format'
import type { EvalConfig, EvalResult } from '../types'
import { usePoll } from '../usePoll'

/** 全部可选对手（与调度器 ValidateEvalOpponents 白名单一致，顺序即由弱到强） */
const ALL_OPPONENTS = ['random', 'rule:reveal_first', 'rule:capture_first', 'rule:material_expectimax'] as const

/** 对手标识 → 中文名（与 collector 的 rule_opponents.rs / 调度器 eval.go 同一套标识） */
function opponentLabel(spec: string): string {
  switch (spec) {
    case 'random':
      return '随机'
    case 'rule:capture_first':
      return '优先吃子'
    case 'rule:reveal_first':
      return '优先翻棋'
    case 'rule:material_expectimax':
      return '材料 Expectimax（最强标尺）'
    default:
      return spec || '-'
  }
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/**
 * 无依赖的胜率迷你趋势图（不引入图表库）。
 * 纵向跨度固定下限 5pt：全平/微动序列也能看出是「一条平线」而不是被拉伸成锯齿。
 */
function Sparkline({ rates, eps }: { rates: number[]; eps: number }) {
  const w = 260
  const h = 52
  if (rates.length < 2) {
    return <Typography.Text type="secondary">仅 {rates.length} 个版本，暂不成曲线</Typography.Text>
  }
  const min = Math.min(...rates)
  const span = Math.max(Math.max(...rates) - min, 0.05)
  const xy = rates.map((r, i) => {
    const x = (i / (rates.length - 1)) * (w - 8) + 4
    const y = h - 4 - ((r - min) / span) * (h - 8)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const improved = rates[rates.length - 1] - rates[0] >= eps
  return (
    <svg width={w} height={h} role="img" aria-label="胜率趋势">
      <polyline points={xy.join(' ')} fill="none" stroke={improved ? '#52c41a' : '#faad14'} strokeWidth={2} />
    </svg>
  )
}

function noProgressTag(np: number, cfg: EvalConfig) {
  if (cfg.noProgressN <= 0) {
    return <Tag>仅观测（未启用判停）</Tag>
  }
  if (np >= cfg.noProgressN) {
    return <Tag color="red">连续无提升 {np}/{cfg.noProgressN}（已达停机条件）</Tag>
  }
  if (np > 0) {
    return <Tag color="orange">连续无提升 {np}/{cfg.noProgressN}</Tag>
  }
  return <Tag color="green">有提升</Tag>
}

const pointColumns: TableProps<EvalResult>['columns'] = [
  { title: '版本', dataIndex: 'networkSha', render: (v: string) => <Typography.Text code>{shortSha(v)}</Typography.Text> },
  { title: '红胜', dataIndex: 'redWins', width: 70 },
  { title: '黑胜', dataIndex: 'blackWins', width: 70 },
  { title: '未吃子平', dataIndex: 'drawNoCapture', width: 90 },
  { title: '截断平', dataIndex: 'drawTruncation', width: 80 },
  { title: '胜率', dataIndex: 'winRate', width: 90, render: (v: number) => <b>{pct(v)}</b> },
  { title: '步均', dataIndex: 'avgMoves', width: 80, render: (v: number) => v.toFixed(1) },
  { title: '局数', dataIndex: 'numGames', width: 80 },
  { title: '时间', dataIndex: 'createdAt', render: (v: number) => fmtAgo(v) },
]

export default function Eval() {
  const { message } = App.useApp()
  const { data, error, reload } = usePoll(api.eval, 5000)
  const [editing, setEditing] = useState(false)
  const [editOpponents, setEditOpponents] = useState<string[]>([])
  const [editStopWinRate, setEditStopWinRate] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [triggering, setTriggering] = useState(false)

  const openEditor = () => {
    const cfg = data?.config
    setEditOpponents(cfg?.opponents ?? [])
    setEditStopWinRate(cfg ? Math.round(cfg.stopWinRate * 1000) / 10 : 80)
    setEditing(true)
  }

  const saveEditor = async () => {
    setSaving(true)
    try {
      await api.setEvalConfig({
        opponents: editOpponents,
        stopWinRate: editStopWinRate == null ? 0 : editStopWinRate / 100,
      })
      message.success('评估配置已在线更新（落库，跨重启保留）')
      setEditing(false)
      await reload()
    } catch (e) {
      message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const clearOverride = async () => {
    setSaving(true)
    try {
      await api.setEvalConfig({ clear: true })
      message.success('已清除在线覆盖（回落配置文件值）')
      setEditing(false)
      await reload()
    } catch (e) {
      message.error(`清除失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (checked: boolean) => {
    try {
      await api.setEvalConfig({ enabled: checked })
      message.success(checked ? '已启用绝对强度评估（在线覆盖，跨重启保留）' : '已禁用绝对强度评估（在线覆盖，跨重启保留）')
      await reload()
    } catch (e) {
      message.error(`操作失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const clearStop = async () => {
    try {
      await api.control({ clearStop: true })
      message.success('已清除停机标记（训练可继续）')
      await reload()
    } catch (e) {
      message.error(`清除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const triggerNow = async () => {
    setTriggering(true)
    try {
      const res = await api.triggerEval()
      if (res.triggered > 0) {
        message.success(`手动触发成功：${res.message}`)
      } else {
        message.info(res.message)
      }
      await reload()
    } catch (e) {
      message.error(`触发失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTriggering(false)
    }
  }

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/eval 失败" description={error} />
  }

  const cfg = data?.config
  const trends = data?.trends ?? []
  const running = data?.running ?? []

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {running.length > 0 && (
        <Card size="small" title={`进行中评估（${running.length} 个作业）`}>
          {running.map((j) => {
            const done = Math.min(j.numGames, j.targetGames)
            const percent = j.targetGames > 0 ? Math.round((done / j.targetGames) * 100) : 0
            return (
              <div key={`${j.networkSha}:${j.spec}`} style={{ marginBottom: 8 }}>
                <Space size={8} wrap>
                  <Typography.Text code>{shortSha(j.networkSha)}</Typography.Text>
                  <Tag color="blue">{opponentLabel(j.spec)}</Tag>
                  <Typography.Text type="secondary">
                    累计 {done}/{j.targetGames} 局（在飞 {j.inFlight}）
                  </Typography.Text>
                </Space>
                <Progress percent={percent} size="small" status={percent >= 100 ? 'normal' : 'active'} />
              </div>
            )
          })}
        </Card>
      )}

      {data?.shouldStop && (
        <Alert
          type="error"
          showIcon
          message="绝对强度判据已置位停机信号：trainer 将优雅停止"
          description={data.stopReason || '（未提供原因）'}
          action={
            <Button danger onClick={clearStop}>
              清除停机标记（确认续训）
            </Button>
          }
        />
      )}

      {cfg && !cfg.enabled && (
        <Alert
          type="warning"
          showIcon
          message="绝对强度评估未启用"
          description="可通过「评估配置 → 状态」的开关在线启用（跨重启保留），或在配置文件（configs/config.conf）的 [eval] 段设置 enabled = true 并确保 collector 已升级（认识 TASK_EVAL）后重启调度器。"
        />
      )}

      {cfg && (
        <Card
          size="small"
          title="评估配置"
          extra={
            <Space>
              <Button
                size="small"
                type="primary"
                ghost
                onClick={triggerNow}
                loading={triggering}
                disabled={!cfg.enabled}
                title="绕过「每 N 次晋级评测一次」节流，立即为当前 best 补齐缺失评估（已在队/在飞/已有结果的不重复入队）"
              >
                立即评估当前 best
              </Button>
              <Button size="small" onClick={openEditor} disabled={!cfg.enabled}>
                编辑对手与停机目标
              </Button>
            </Space>
          }
        >
          <Descriptions column={3} size="small">
            <Descriptions.Item label="状态">
              <Space size={8}>
                <Switch size="small" checked={cfg.enabled} onChange={toggleEnabled} />
                <Typography.Text type={cfg.enabled ? undefined : 'secondary'}>
                  {cfg.enabled ? '启用' : '已禁用（不再自动评估）'}
                </Typography.Text>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="模式">{cfg.mode}</Descriptions.Item>
            <Descriptions.Item label="每档局数">{cfg.games}</Descriptions.Item>
            <Descriptions.Item label="对手阶梯">
              {cfg.opponents.length === 0 ? (
                <Typography.Text type="secondary">（已清空：不再自动评估）</Typography.Text>
              ) : (
                cfg.opponents.map((o) => <Tag key={o}>{opponentLabel(o)}</Tag>)
              )}
            </Descriptions.Item>
            <Descriptions.Item label="节流">每 {cfg.everyNPromotions} 次晋级评测一次</Descriptions.Item>
            <Descriptions.Item label="停机判据">
              {cfg.noProgressN > 0
                ? `连续 ${cfg.noProgressN} 次提升 < ${(cfg.noProgressEps * 100).toFixed(1)}pt`
                : '关闭（仅观测）'}
            </Descriptions.Item>
            <Descriptions.Item label="达标停机">
              {cfg.stopWinRate > 0
                ? `material_expectimax 胜率 ≥ ${(cfg.stopWinRate * 100).toFixed(0)}%`
                : '关闭'}
            </Descriptions.Item>
            <Descriptions.Item label="待下发任务">{cfg.pending}</Descriptions.Item>
            <Descriptions.Item label="累计评估结果">{data?.latest.length ?? 0}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Modal
        title="编辑评估对手与停机目标"
        open={editing}
        onOk={saveEditor}
        onCancel={() => setEditing(false)}
        confirmLoading={saving}
        okText="保存（在线生效）"
        cancelText="取消"
        footer={[
          <Button key="reset" onClick={clearOverride} disabled={saving}>
            恢复配置文件值
          </Button>,
          <Button key="cancel" onClick={() => setEditing(false)}>
            取消
          </Button>,
          <Button key="save" type="primary" loading={saving} onClick={saveEditor}>
            保存（在线生效）
          </Button>,
        ]}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Typography.Paragraph style={{ marginBottom: 4 }}>
              对手阶梯（顺序无关，按版本触发评估；清空 = 不再自动评估，仅记录历史结果）
            </Typography.Paragraph>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="选择评估对手"
              value={editOpponents}
              onChange={setEditOpponents}
              options={ALL_OPPONENTS.map((o) => ({ value: o, label: opponentLabel(o) }))}
            />
          </div>
          <div>
            <Typography.Paragraph style={{ marginBottom: 4 }}>
              达标停机：material_expectimax 胜率目标（%，0 = 关闭）
            </Typography.Paragraph>
            <InputNumber
              min={0}
              max={100}
              step={1}
              style={{ width: 160 }}
              value={editStopWinRate}
              onChange={(v) => setEditStopWinRate(v)}
              addonAfter="%"
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              保存后落库并即时生效（跨重启保留）；「恢复配置文件值」清除全部在线覆盖。
            </Typography.Paragraph>
          </div>
        </Space>
      </Modal>

      {trends.map((t) => {
        const rates = t.points.map((p) => p.winRate)
        return (
          <Card
            key={t.opponent}
            size="small"
            title={`vs ${opponentLabel(t.opponent)}`}
            extra={cfg ? noProgressTag(t.noProgress, cfg) : null}
          >
            <Space size="large" align="start" wrap>
              <Statistic title="最新胜率" value={pct(t.latestWinRate)} />
              <Statistic title="已评测版本" value={t.versions} />
              <Statistic title="最新网络" value={shortSha(t.points[t.points.length - 1]?.networkSha ?? '')} />
              {cfg && <Sparkline rates={rates} eps={cfg.noProgressEps} />}
            </Space>
            <Table<EvalResult>
              rowKey={(r) => `${r.networkSha}-${r.opponentSpec}`}
              size="small"
              style={{ marginTop: 12 }}
              columns={pointColumns}
              dataSource={t.points}
              pagination={false}
            />
          </Card>
        )
      })}

      <Card size="small" title="最近评估明细">
        <Table<EvalResult>
          rowKey={(r) => `${r.networkSha}-${r.opponentSpec}`}
          size="small"
          columns={[
            { title: '网络', dataIndex: 'networkSha', render: (v: string) => <Typography.Text code>{shortSha(v)}</Typography.Text> },
            { title: '对手', dataIndex: 'opponentSpec', render: (v: string) => opponentLabel(v) },
            { title: '胜率', dataIndex: 'winRate', render: (v: number) => <b>{pct(v)}</b> },
            { title: '红胜', dataIndex: 'redWins' },
            { title: '黑胜', dataIndex: 'blackWins' },
            { title: '未吃子平', dataIndex: 'drawNoCapture' },
            { title: '截断平', dataIndex: 'drawTruncation' },
            { title: '局数', dataIndex: 'numGames' },
            { title: '步均', dataIndex: 'avgMoves', render: (v: number) => v.toFixed(1) },
            { title: '时间', dataIndex: 'createdAt', render: (v: number) => fmtAgo(v) },
          ]}
          dataSource={data?.latest ?? []}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: cfg?.enabled ? '暂无评估结果（等待 best 晋级触发）' : '评估未启用' }}
        />
      </Card>
    </Space>
  )
}
