import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type UsageValue = number | string | null

type SeatRow = {
  seatId: string
  displayName: string
  bizInfo: string
  projectName: string
  usage5h: UsageValue
  usage7d: UsageValue
  usage30d: UsageValue
  effectiveAt: string | null
  effectiveEndAt: string | null
  status: string | null
}

type SeatsResponse = {
  seats: SeatRow[]
  fetchedAt: string
  projectName: string
  bizInfo: string
  rawSeatCount: number
}

type UsagePoint = {
  label: string
  key: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokensHit: number
  reqCnt: number
  imageCount: number
}

type InferenceUsageResponse = {
  hourly: UsagePoint[]
  daily: UsagePoint[]
  weekly: UsagePoint[]
  monthly: UsagePoint[]
  fetchedAt: string
  projectName: string
  metric: string
  range: {
    start: string
    end: string
  }
}

type ModelRow = {
  modelId: string
  displayName: string
  provider: string | null
  contextLength: UsageValue
}

type ModelsResponse = {
  models: ModelRow[]
  fetchedAt: string
  projectName: string
  bizInfo: string
  rawModelCount: number
}

type DashboardData = {
  seats: SeatsResponse
  inferenceUsage: InferenceUsageResponse
  models: ModelsResponse
}

type LoadState =
  | { status: 'loading'; message?: string }
  | { status: 'ready'; data: DashboardData }
  | { status: 'error'; message: string }

type PeriodKey = 'hourly' | 'daily' | 'weekly' | 'monthly'

const usageKeys = ['usage5h', 'usage7d', 'usage30d'] as const

const usageWindowLabels: Record<(typeof usageKeys)[number], string> = {
  usage5h: '近5小时',
  usage7d: '近1周',
  usage30d: '近1月',
}

const columnLabels: Record<(typeof usageKeys)[number], string> = {
  usage5h: '5小时用量',
  usage7d: '近一周用量',
  usage30d: '近一月用量',
}

const periodLabels: Record<PeriodKey, string> = {
  hourly: '时',
  daily: '日',
  weekly: '周',
  monthly: '月',
}

type ModelVendor = {
  key: string
  label: string
  mark: string
}

const modelVendorRules: Array<ModelVendor & { tokens: string[] }> = [
  { key: 'ark', label: 'Volcengine Ark', mark: 'ARK', tokens: ['ark-code', 'ark-'] },
  { key: 'doubao', label: 'Doubao', mark: 'D', tokens: ['doubao', 'seed', 'bytedance', 'volc'] },
  { key: 'deepseek', label: 'DeepSeek', mark: 'DS', tokens: ['deepseek', 'deep-seek'] },
  { key: 'qwen', label: 'Qwen', mark: 'Q', tokens: ['qwen', 'qwq', 'qvq', 'tongyi', 'alibaba'] },
  { key: 'kimi', label: 'Kimi', mark: 'K', tokens: ['kimi', 'moonshot'] },
  { key: 'minimax', label: 'MiniMax', mark: 'M', tokens: ['minimax', 'abab'] },
  { key: 'zhipu', label: 'Zhipu', mark: 'GLM', tokens: ['zhipu', 'glm', 'chatglm'] },
  { key: 'baichuan', label: 'Baichuan', mark: 'BC', tokens: ['baichuan'] },
  { key: 'baidu', label: 'Baidu', mark: 'B', tokens: ['baidu', 'ernie', 'wenxin'] },
  { key: 'tencent', label: 'Tencent', mark: 'T', tokens: ['tencent', 'hunyuan'] },
  { key: 'yi', label: '01.AI', mark: '01', tokens: ['01.ai', 'lingyi', 'yi-'] },
  { key: 'openai', label: 'OpenAI', mark: 'O', tokens: ['openai', 'gpt'] },
  { key: 'anthropic', label: 'Anthropic', mark: 'A', tokens: ['anthropic', 'claude'] },
  { key: 'google', label: 'Google', mark: 'G', tokens: ['google', 'gemini'] },
  { key: 'meta', label: 'Meta', mark: 'M', tokens: ['meta', 'llama'] },
]

const fallbackVendor: ModelVendor = {
  key: 'generic',
  label: 'Model',
  mark: 'AI',
}

function toNumber(value: UsageValue) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toPercent(value: UsageValue) {
  const number = toNumber(value)
  if (number === null) return null
  return Math.max(0, Math.min(100, Math.floor(number)))
}

function formatAverage(seats: SeatRow[], key: (typeof usageKeys)[number]) {
  const values = seats.map((seat) => toNumber(seat[key])).filter((value): value is number => value !== null)
  if (!values.length) return '-'
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return `${Math.floor(average)}%`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatTokenUnit(value: number) {
  return `${formatNumber(value)} tokens`
}

function formatRequestUnit(value: number) {
  return `${formatNumber(value)} 次`
}

function formatMonthDay(value: string) {
  const shortMatch = value.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (shortMatch) return `${Number(shortMatch[1])}月${Number(shortMatch[2])}日`

  const fullMatch = value.match(/^\d{4}[-/](\d{1,2})[-/](\d{1,2})$/)
  if (fullMatch) return `${Number(fullMatch[1])}月${Number(fullMatch[2])}日`

  return value
}

function formatChartDate(value: string, period: PeriodKey, key?: string) {
  if (period === 'hourly') {
    const source = key || value
    const match = source.match(/(?:T|\s)(\d{1,2})(?::\d{2})?/) || value.match(/^(\d{1,2})(?::\d{2})?/)
    if (match) return `${Number(match[1])}时`
  }
  if (period === 'weekly') {
    const rangeMatch = value.match(/^(.+?)\s+-\s+(.+)$/)
    if (rangeMatch) return `${formatMonthDay(rangeMatch[1])} 至 ${formatMonthDay(rangeMatch[2])}`
    return formatMonthDay(value)
  }
  if (period === 'monthly') {
    const source = key || value
    const match = source.match(/^(\d{4})[-/](\d{1,2})/)
    if (match) return `${match[1]}年${Number(match[2])}月`
  }
  if (/^\d{2}\/\d{2}$/.test(value)) {
    const [month, day] = value.split('/')
    return `${Number(month)}月${Number(day)}日`
  }
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(value)) {
    const [, month, day] = value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/) || []
    return `${Number(month)}月${Number(day)}日`
  }
  if (/^\d{4}[-/]\d{2}$/.test(value)) {
    const [, month] = value.match(/^(\d{4})[-/](\d{2})$/) || []
    return `${Number(month)}月`
  }
  return value
}

function formatAxisLabel(value: string, period: PeriodKey, key?: string) {
  const label = formatChartDate(value, period, key)
  if (period === 'weekly') return label.replace(' 至 ', '\n至 ')
  return label
}

function getModelVendor(model: ModelRow): ModelVendor {
  const provider = model.provider?.trim()
  const haystack = [provider, model.displayName, model.modelId].filter(Boolean).join(' ').toLowerCase()
  const matchedVendor = modelVendorRules.find((vendor) => vendor.tokens.some((token) => haystack.includes(token)))

  if (matchedVendor) {
    return {
      key: matchedVendor.key,
      label: provider || matchedVendor.label,
      mark: matchedVendor.mark,
    }
  }

  return {
    ...fallbackVendor,
    label: provider || fallbackVendor.label,
  }
}

function formatDay(value: string | null) {
  if (!value) return '-'
  const normalized = /^\d+$/.test(value) && value.length <= 10 ? Number(value) * 1000 : value
  const date = new Date(normalized)
  if (Number.isNaN(date.valueOf())) return value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

function formatPeriod(start: string | null, end: string | null) {
  const startText = formatDay(start)
  const endText = formatDay(end)
  if (startText === '-' && endText === '-') return '-'
  if (endText === '-') return startText
  if (startText === '-') return endText
  return `${startText} - ${endText}`
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `请求失败：${response.status}`)
  }
  return payload as T
}

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [period, setPeriod] = useState<PeriodKey>('hourly')

  const loadDashboard = useCallback(async () => {
    setState({ status: 'loading', message: '正在同步席位和推理用量' })
    try {
      const [seats, inferenceUsage, models] = await Promise.all([
        fetchJson<SeatsResponse>('/api/seats'),
        fetchJson<InferenceUsageResponse>('/api/inference-usage'),
        fetchJson<ModelsResponse>('/api/models'),
      ])
      setState({ status: 'ready', data: { seats, inferenceUsage, models } })
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '未知错误',
      })
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const summary = useMemo(() => {
    if (state.status !== 'ready') {
      return {
        seats: 0,
        usage5h: '-',
        todayTokens: '-',
        monthTokens: '-',
      }
    }
    const { seats, inferenceUsage } = state.data
    const today = inferenceUsage.daily.at(-1)?.totalTokens ?? 0
    const month = inferenceUsage.monthly.at(-1)?.totalTokens ?? 0

    return {
      seats: seats.seats.length,
      usage5h: formatAverage(seats.seats, 'usage5h'),
      todayTokens: `${formatCompact(today)} Tokens`,
      monthTokens: `${formatCompact(month)} Tokens`,
    }
  }, [state])

  const activeSeries = state.status === 'ready' ? state.data.inferenceUsage[period] : []

  return (
    <div className="app-shell">
      <main className="dashboard-main">
        <header className="topbar">
          <div>
            <h1>火山方舟 Coding Plan 用量统计</h1>
          </div>
          <div className="topbar-actions">
            <button className="btn-primary" type="button" onClick={loadDashboard} disabled={state.status === 'loading'}>
              {state.status === 'loading' ? '同步中' : '刷新'}
            </button>
          </div>
        </header>

        <section className="kpis" aria-label="用量概览">
          <Metric label="有效席位" value={summary.seats} />
          <Metric label="平均近5小时" value={summary.usage5h} />
          <Metric label="今日用量" value={summary.todayTokens} />
          <Metric label="本月用量" value={summary.monthTokens} />
        </section>

        <section className="panel models-panel" aria-label="支持模型列表">
          <div className="panel-title">
            <h2>支持模型列表</h2>
          </div>

          {state.status === 'loading' && <StatusBlock title="正在加载" detail={state.message || '正在读取支持模型'} />}
          {state.status === 'error' && <StatusBlock title="加载失败" detail={state.message} tone="danger" />}
          {state.status === 'ready' && state.data.models.models.length === 0 && (
            <StatusBlock title="暂无模型" detail="ListArkCodingPlanModel 没有返回可展示的模型。" />
          )}
          {state.status === 'ready' && state.data.models.models.length > 0 && (
            <div className="model-grid">
              {state.data.models.models.map((model) => {
                const vendor = getModelVendor(model)

                return (
                  <article className="model-item" key={model.modelId}>
                    <div className="model-heading">
                      <ModelLogo vendor={vendor} />
                      <div className="model-title">
                        <strong>{model.displayName}</strong>
                        <span className="model-provider">{vendor.label}</span>
                      </div>
                    </div>
                    {model.displayName !== model.modelId && <span className="model-id">{model.modelId}</span>}
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="panel usage-panel" id="usage">
          <div className="panel-title">
            <div>
              <h2>推理使用量</h2>
            </div>
            <div className="segmented-control" aria-label="统计周期">
              {(Object.keys(periodLabels) as PeriodKey[]).map((key) => (
                <button
                  key={key}
                  className={period === key ? 'active' : ''}
                  type="button"
                  onClick={() => setPeriod(key)}
                >
                  {periodLabels[key]}
                </button>
              ))}
            </div>
          </div>

          {state.status === 'loading' && <StatusBlock title="正在加载" detail={state.message || '正在读取推理用量'} />}
          {state.status === 'error' && <StatusBlock title="加载失败" detail={state.message} tone="danger" />}
          {state.status === 'ready' && <BarChart points={activeSeries} period={period} />}
        </section>

        <section className="panel seats-panel" id="seats">
          <div className="panel-title">
            <h2>席位用量</h2>
          </div>

          {state.status === 'loading' && <StatusBlock title="正在加载" detail={state.message || '正在读取火山方舟席位接口'} />}
          {state.status === 'error' && <StatusBlock title="加载失败" detail={state.message} tone="danger" />}
          {state.status === 'ready' && state.data.seats.seats.length === 0 && (
            <StatusBlock title="暂无席位" detail="ListSeatInfos 没有返回有效的 Pro 档位席位。" />
          )}
          {state.status === 'ready' && state.data.seats.seats.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>席位/ID</th>
                    {usageKeys.map((key) => (
                      <th key={key}>{columnLabels[key]}</th>
                    ))}
                    <th>套餐生效时间</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.seats.seats.map((seat) => (
                    <tr key={seat.seatId}>
                      <td>
                        <div className="seat-cell">
                          <strong>{seat.seatId}</strong>
                        </div>
                      </td>
                      {usageKeys.map((key) => (
                        <td key={key}>
                          <UsageDial percent={toPercent(seat[key])} label={usageWindowLabels[key]} />
                        </td>
                      ))}
                      <td className="time-cell">{formatPeriod(seat.effectiveAt, seat.effectiveEndAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function Metric({
  label,
  value,
  delta,
  tone = 'neutral',
}: {
  label: string
  value: React.ReactNode
  delta?: string
  tone?: 'neutral' | 'up'
}) {
  return (
    <article className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <div className={`delta ${tone}`}>{delta}</div>}
    </article>
  )
}

function BarChart({ points, period }: { points: UsagePoint[]; period: PeriodKey }) {
  const maxValue = Math.max(...points.map((point) => point.totalTokens), 1)
  const summaryPoint =
    period === 'hourly' ? [...points].reverse().find((point) => point.totalTokens > 0 || point.reqCnt > 0) : points.at(-1)
  const currentTotal = summaryPoint?.totalTokens ?? 0
  const summaryLabels: Record<PeriodKey, string> = {
    hourly: '最近小时Token总用量',
    daily: '今日Token总用量',
    weekly: '本周Token总用量',
    monthly: '本月Token总用量',
  }

  return (
    <div className={`bar-chart period-${period}`} role="img" aria-label={`${periodLabels[period]}推理用量柱状图`}>
      <div className="chart-summary">
        <strong>{formatCompact(currentTotal)}</strong>
        <span>{summaryLabels[period]}</span>
      </div>
      <div className="bar-plot">
        {points.map((point, index) => {
          const height = point.totalTokens > 0 ? Math.max(8, (point.totalTokens / maxValue) * 100) : 2
          const label = formatChartDate(point.label, period, point.key)
          const axisLabel = formatAxisLabel(point.label, period, point.key)
          const edgeClass = index < 2 ? 'edge-start' : index >= points.length - 2 ? 'edge-end' : ''
          return (
            <div className={`bar-item ${edgeClass}`} key={point.key}>
              <div className="bar-column">
                <div className="bar-tooltip">
                  <strong>{label}</strong>
                  <span>总用量：{formatTokenUnit(point.totalTokens)}</span>
                  <span>输入：{formatTokenUnit(point.inputTokens)}</span>
                  <span>输出：{formatTokenUnit(point.outputTokens)}</span>
                  <span>缓存命中：{formatTokenUnit(point.cacheTokensHit)}</span>
                  <span>请求次数：{formatRequestUnit(point.reqCnt)}</span>
                </div>
                <div className="bar-fill" style={{ height: `${height}%` }} />
              </div>
              <span className="bar-label" title={label}>
                {axisLabel}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModelLogo({ vendor }: { vendor: ModelVendor }) {
  return (
    <span className={`model-logo vendor-${vendor.key}`} aria-label={`${vendor.label} logo`} title={vendor.label}>
      {vendor.mark}
    </span>
  )
}

function UsageDial({ percent, label }: { percent: number | null; label: string }) {
  const value = percent ?? 0
  return (
    <div className="usage-dial" aria-label={`${label}用量：${percent === null ? '暂无数据' : `${percent}%`}`}>
      <div className="usage-ring" style={{ '--percent': value } as React.CSSProperties}>
        <span className="usage-ring-value">
          {percent === null ? '-' : percent}
          {percent !== null && <small>%</small>}
        </span>
      </div>
      <span className="usage-label">{label}</span>
    </div>
  )
}

function StatusBlock({ title, detail, tone = 'neutral' }: { title: string; detail: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div className={`status-block ${tone}`}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

createRoot(document.getElementById('app')!).render(<App />)
