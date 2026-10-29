import { Alert, App, Button, Card, Input, Modal, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { api } from '../api'
import { fmtAgo, fmtCount, fmtMemory } from '../format'
import type { RunningTask, WorkerInfo } from '../types'
import { usePoll } from '../usePoll'

// 角色判定：trainer 心跳 id 形如 "nnue-trainer-<uuid>" / "trainer-<pid>"，
// collector 为 uuid 或 "worker-<pid>"——用 includes('trainer') 判定，
// startsWith('trainer-') 会把 nnue-trainer-* 误标为 collector。
const isTrainer = (id: string) => id.includes('trainer')

export default function Workers() {
  const { message } = App.useApp()
  const { data, error, reload } = usePoll(api.workers, 5000)
  // 进行中任务按 worker 分组（workerId 与心跳 id 同源），驱动"当前任务"列
  const tasks = usePoll(api.tasks, 5000)
  const taskByWorker = new Map((tasks.data ?? []).map((t) => [t.workerId, t]))

  // 备注编辑：目标 worker + 草稿文本（轮询只刷新快照，不覆盖正在编辑的草稿）
  const [noteTarget, setNoteTarget] = useState<WorkerInfo | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  const openNote = (w: WorkerInfo) => {
    setNoteTarget(w)
    setNoteDraft(w.note ?? '')
  }
  const closeNote = () => setNoteTarget(null)
  const saveNote = async () => {
    if (!noteTarget) return
    try {
      setNoteSaving(true)
      await api.setWorkerNote(noteTarget.id, noteDraft.trim())
      message.success(`worker ${noteTarget.id} 备注已保存`)
      setNoteTarget(null)
      void reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setNoteSaving(false)
    }
  }

  const workers = data ?? []
  const onlineCollectors = workers.filter((w) => w.online && !isTrainer(w.id))
  // 在线 collector 合计估算产能：各 worker 稳态速率之和（局/h）
  const totalEst = onlineCollectors.reduce((sum, w) => sum + w.estGamesPerHour, 0)
  const totalGames1h = onlineCollectors.reduce((sum, w) => sum + w.games1h, 0)

  const kindTag = (t?: RunningTask) => {
    if (!t) return <Typography.Text type="secondary">-</Typography.Text>
    const kind = t.kind.replace('TASK_', '')
    const color =
      kind === 'RATING' ? 'gold' : kind === 'SELFPLAY' ? 'blue' : kind === 'REANALYSIS' ? 'cyan' : 'purple'
    return (
      <Space size={4}>
        <Tag color={color}>{kind}</Tag>
        {t.matchId > 0 && <Typography.Text type="secondary">M{t.matchId}</Typography.Text>}
      </Space>
    )
  }

  const columns: TableProps<WorkerInfo>['columns'] = [
    {
      title: '角色',
      dataIndex: 'id',
      width: 110,
      render: (_: string, w: WorkerInfo) =>
        isTrainer(w.id) ? <Tag color="purple">trainer</Tag> : <Tag color="blue">collector</Tag>,
    },
    {
      title: 'worker',
      dataIndex: 'id',
      ellipsis: true,
      render: (id: string, w: WorkerInfo) =>
        w.note ? (
          <Space size={6}>
            <Typography.Text strong>{w.note}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {id}
            </Typography.Text>
          </Space>
        ) : (
          id
        ),
    },
    {
      title: '当前任务',
      key: 'currentTask',
      width: 190,
      render: (_: unknown, w: WorkerInfo) => kindTag(taskByWorker.get(w.id)),
    },
    {
      title: '健康',
      key: 'health',
      width: 100,
      render: (_: unknown, w: WorkerInfo) => {
        // 进程内健康状态（trainer/collector 心跳上报）：致命红、降级橙、正常绿；
        // 悬浮显示最近错误摘要——把「翻日志才能发现的问题」变成首屏可见
        const hs = w.healthStatus || 'ok'
        if (hs === 'degraded') {
          return (
            <Tooltip title={w.lastError || 'degraded'}>
              <Tag color="orange">degraded</Tag>
            </Tooltip>
          )
        }
        if (hs === 'fatal') {
          return (
            <Tooltip title={w.lastError || 'fatal'}>
              <Tag color="red">fatal</Tag>
            </Tooltip>
          )
        }
        return <Tag color="green">ok</Tag>
      },
    },
    {
      title: '近1h产出',
      key: 'games1h',
      width: 120,
      render: (_: unknown, w: WorkerInfo) =>
        isTrainer(w.id) ? (
          <Typography.Text type="secondary">-</Typography.Text>
        ) : (
          <Space size={4}>
            {fmtCount(w.games1h)} 局
            <Typography.Text type="secondary">{w.episodes1h} 批</Typography.Text>
          </Space>
        ),
    },
    {
      title: '近24h产出',
      key: 'games24h',
      width: 120,
      render: (_: unknown, w: WorkerInfo) =>
        isTrainer(w.id) ? (
          <Typography.Text type="secondary">-</Typography.Text>
        ) : (
          <Tooltip title={`${w.episodes24h} 批对局记录`}>
            {fmtCount(w.games24h)} 局
          </Tooltip>
        ),
    },
    {
      title: '估算效率',
      key: 'estRate',
      width: 140,
      render: (_: unknown, w: WorkerInfo) => {
        if (isTrainer(w.id) || w.estGamesPerHour <= 0) {
          return <Typography.Text type="secondary">-</Typography.Text>
        }
        return (
          <Tooltip
            title={`按最近 ${w.estSamples} 批对局记录的间隔推算稳态速率（平滑批次间歇与任务切换），实测口径见左侧产出列`}
          >
            {w.estGamesPerHour.toFixed(0)} 局/h
          </Tooltip>
        )
      },
    },
    {
      title: '备注',
      key: 'note',
      width: 150,
      render: (_: unknown, w: WorkerInfo) => (
        <Space size={4}>
          {w.note ? (
            <Typography.Text ellipsis style={{ maxWidth: 96 }}>
              {w.note}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          )}
          <Button type="text" size="small" onClick={() => openNote(w)}>
            编辑
          </Button>
        </Space>
      ),
    },
    {
      title: '在线',
      dataIndex: 'online',
      width: 90,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '在线' : '离线'}</Tag>,
    },
    { title: '最后心跳', dataIndex: 'lastSeen', width: 120, render: (v: number) => fmtAgo(v) },
    { title: '线程', dataIndex: 'threads', width: 70 },
    { title: '可用内存', dataIndex: 'memoryMb', width: 110, render: (v: number) => fmtMemory(v) },
    {
      title: '累计局数',
      dataIndex: 'completedGames',
      width: 110,
      render: (v: number) => fmtCount(v),
    },
    {
      title: '版本',
      dataIndex: 'clientVersion',
      render: (v: string) => v || <Typography.Text type="secondary">-</Typography.Text>,
    },
  ]

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/workers 失败" description={error} />
  }

  return (
    <Card
      size="small"
      title={`Worker（${onlineCollectors.length} collector 在线 / ${workers.length} 总计 · 估算 ${Math.round(totalEst)} 局/h · 近1h 实测 ${fmtCount(totalGames1h)} 局）`}
    >
      <Table<WorkerInfo> rowKey="id" size="small" columns={columns} dataSource={workers} pagination={false} />

      <Modal
        title={`备注：${noteTarget?.id ?? ''}`}
        open={noteTarget !== null}
        onOk={saveNote}
        onCancel={closeNote}
        confirmLoading={noteSaving}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          maxLength={64}
          placeholder="如：3080-主机 / 实验室-02（留空清除）"
          onPressEnter={saveNote}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          备注仅存于调度器侧，心跳上报不会覆盖；worker 列会优先显示备注名。
        </Typography.Text>
      </Modal>
    </Card>
  )
}
