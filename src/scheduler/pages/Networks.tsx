import Alert from 'antd/es/alert'
import App from 'antd/es/app'
import Button from 'antd/es/button'
import Card from 'antd/es/card'
import Form from 'antd/es/form'
import Input from 'antd/es/input'
import Modal from 'antd/es/modal'
import Select from 'antd/es/select'
import Space from 'antd/es/space'
import Table from 'antd/es/table'
import Tag from 'antd/es/tag'
import Typography from 'antd/es/typography'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { api } from '../api'
import { fmtTime, shortSha } from '../format'
import type { Network } from '../types'
import { usePoll } from '../usePoll'

const statusColor: Record<string, string> = {
  candidate: 'blue',
  archived: 'default',
  rejected: 'red',
}

interface RegisterForm {
  sha: string
  format?: string
  parentSha?: string
  notes?: string
}

export default function Networks() {
  const { message } = App.useApp()
  const { data, error, reload } = usePoll(api.networks, 10000)
  // 手动登记网络（文件本体可经 POST /api/networks/upload 预签名 PUT 上传，或已存在于对象存储）
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerBusy, setRegisterBusy] = useState(false)
  const [form] = Form.useForm<RegisterForm>()

  /** 触发浏览器下载：走调度器同源代理端点（服务端预签名拉取对象存储），
   *  规避浏览器直连存储端点的系统代理 502 与 HTTP 明文下载告警 */
  const download = (n: Network) => {
    const a = document.createElement('a')
    a.href = `/api/networks/${encodeURIComponent(n.sha)}/download/file`
    a.download = `${n.sha}.${n.format ?? ''}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const register = async () => {
    const values = await form.validateFields()
    setRegisterBusy(true)
    try {
      const res = await api.registerNetwork({
        sha: values.sha.trim(),
        format: values.format,
        parentSha: values.parentSha?.trim() || undefined,
        notes: values.notes?.trim() || undefined,
      })
      if (res.accepted) {
        message.success(res.message || '已登记')
        setRegisterOpen(false)
        form.resetFields()
        await reload()
      } else {
        message.warning(`未接受：${res.message}`)
      }
    } catch (e) {
      message.error(`登记失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRegisterBusy(false)
    }
  }

  const columns: TableProps<Network>['columns'] = [
    {
      title: 'sha',
      dataIndex: 'sha',
      render: (v: string) => (
        <Typography.Text code copyable>
          {shortSha(v)}
        </Typography.Text>
      ),
    },
    { title: '父网络', dataIndex: 'parentSha', render: (v: string) => shortSha(v) },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v: string) => <Tag color={statusColor[v] ?? 'default'}>{v}</Tag>,
    },
    { title: '登记时间', dataIndex: 'createdAt', render: (v: number) => fmtTime(v) },
    { title: '格式', dataIndex: 'format', render: (v: string) => v || '-' },
    { title: '备注', dataIndex: 'notes', render: (v: string) => v || '-' },
    {
      key: 'actions',
      title: '操作',
      render: (_: unknown, n: Network) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => download(n)}>
            下载
          </Button>
        </Space>
      ),
    },
  ]

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/networks 失败" description={error} />
  }

  return (
    <Card
      size="small"
      title={`网络（${data?.length ?? 0}）`}
      extra={
        <Button type="primary" size="small" onClick={() => setRegisterOpen(true)}>
          手动登记网络
        </Button>
      }
    >
      <Table<Network> rowKey="sha" size="small" columns={columns} dataSource={data ?? []} pagination={false} />
      <Modal
        title="手动登记网络"
        open={registerOpen}
        confirmLoading={registerBusy}
        okText="登记"
        cancelText="取消"
        onOk={register}
        onCancel={() => setRegisterOpen(false)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          等价 gRPC RegisterNetwork（POST /api/networks）。网络文件需已按
          <Typography.Text code>{' {sha}.{format} '}</Typography.Text>
          键上传到对象存储（可先调 POST /api/networks/upload 获取预签名 PUT URL 上传）。
          登记后即可在 collect / rating job 中以该 sha 引用。
        </Typography.Paragraph>
        <Form<RegisterForm> form={form} layout="vertical" initialValues={{ format: 'nnue' }}>
          <Form.Item
            name="sha"
            label="sha（64 位 hex）"
            rules={[
              { required: true, message: '请输入网络 sha' },
              { pattern: /^[0-9a-fA-F]{64}$/, message: '必须是 64 位 hex' },
            ]}
          >
            <Input placeholder="网络文件 sha256" allowClear />
          </Form.Item>
          <Form.Item name="format" label="格式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'nnue', label: 'nnue' },
                { value: 'onnx', label: 'onnx' },
                { value: 'pt', label: 'pt' },
              ]}
            />
          </Form.Item>
          <Form.Item name="parentSha" label="父网络 sha（可选）">
            <Input placeholder="留空表示无父网络" allowClear />
          </Form.Item>
          <Form.Item name="notes" label="备注（可选）">
            <Input placeholder="例如：手动临时上传" allowClear />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
