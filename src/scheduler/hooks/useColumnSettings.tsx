import Button from 'antd/es/button'
import Dropdown from 'antd/es/dropdown'
import type { MenuProps, TableColumnType, TableProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ThHTMLAttributes } from 'react'

type ColumnsOf<T> = NonNullable<TableProps<T>['columns']>

const MIN_WIDTH = 60
const DEFAULT_WIDTH = 150
const RESET_KEY = '__reset__'

interface PersistedState {
  widths: Record<string, number>
  hidden: string[]
}

function loadState(storageKey: string): PersistedState {
  try {
    const raw = window.localStorage.getItem(`${storageKey}::columns`)
    if (!raw) return { widths: {}, hidden: [] }
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      widths: typeof parsed.widths === 'object' && parsed.widths != null ? parsed.widths : {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    }
  } catch {
    return { widths: {}, hidden: [] }
  }
}

/** 稳定列 key：key > dataIndex > title > 序号 */
function columnKey(col: unknown, index: number): string {
  const c = col as TableColumnType<unknown>
  if (c.key != null) return String(c.key)
  const di = (c as { dataIndex?: unknown }).dataIndex
  if (typeof di === 'string') return di
  if (Array.isArray(di)) return di.join('.')
  if (typeof c.title === 'string') return c.title
  return `col-${index}`
}

type HeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  resizable?: boolean
  onResizeStart?: (e: ReactMouseEvent<HTMLElement>) => void
}

/** 表头单元格：在右缘渲染拖拽手柄 */
export function ResizableHeaderCell({ resizable, onResizeStart, style, children, ...rest }: HeaderCellProps) {
  return (
    <th {...rest} style={{ ...style, position: 'relative' }}>
      {children}
      {resizable && onResizeStart && (
        <span
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: -3,
            width: 7,
            cursor: 'col-resize',
            zIndex: 2,
          }}
          onMouseDown={onResizeStart}
        />
      )}
    </th>
  )
}

/** 与 Table 的 components prop 配合使用，启用列宽拖拽 */
export const resizableHeader = { header: { cell: ResizableHeaderCell } }

/**
 * 列设置 hook：列宽可拖拽调整、列可隐藏，并持久化到 localStorage。
 * 返回过滤/加权后的 columns 以及"列设置"下拉节点。
 */
export function useColumnSettings<T extends object>(storageKey: string, base: TableProps<T>['columns']) {
  const list: ColumnsOf<T> = base ?? []
  const [widths, setWidths] = useState<Record<string, number>>(() => loadState(storageKey).widths)
  const [hidden, setHidden] = useState<string[]>(() => loadState(storageKey).hidden)

  useEffect(() => {
    try {
      window.localStorage.setItem(`${storageKey}::columns`, JSON.stringify({ widths, hidden }))
    } catch {
      // 忽略持久化失败
    }
  }, [storageKey, widths, hidden])

  const keys = useMemo(() => list.map((col, i) => columnKey(col, i)), [list])

  const startResize = (key: string, e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const col = list[keys.indexOf(key)] as TableColumnType<unknown> | undefined
    const startWidth = widths[key] ?? (col && typeof col.width === 'number' ? col.width : DEFAULT_WIDTH)
    const startX = e.clientX
    const move = (ev: MouseEvent) => {
      const w = Math.max(MIN_WIDTH, startWidth + ev.clientX - startX)
      setWidths((prev) => ({ ...prev, [key]: w }))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  const columns = useMemo<ColumnsOf<T>>(
    () =>
      list
        .map((col, i) => ({ col, key: keys[i] }))
        .filter(({ key }) => !hidden.includes(key))
        .map(({ col, key }) => {
          const c = col as unknown as TableColumnType<T>
          return {
            ...c,
            key,
            width: widths[key] ?? (typeof c.width === 'number' ? c.width : DEFAULT_WIDTH),
            onHeaderCell: () =>
              ({
                resizable: true,
                onResizeStart: (e: ReactMouseEvent<HTMLElement>) => startResize(key, e),
              }) as ThHTMLAttributes<HTMLTableCellElement>,
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, keys, hidden, widths],
  )

  const visibleCount = list.length - hidden.length

  const toggle = (key: string) => {
    setHidden((prev) => {
      const isVisible = !prev.includes(key)
      // 至少保留一列
      if (isVisible && visibleCount <= 1) return prev
      return isVisible ? [...prev, key] : prev.filter((k) => k !== key)
    })
  }

  const items: MenuProps['items'] = [
    ...list.map((col, i) => {
      const title = (col as unknown as TableColumnType<unknown>).title
      return { key: keys[i], label: typeof title === 'string' ? title : `第 ${i + 1} 列` }
    }),
    { type: 'divider' },
    { key: RESET_KEY, label: '重置列设置' },
  ]

  const settings = (
    <Dropdown
      menu={{
        items,
        multiple: true,
        selectedKeys: keys.filter((k) => !hidden.includes(k)),
        onClick: ({ key }) => {
          if (key === RESET_KEY) {
            setWidths({})
            setHidden([])
            return
          }
          toggle(key)
        },
      }}
      trigger={['click']}
    >
      <Button size="small">列设置</Button>
    </Dropdown>
  )

  return { columns, settings }
}
