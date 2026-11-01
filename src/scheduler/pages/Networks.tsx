import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { api } from '../api'
import { fmtTime, shortSha } from '../format'
import type { Network } from '../types'
import { usePoll } from '../usePoll'

const statusColor: Record<string, string> = {
  best: 'green',
  candidate: 'blue',
  archived: 'default',
  rejected: 'red',
}

interface RegisterForm {
  sha: string
  format?: string
  parentSha?: string
  notes?: string
  skipMatch?: boolean
}

export default function Networks() {
  const { message } = App.useApp()
  const { data, error, reload } = usePoll(api.networks, 10000)
  const [busySha, setBusySha] = useState<string>()
  // 手动登记网络（临时上传场景，skipMatch=true 不发起 gatekeeper 对打）
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerBusy, setRegisterBusy] = useState(false)
  const [form] = Form.useForm<RegisterForm>()

  const promote = async (sha: string) => {
    setBusySha(sha)
    try {
      await api.promote(sha)
      message.success(`已晋级 ${shortSha(sha)}`)
      await reload()
    } catch (e) {
      message.error(`晋级失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusySha(undefined)
    }
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
        skipMatch: values.skipMatch,
      })
      if (res.accepted) {
        message.success(
          res.matchTaskHint ? `${res.message}（${res.matchTaskHint}）` : res.message || '已登记',
        )
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
      render: (v: string, row) => (
        <Typography.Text code copyable>
          {row.isBest ? v : shortSha(v)}
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
    { title: '备注', dataIndex: 'notes', render: (v: string) => v || '-' },
    {
      title: '操作',
      width: 120,
      render: (_, row) =>
        row.isBest ? (
          <Tag color="green">best</Tag>
        ) : (
          <Popconfirm
            title={`确认将 ${shortSha(row.sha)} 设为 best？`}
            description="会立即切换 best 指针，selfplay 将改用该网络。"
            okText="确认"
            cancelText="取消"
            onConfirm={() => promote(row.sha)}
          >
            <Button size="small" loading={busySha === row.sha}>
              手动晋级
            </Button>
          </Popconfirm>
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
          键上传到对象存储。勾选「跳过对打」则本次仅登记、不创建 gatekeeper 对打任务。
        </Typography.Paragraph>
        <Form<RegisterForm> form={form} layout="vertical" initialValues={{ format: 'nnue', skipMatch: true }}>
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
          <Form.Item name="skipMatch" valuePropName="checked">
            <Checkbox>跳过对打（skipMatch：仅登记，不创建 gatekeeper 对打任务）</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
