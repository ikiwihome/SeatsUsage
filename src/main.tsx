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

type DashboardData = {
  seats: SeatsResponse
}

type LoadState =
  | { status: 'loading'; message?: string }
  | { status: 'ready'; data: DashboardData }
  | { status: 'error'; message: string }

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

const accessMethods = [
  { label: 'OpenAI BaseURL', value: 'https://api.evas.ai/v1' },
  { label: 'Anthropic BaseURL', value: 'https://api.evas.ai' },
  { label: 'API Key', value: 'sk-8Z9b7X8c6V7B8N9M0L1K2J3H4G5F6D7S8A9Q0W1E2R3T4Y5U6I' },
] as const

const compatibleProtocols = ['OpenAI Chat Completions', 'OpenAI Responses', 'Anthropic Messages'] as const

const supportedModels = [
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'z-ai/glm-5.2',
  'moonshotai/kimi-k2.6',
  'minimax/minimax-m3',
  'xiaomi/mimo-v2.5',
  'xiaomi/mimo-v2.5-pro',
] as const

const guideTabs = ['Claude Code', 'Codex', 'OpenCode', 'VS Code Copilot'] as const

type GuideTab = (typeof guideTabs)[number]

type GuideSection = {
  title: string
  description?: string
  lines?: readonly string[]
  code?: string
}

const guideContent: Record<GuideTab, { title: string; description: string; sections: readonly GuideSection[] }> = {
  'Claude Code': {
    title: 'Claude Code / Claude Code CLI',
    description: 'Windows 与 Linux 都可以直接配置环境变量。下面给出可直接复制的值，默认将主模型指向 Pro，轻量任务指向 Flash。',
    sections: [
      {
        title: 'Windows PowerShell',
        code: [
          `$env:ANTHROPIC_BASE_URL="${accessMethods[1].value}"`,
          `$env:ANTHROPIC_API_KEY="${accessMethods[2].value}"`,
          '$env:ANTHROPIC_MODEL="deepseek/deepseek-v4-pro"',
          '$env:ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek/deepseek-v4-pro"',
          '$env:ANTHROPIC_DEFAULT_SONNET_MODEL="z-ai/glm-5.2"',
          '$env:ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek/deepseek-v4-flash"',
          '$env:CLAUDE_CODE_SUBAGENT_MODEL="deepseek/deepseek-v4-flash"',
          '$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"',
          '$env:ANTHROPIC_API_KEY=""',
        ].join('\n'),
      },
      {
        title: 'Linux / Bash',
        code: [
          `export ANTHROPIC_BASE_URL="${accessMethods[1].value}"`,
          `export ANTHROPIC_API_KEY="${accessMethods[2].value}"`,
          'export ANTHROPIC_MODEL="deepseek/deepseek-v4-pro"',
          'export ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek/deepseek-v4-pro"',
          'export ANTHROPIC_DEFAULT_SONNET_MODEL="z-ai/glm-5.2"',
          'export ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek/deepseek-v4-flash"',
          'export CLAUDE_CODE_SUBAGENT_MODEL="deepseek/deepseek-v4-flash"',
          'export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"',
          'export ANTHROPIC_API_KEY=""',
        ].join('\n'),
      },
    ],
  },
  Codex: {
    title: 'Codex',
    description: 'Codex 通过 config.toml 指定 provider，再通过环境变量传入 API Key。下面给出一份可直接使用的示例。',
    sections: [
      {
        title: '配置文件位置',
        lines: ['Windows: %USERPROFILE%/.codex/config.toml', 'Linux: ~/.codex/config.toml'],
      },
      {
        title: 'config.toml 示例',
        code: [
          'model = "deepseek/deepseek-v4-pro"',
          'model_provider = "evas"',
          'model_reasoning_effort = "high"',
          '',
          '[model_providers.evas]',
          'name = "EVAS"',
          `base_url = "${accessMethods[0].value}"`,
          'env_key = "OPENAI_API_KEY"',
          'wire_api = "responses"',
        ].join('\n'),
      },
      {
        title: 'API Key 环境变量',
        code: [`$env:OPENAI_API_KEY="${accessMethods[2].value}"`, `export OPENAI_API_KEY="${accessMethods[2].value}"`].join('\n'),
      },
    ],
  },
  OpenCode: {
    title: 'OpenCode',
    description: 'OpenCode 按 OpenAI Compatible Provider 配置即可。不论你使用图形配置页还是配置文件，字段值都按下面填写。',
    sections: [
      {
        title: '新增 Provider 时填写',
        lines: [
          'Provider Type: OpenAI Compatible',
          'Provider Name: evas',
          `Base URL: ${accessMethods[0].value}`,
          `API Key: ${accessMethods[2].value}`,
          'Default Model: deepseek/deepseek-v4-pro',
          'Small / Fast Model: deepseek/deepseek-v4-flash',
        ],
      },
      {
        title: '如果你使用配置文件',
        code: [
          '{',
          '  "provider": {',
          '    "evas": {',
          '      "type": "openai-compatible",',
          `      "baseUrl": "${accessMethods[0].value}",`,
          `      "apiKey": "${accessMethods[2].value}",`,
          '      "defaultModel": "deepseek/deepseek-v4-pro",',
          '      "smallModel": "deepseek/deepseek-v4-flash"',
          '    }',
          '  }',
          '}',
        ].join('\n'),
      },
    ],
  },
  'VS Code Copilot': {
    title: 'VS Code Copilot',
    description: '先在 VS Code 中安装 OAI Compatible Provider for Copilot，然后打开 settings.json，把以下配置粘贴进去。',
    sections: [
      {
        title: '操作路径',
        lines: ['扩展市场安装: OAI Compatible Provider for Copilot', '命令面板执行: Preferences: Open User Settings (JSON)', '把下面配置加入 settings.json'],
      },
      {
        title: 'settings.json 示例',
        code: [
          '{',
          '  "oaicopilot.baseUrl": "https://api.evas.ai/v1",',
          '  "oaicopilot.models": [',
          '    {',
          '      "id": "deepseek/deepseek-v4-flash",',
          '      "apiMode": "openai",',
          '      "owned_by": "deepseek"',
          '    },',
          '    {',
          '      "id": "deepseek/deepseek-v4-pro",',
          '      "apiMode": "openai",',
          '      "owned_by": "deepseek"',
          '    },',
          '    {',
          '      "id": "z-ai/glm-5.2",',
          '      "apiMode": "openai",',
          '      "owned_by": "glm"',
          '    },',
          '    {',
          '      "id": "kimi-k2.7-code",',
          '      "apiMode": "openai",',
          '      "owned_by": "moonshot"',
          '    },',
          '    {',
          '      "id": "minimax/minimax-m3",',
          '      "apiMode": "openai",',
          '      "owned_by": "minimax"',
          '    },',
          '    {',
          '      "id": "xiaomi/mimo-v2.5-pro",',
          '      "apiMode": "openai",',
          '      "owned_by": "xiaomi"',
          '    }',
          '  ]',
          '}',
        ].join('\n'),
      },
    ],
  },
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
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const [activeGuideTab, setActiveGuideTab] = useState<GuideTab>('Claude Code')

  const loadDashboard = useCallback(async () => {
    setState({ status: 'loading', message: '正在同步席位用量' })
    try {
      const seats = await fetchJson<SeatsResponse>('/api/seats')
      setState({ status: 'ready', data: { seats } })
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
      }
    }
    const { seats } = state.data

    return {
      seats: seats.seats.length,
      usage5h: formatAverage(seats.seats, 'usage5h'),
    }
  }, [state])

  const copyText = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedValue(value)
      window.setTimeout(() => {
        setCopiedValue((current) => (current === value ? null : current))
      }, 1600)
    } catch (error) {
      console.error('复制失败', error)
    }
  }, [])

  const handleCardCopy = useCallback(
    (value: string) => {
      void copyText(value)
    },
    [copyText],
  )

  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, value: string) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        void copyText(value)
      }
    },
    [copyText],
  )

  const activeGuide = guideContent[activeGuideTab]

  return (
    <div className="app-shell">
      <main className="dashboard-main">
        <header className="topbar">
          <div>
            <h1>火山方舟 Coding Plan 席位用量</h1>
          </div>
          <div className="topbar-actions">
            <button className="btn-primary" type="button" onClick={loadDashboard} disabled={state.status === 'loading'}>
              {state.status === 'loading' ? '同步中' : '刷新'}
            </button>
          </div>
        </header>

        <section className="kpis" aria-label="用量概览">
          <Metric className="kpi-summary" label="有效席位" value={summary.seats} />
          <Metric className="kpi-summary" label="平均近5小时" value={summary.usage5h} />
          <div className="access-stack" aria-label="BaseURL 接入方式">
            {accessMethods.slice(0, 2).map((item) => (
              <article
                className="kpi access-card stacked-access-card clickable-card"
                key={item.label}
                role="button"
                tabIndex={0}
                aria-label={`点击复制${item.label}`}
                onClick={() => handleCardCopy(item.value)}
                onKeyDown={(event) => handleCardKeyDown(event, item.value)}
              >
                <div className="label">{item.label}</div>
                <div className="copy-row access-card-row">
                  <div className="copy-text-group">
                    <span className="copy-value">{item.value}</span>
                  </div>
                  <CopyButton
                    copied={copiedValue === item.value}
                    label={`复制${item.label}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      void copyText(item.value)
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
          <div className="access-stack key-stack" aria-label="API Key 与兼容协议">
            <article
              className="kpi access-card access-card-key clickable-card"
              role="button"
              tabIndex={0}
              aria-label={`点击复制${accessMethods[2].label}`}
              onClick={() => handleCardCopy(accessMethods[2].value)}
              onKeyDown={(event) => handleCardKeyDown(event, accessMethods[2].value)}
            >
              <div className="label">{accessMethods[2].label}</div>
              <div className="copy-row access-card-row">
                <div className="copy-text-group">
                  <span className="copy-value">{accessMethods[2].value}</span>
                </div>
                <CopyButton
                  copied={copiedValue === accessMethods[2].value}
                  label={`复制${accessMethods[2].label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void copyText(accessMethods[2].value)
                  }}
                />
              </div>
            </article>

            <article className="kpi access-card protocol-card">
              <div className="label">兼容协议</div>
              <div className="protocol-list" aria-label="兼容协议列表">
                {compatibleProtocols.map((protocol) => (
                  <span className="protocol-item" key={protocol}>
                    {protocol}
                  </span>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="panel models-panel" aria-label="支持模型列表">
          <div className="panel-title">
            <h2>支持模型列表</h2>
          </div>

          <div className="model-grid compact-grid">
            {supportedModels.map((model) => (
              <article
                className="model-item compact unified-card clickable-card"
                key={model}
                role="button"
                tabIndex={0}
                aria-label={`点击复制${model}`}
                onClick={() => handleCardCopy(model)}
                onKeyDown={(event) => handleCardKeyDown(event, model)}
              >
                <div className="model-copy-row access-card-row">
                  <div className="copy-text-group model-copy-text-group">
                    <strong className="model-card-name">{model}</strong>
                  </div>
                  <CopyButton
                    copied={copiedValue === model}
                    label={`复制${model}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      void copyText(model)
                    }}
                  />
                </div>
              </article>
            ))}
          </div>

          <div className="guide-card" aria-label="配置教程卡片">
            <div className="guide-card-header">
              <div>
                <h3>配置教程</h3>
                <p>{activeGuide.description}</p>
              </div>
              <div className="guide-tabs" role="tablist" aria-label="配置教程选项卡">
                {guideTabs.map((tab) => (
                  <button
                    key={tab}
                    className={tab === activeGuideTab ? 'active' : ''}
                    type="button"
                    role="tab"
                    aria-selected={tab === activeGuideTab}
                    aria-controls={`guide-panel-${tab}`}
                    id={`guide-tab-${tab}`}
                    onClick={() => setActiveGuideTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="guide-panel"
              id={`guide-panel-${activeGuideTab}`}
              role="tabpanel"
              aria-labelledby={`guide-tab-${activeGuideTab}`}
            >
              <div className="guide-panel-title">{activeGuide.title}</div>
              <div className="guide-section-list">
                {activeGuide.sections.map((section) => (
                  <section className="guide-section" key={section.title}>
                    <h4>{section.title}</h4>
                    {section.description && <p>{section.description}</p>}
                    {section.lines && (
                      <ul className="guide-bullet-list">
                        {section.lines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                    {section.code && <pre className="guide-code-block">{section.code}</pre>}
                  </section>
                ))}
              </div>
            </div>
          </div>
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

function CopyButton({
  copied,
  label,
  onClick,
}: {
  copied: boolean
  label: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      className={`copy-button${copied ? ' is-copied' : ''}`}
      type="button"
      aria-label={copied ? `${label}，已复制` : label}
      aria-pressed={copied}
      title={copied ? '已复制' : '复制'}
      onClick={onClick}
    >
      {copied ? (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M16.2 5.3a.75.75 0 0 1 0 1.06l-7.2 7.2a.75.75 0 0 1-1.06 0l-3.14-3.14a.75.75 0 1 1 1.06-1.06l2.61 2.61 6.67-6.67a.75.75 0 0 1 1.06 0Z" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M7 3.5A2.5 2.5 0 0 0 4.5 6v7A2.5 2.5 0 0 0 7 15.5h5A2.5 2.5 0 0 0 14.5 13V6A2.5 2.5 0 0 0 12 3.5H7Zm0 1h5A1.5 1.5 0 0 1 13.5 6v7a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 13V6A1.5 1.5 0 0 1 7 4.5Z" fill="currentColor" />
          <path d="M9 1.5A2.5 2.5 0 0 1 11.5 4v.5h-1V4A1.5 1.5 0 0 0 9 2.5H5A1.5 1.5 0 0 0 3.5 4v6A1.5 1.5 0 0 0 5 11.5h.5v1H5A2.5 2.5 0 0 1 2.5 10V4A2.5 2.5 0 0 1 5 1.5h4Z" fill="currentColor" />
        </svg>
      )}
    </button>
  )
}

function Metric({
  className,
  label,
  value,
  delta,
  tone = 'neutral',
}: {
  className?: string
  label: string
  value: React.ReactNode
  delta?: string
  tone?: 'neutral' | 'up'
}) {
  return (
    <article className={className ? `kpi ${className}` : 'kpi'}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <div className={`delta ${tone}`}>{delta}</div>}
    </article>
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
