import Alert from 'antd/es/alert'
import App from 'antd/es/app'
import Button from 'antd/es/button'
import Card from 'antd/es/card'
import Checkbox from 'antd/es/checkbox'
import Dropdown from 'antd/es/dropdown'
import Input from 'antd/es/input'
import Modal from 'antd/es/modal'
import Popconfirm from 'antd/es/popconfirm'
import Space from 'antd/es/space'
import Table from 'antd/es/table'
import Tag from 'antd/es/tag'
import Tooltip from 'antd/es/tooltip'
import Typography from 'antd/es/typography'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtAgo, fmtCount, fmtMemory } from '../format'
import type { RunningTask, WorkerInfo } from '../types'
import { usePoll } from '../usePoll'

// 角色判定：trainer 心跳 id 形如 "nnue-trainer-<uuid>" / "trainer-<pid>"，
// collector 为 uuid 或 "worker-<pid>"——用 includes('trainer') 判定，
// startsWith('trainer-') 会把 nnue-trainer-* 误标为 collector。
const isTrainer = (id: string) => id.includes('trainer')

/** 列宽 / 列隐藏的 localStorage 持久化 key（仅本机生效，服务端不感知） */
const LS_WIDTH_KEY = 'banqi.workers.colWidths'
const LS_HIDDEN_KEY = 'banqi.workers.hiddenCols'
const MIN_COL_WIDTH = 60

interface ColDef {
  key: string
  title: string
  width?: number
}

/** 所有列的元信息（默认宽度 + 显示名），供列隐藏菜单与宽度持久化使用 */
const COL_DEFS: ColDef[] = [
  { key: 'role', title: '角色', width: 110 },
  { key: 'id', title: 'worker', width: 220 },
  { key: 'ip', title: 'IP', width: 130 },
  { key: 'currentTask', title: '当前任务', width: 190 },
  { key: 'health', title: '健康', width: 100 },
  { key: 'games1h', title: '近1h产出', width: 120 },
  { key: 'games24h', title: '近24h产出', width: 120 },
  { key: 'estRate', title: '估算效率', width: 140 },
  { key: 'note', title: '备注', width: 150 },
  { key: 'online', title: '在线', width: 90 },
  { key: 'lastSeen', title: '最后心跳', width: 120 },
  { key: 'threads', title: '线程', width: 70 },
  { key: 'memoryMb', title: '可用内存', width: 110 },
  { key: 'completedGames', title: '累计局数', width: 110 },
  { key: 'clientVersion', title: '版本', width: 120 },
  { key: 'actions', title: '操作', width: 80 },
]

type Widths = Record<string, number>

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级
  }
}

/** 可拖拽调宽的表头单元格（右缘 6px 命中区，pointer capture 拖拽） */
function ResizableTitle(
  props: React.ThHTMLAttributes<HTMLTableCellElement> & {
    resizable?: boolean
    onResizeStart?: (e: React.PointerEvent<HTMLSpanElement>) => void
  },
) {
  const { resizable, onResizeStart, style, children, ...rest } = props
  return (
    <th {...rest} style={{ position: 'relative', ...style }}>
      {children}
      {resizable && (
        <span
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 6,
            height: '100%',
            cursor: 'col-resize',
            userSelect: 'none',
            touchAction: 'none',
          }}
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onResizeStart?.(e)
          }}
        />
      )}
    </th>
  )
}

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

  // 删除离线 worker（调度器拒绝删除在线 worker）
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deleteWorker = async (w: WorkerInfo) => {
    try {
      setDeletingId(w.id)
      await api.deleteWorker(w.id)
      message.success(`worker ${w.id} 已删除`)
      void reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingId(null)
    }
  }

  // —— 列宽调整 / 列隐藏（仅前端，localStorage 持久化）——
  const [widths, setWidths] = useState<Widths>(() => loadLS(LS_WIDTH_KEY, {}))
  const [hiddenCols, setHiddenCols] = useState<string[]>(() =>
    loadLS<string[]>(LS_HIDDEN_KEY, []),
  )
  useEffect(() => saveLS(LS_WIDTH_KEY, widths), [widths])
  useEffect(() => saveLS(LS_HIDDEN_KEY, hiddenCols), [hiddenCols])

  const toggleCol = (key: string) =>
    setHiddenCols((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  // 至少保留一列可见，避免全部隐藏后表格消失
  const allHidden = hiddenCols.length >= COL_DEFS.length

  const colWidth = (key: string) =>
    widths[key] ?? COL_DEFS.find((c) => c.key === key)?.width
  const startResize = (e: React.PointerEvent<HTMLSpanElement>, key: string, width: number) => {
    const el = e.currentTarget
    const startX = e.clientX
    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(MIN_COL_WIDTH, width + (ev.clientX - startX))
      setWidths((prev) => ({ ...prev, [key]: next }))
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
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
      kind === 'RATING'
        ? 'gold'
        : kind === 'COLLECT'
          ? 'magenta'
          : kind === 'SELFPLAY'
            ? 'blue'
            : kind === 'REANALYSIS'
              ? 'cyan'
              : 'purple'
    return (
      <Space size={4}>
        <Tag color={color}>{kind}</Tag>
        {t.matchId > 0 && <Typography.Text type="secondary">M{t.matchId}</Typography.Text>}
      </Space>
    )
  }

  const baseColumns: TableProps<WorkerInfo>['columns'] = [
    {
      key: 'role',
      title: '角色',
      dataIndex: 'id',
      width: colWidth('role'),
      render: (_: string, w: WorkerInfo) =>
        isTrainer(w.id) ? <Tag color="purple">trainer</Tag> : <Tag color="blue">collector</Tag>,
    },
    {
      key: 'id',
      title: 'worker',
      dataIndex: 'id',
      width: colWidth('id'),
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
      key: 'ip',
      title: 'IP',
      dataIndex: 'ip',
      width: colWidth('ip'),
      render: (v?: string) =>
        v ? (
          <Typography.Text copyable={{ text: v }} style={{ fontSize: 12 }}>
            {v}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      key: 'currentTask',
      title: '当前任务',
      width: colWidth('currentTask'),
      render: (_: unknown, w: WorkerInfo) => kindTag(taskByWorker.get(w.id)),
    },
    {
      key: 'health',
      title: '健康',
      width: colWidth('health'),
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
      key: 'games1h',
      title: '近1h产出',
      width: colWidth('games1h'),
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
      key: 'games24h',
      title: '近24h产出',
      width: colWidth('games24h'),
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
      key: 'estRate',
      title: '估算效率',
      width: colWidth('estRate'),
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
      key: 'note',
      title: '备注',
      width: colWidth('note'),
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
      key: 'online',
      title: '在线',
      dataIndex: 'online',
      width: colWidth('online'),
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '在线' : '离线'}</Tag>,
    },
    {
      key: 'lastSeen',
      title: '最后心跳',
      dataIndex: 'lastSeen',
      width: colWidth('lastSeen'),
      render: (v: number) => fmtAgo(v),
    },
    {
      key: 'threads',
      title: '线程',
      dataIndex: 'threads',
      width: colWidth('threads'),
    },
    {
      key: 'memoryMb',
      title: '可用内存',
      dataIndex: 'memoryMb',
      width: colWidth('memoryMb'),
      render: (v: number) => fmtMemory(v),
    },
    {
      key: 'completedGames',
      title: '累计局数',
      dataIndex: 'completedGames',
      width: colWidth('completedGames'),
      render: (v: number) => fmtCount(v),
    },
    {
      key: 'clientVersion',
      title: '版本',
      dataIndex: 'clientVersion',
      width: colWidth('clientVersion'),
      render: (v: string) => v || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      key: 'actions',
      title: '操作',
      width: colWidth('actions'),
      render: (_: unknown, w: WorkerInfo) =>
        w.online ? null : (
          <Popconfirm
            title="删除离线 worker？"
            description={w.id}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: deletingId === w.id }}
            onConfirm={() => void deleteWorker(w)}
          >
            <Button danger type="text" size="small">
              删除
            </Button>
          </Popconfirm>
        ),
    },
  ]

  // 过滤隐藏列后，为每列接上表头拖拽调宽（onHeaderCell → ResizableTitle）
  const columns = baseColumns
    .filter((c) => !hiddenCols.includes(String(c.key)))
    .map((c) => {
      const key = String(c.key)
      const width = colWidth(key)
      return {
        ...c,
        width,
        onHeaderCell: () => ({
          width,
          resizable: true,
          onResizeStart: (e: React.PointerEvent<HTMLSpanElement>) =>
            startResize(e, key, width ?? MIN_COL_WIDTH),
        }),
      }
    })

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/workers 失败" description={error} />
  }

  return (
    <Card
      size="small"
      title={`Worker（${onlineCollectors.length} collector 在线 / ${workers.length} 总计 · 估算 ${Math.round(totalEst)} 局/h · 近1h 实测 ${fmtCount(totalGames1h)} 局）`}
      extra={
        <Dropdown
          trigger={['click']}
          menu={{
            items: COL_DEFS.map((c) => ({
              key: c.key,
              label: (
                <span style={{ userSelect: 'none' }}>
                  <Checkbox
                    checked={!hiddenCols.includes(c.key)}
                    disabled={allHidden && !hiddenCols.includes(c.key)}
                    onChange={() => toggleCol(c.key)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.title}
                  </Checkbox>
                </span>
              ),
            })),
          }}
        >
          <Button size="small">列</Button>
        </Dropdown>
      }
    >
      <Table<WorkerInfo>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={workers}
        pagination={false}
        scroll={{ x: 'max-content' }}
        components={{ header: { cell: ResizableTitle } }}
      />

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
