import { Layout, Menu } from 'antd'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Episodes from './pages/Episodes'
import Generation from './pages/Generation'
import Matches from './pages/Matches'
import Networks from './pages/Networks'
import Overview from './pages/Overview'
import Replay from './pages/Replay'
import Storage from './pages/Storage'
import TrainConfig from './pages/TrainConfig'
import Workers from './pages/Workers'
import CollectJobs from './pages/CollectJobs'

const menuItems = [
  { key: '/', label: <Link to="/">总览</Link> },
  { key: '/collect', label: <Link to="/collect">Collect 任务</Link> },
  { key: '/networks', label: <Link to="/networks">网络</Link> },
  { key: '/matches', label: <Link to="/matches">对战 / SPRT</Link> },
  { key: '/train-config', label: <Link to="/train-config">训练超参</Link> },
  { key: '/storage', label: <Link to="/storage">存储</Link> },
  { key: '/workers', label: <Link to="/workers">Worker</Link> },
  { key: '/episodes', label: <Link to="/episodes">对局记录</Link> },
  { key: '/generation', label: <Link to="/generation">本代数据</Link> },
  { key: '/replay', label: <Link to="/replay">对局回放</Link> },
]

export default function App() {
  const { pathname } = useLocation()
  const selected = menuItems.some((item) => item.key === pathname) ? pathname : '/'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="dark" width={208}>
        <div className="brand">banqi scheduler</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={menuItems} />
      </Layout.Sider>
      <Layout>
        <Layout.Content style={{ padding: 24 }}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/collect" element={<CollectJobs />} />
            <Route path="/networks" element={<Networks />} />
            <Route path="/matches" element={<Matches />} />
            <Route path="/train-config" element={<TrainConfig />} />
            <Route path="/storage" element={<Storage />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/episodes" element={<Episodes />} />
            <Route path="/replay" element={<Replay />} />
            <Route path="/generation" element={<Generation />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
