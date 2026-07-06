import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

const protocolTestConfig = {
  openAiBaseUrl: 'https://api.evas.ai/v1',
  anthropicBaseUrl: 'https://api.evas.ai',
  apiKey: 'sk-8Z9b7X8c6V7B8N9M0L1K2J3H4G5F6D7S8A9Q0W1E2R3T4Y5U6I',
  model: 'deepseek/deepseek-v4-flash',
  timeoutMs: 30000,
}

const config = {
  host: process.env.ARK_OPENAPI_HOST || 'ark.cn-beijing.volcengineapi.com',
  region: process.env.ARK_REGION || 'cn-beijing',
  service: process.env.ARK_SERVICE || 'ark',
  version: process.env.ARK_OPENAPI_VERSION || '2024-01-01',
  projectName: process.env.ARK_PROJECT_NAME || 'default',
  bizInfo: process.env.ARK_BIZ_INFO || 'Pro',
  pageSize: Number(process.env.ARK_PAGE_SIZE || 1000),
  usageBatchSize: Number(process.env.ARK_USAGE_BATCH_SIZE || 1000),
  accessKeyId:
    process.env.VOLCENGINE_ACCESS_KEY_ID ||
    process.env.VOLCENGINE_ACCESS_KEY ||
    process.env.ARK_ACCESS_KEY_ID ||
    process.env.VOLC_ACCESSKEY,
  secretAccessKey:
    process.env.VOLCENGINE_SECRET_ACCESS_KEY ||
    process.env.VOLCENGINE_SECRET_KEY ||
    process.env.ARK_SECRET_ACCESS_KEY ||
    process.env.VOLC_SECRETKEY,
  sessionToken:
    process.env.VOLCENGINE_SESSION_TOKEN ||
    process.env.VOLCENGINE_SECURITY_TOKEN ||
    process.env.ARK_SECURITY_TOKEN ||
    process.env.VOLC_SESSION_TOKEN,
}

app.use(express.json())

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding)
}

function rfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalQuery(params) {
  return Object.entries(params)
    .flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]]))
    .sort(([aKey, aValue], [bKey, bValue]) => {
      const keyCompare = String(aKey).localeCompare(String(bKey))
      return keyCompare || String(aValue).localeCompare(String(bValue))
    })
    .map(([key, value]) => `${rfc3986(String(key))}=${rfc3986(String(value))}`)
    .join('&')
}

function volcDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { xDate: iso, shortDate: iso.slice(0, 8) }
}

function signRequest({ action, body }) {
  if (!config.accessKeyId || !config.secretAccessKey) {
    throw new Error('缺少火山引擎凭据，请在 .env 中配置 VOLCENGINE_ACCESS_KEY_ID 和 VOLCENGINE_SECRET_ACCESS_KEY。')
  }

  const bodyText = JSON.stringify(body)
  const payloadHash = sha256Hex(bodyText)
  const { xDate, shortDate } = volcDate()
  const query = { Action: action, Version: config.version }
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    host: config.host,
    'x-content-sha256': payloadHash,
    'x-date': xDate,
  }

  if (config.sessionToken) {
    headers['x-security-token'] = config.sessionToken
  }

  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames.map((key) => `${key}:${String(headers[key]).trim()}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const scope = `${shortDate}/${config.region}/${config.service}/request`
  const stringToSign = ['HMAC-SHA256', xDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(config.secretAccessKey, shortDate), config.region), config.service), 'request')
  const signature = hmac(signingKey, stringToSign, 'hex')
  const authorization = [
    'HMAC-SHA256',
    `Credential=${config.accessKeyId}/${scope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ')

  return {
    url: `https://${config.host}/?${canonicalQuery(query)}`,
    bodyText,
    headers: {
      'Content-Type': headers['content-type'],
      Host: headers.host,
      'X-Content-Sha256': headers['x-content-sha256'],
      'X-Date': headers['x-date'],
      ...(config.sessionToken ? { 'X-Security-Token': config.sessionToken } : {}),
      Authorization: authorization,
    },
  }
}

async function callArk(action, body) {
  const signed = signRequest({ action, body })
  let response
  try {
    response = await fetch(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.bodyText,
    })
  } catch (error) {
    const cause = error?.cause
    const detail = [cause?.code, cause?.message || error?.message].filter(Boolean).join(': ')
    throw new Error(detail || '火山 OpenAPI 网络请求失败')
  }
  const text = await response.text()
  const payload = text ? tryJson(text) : null
  if (!response.ok || payload?.ResponseMetadata?.Error) {
    const err = payload?.ResponseMetadata?.Error
    const message = err?.Message || err?.Code || text || `火山 OpenAPI 返回 ${response.status}`
    const requestId = payload?.ResponseMetadata?.RequestId
    throw new Error(requestId ? `${message} (RequestId: ${requestId})` : message)
  }
  return payload
}

function tryJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function pickDeep(source, aliases, depth = 4) {
  const wanted = new Set(aliases.map(normalizeKey))
  const queue = [{ value: source, depth: 0 }]
  const visited = new Set()

  while (queue.length) {
    const current = queue.shift()
    if (!current || current.value === null || typeof current.value !== 'object' || visited.has(current.value)) continue
    visited.add(current.value)

    for (const [key, value] of Object.entries(current.value)) {
      if (wanted.has(normalizeKey(key)) && value !== undefined && value !== null && value !== '') {
        return value
      }
    }

    if (current.depth < depth) {
      for (const value of Object.values(current.value)) {
        if (value && typeof value === 'object') {
          queue.push({ value, depth: current.depth + 1 })
        }
      }
    }
  }

  return null
}

function findObjectArrays(source, keyAliases) {
  const wanted = new Set(keyAliases.map(normalizeKey))
  const arrays = []
  const queue = [source]
  const visited = new Set()

  while (queue.length) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)

    if (Array.isArray(current)) {
      const hasMatchingObject = current.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          Object.keys(item).some((key) => wanted.has(normalizeKey(key))),
      )
      if (hasMatchingObject) arrays.push(current)
      current.forEach((item) => queue.push(item))
    } else {
      Object.values(current).forEach((value) => queue.push(value))
    }
  }

  return arrays
}

function extractSeatId(item) {
  const value = pickDeep(item, ['SeatID', 'SeatId', 'SeatIDStr', 'Id', 'ID'], 2)
  return value === null ? null : String(value)
}

function extractRows(payload, aliases) {
  const arrays = findObjectArrays(payload?.Result ?? payload, aliases)
  return arrays.sort((a, b) => b.length - a.length)[0] || []
}

function extractTotal(payload) {
  const value = pickDeep(payload?.Result ?? payload, ['Total', 'TotalCount'], 1)
  const total = Number(value)
  return Number.isFinite(total) ? total : null
}

function normalizeSeatInfo(item) {
  const seatId = extractSeatId(item)
  return {
    seatId,
    displayName:
      stringValue(pickDeep(item, ['SeatName', 'DisplayName', 'UserName', 'Name', 'Email', 'AccountName'], 2)) ||
      seatId ||
      '未命名席位',
    bizInfo: stringValue(pickDeep(item, ['BizInfo', 'Plan', 'Package', 'Edition'], 2)) || config.bizInfo,
    projectName: stringValue(pickDeep(item, ['ProjectName', 'Project'], 2)) || config.projectName,
    effectiveAt: stringValue(
      pickDeep(
        item,
        [
          'EffectiveTime',
          'EffectiveAt',
          'StartTime',
          'BeginTime',
          'MonthlySubscribeMilestone',
          'PaidOrderTime',
          'OrderTime',
          'CreateTime',
        ],
        3,
      ),
    ),
    effectiveEndAt: stringValue(
      pickDeep(item, ['ExpiredTime', 'ExpireTime', 'EndTime', 'MonthlyResetMilestone', 'ResetTime'], 3),
    ),
    status: stringValue(pickDeep(item, ['Status', 'SeatStatus', 'State'], 2)),
    raw: item,
  }
}

function normalizeUsage(item) {
  const seatId = extractSeatId(item)
  return {
    seatId,
    usage5h: numericOrString(
      pickDeep(
        item,
        [
          'Usage5H',
          'Usage5Hours',
          'ShortTermUsage',
          'FiveHourUsage',
          'FiveHoursUsage',
          'UsageIn5Hours',
          'Last5HoursUsage',
          'Recent5HoursUsage',
        ],
        4,
      ),
    ),
    usage7d: numericOrString(
      pickDeep(
        item,
        ['Usage7D', 'UsageWeek', 'WeeklyUsage', 'OneWeekUsage', 'SevenDaysUsage', 'Last7DaysUsage', 'RecentWeekUsage', 'WeekUsage'],
        4,
      ),
    ),
    usage30d: numericOrString(
      pickDeep(
        item,
        ['Usage30D', 'UsageMonth', 'MonthlyUsage', 'OneMonthUsage', 'ThirtyDaysUsage', 'Last30DaysUsage', 'RecentMonthUsage', 'MonthUsage'],
        4,
      ),
    ),
    effectiveAt: stringValue(
      pickDeep(
        item,
        ['EffectiveTime', 'EffectiveAt', 'StartTime', 'BeginTime', 'MonthlySubscribeMilestone', 'PaidOrderTime', 'OrderTime'],
        4,
      ),
    ),
    effectiveEndAt: stringValue(
      pickDeep(item, ['ExpiredTime', 'ExpireTime', 'EndTime', 'MonthlyResetMilestone', 'ResetTime'], 4),
    ),
    raw: item,
  }
}

function stringValue(value) {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

function numericOrString(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : String(value)
}

function numericValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function chunk(values, size) {
  const safeSize = Number.isFinite(size) && size > 0 ? size : 50
  const result = []
  for (let index = 0; index < values.length; index += safeSize) {
    result.push(values.slice(index, index + safeSize))
  }
  return result
}

function joinUrl(baseUrl, pathName) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${String(pathName).replace(/^\/+/, '')}`
}

function anthropicMessagesUrl(baseUrl) {
  const normalized = String(baseUrl).replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? `${normalized}/messages` : `${normalized}/v1/messages`
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), protocolTestConfig.timeoutMs)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function summarizeProtocolPayload(protocol, payload, text) {
  if (protocol === 'OpenAI Chat Completions') {
    return stringValue(payload?.choices?.[0]?.message?.content) || stringValue(payload?.id) || text.slice(0, 160)
  }

  if (protocol === 'OpenAI Responses') {
    const outputText = stringValue(payload?.output_text)
    if (outputText) return outputText

    const textParts = asArray(payload?.output)
      .flatMap((item) => asArray(item?.content))
      .map((content) => stringValue(content?.text))
      .filter(Boolean)

    return textParts.join(' ').trim() || stringValue(payload?.id) || text.slice(0, 160)
  }

  const contentText = asArray(payload?.content)
    .map((content) => stringValue(content?.text))
    .filter(Boolean)
    .join(' ')

  return contentText || stringValue(payload?.id) || text.slice(0, 160)
}

function isProtocolCompatible(protocol, payload) {
  if (protocol === 'OpenAI Chat Completions') {
    return Boolean(payload?.choices?.[0]?.message)
  }

  if (protocol === 'OpenAI Responses') {
    return Boolean(payload?.output_text) || asArray(payload?.output).some((item) => asArray(item?.content).length > 0)
  }

  return asArray(payload?.content).length > 0
}

function protocolTestRequests() {
  return [
    {
      protocol: 'OpenAI Chat Completions',
      endpoint: joinUrl(protocolTestConfig.openAiBaseUrl, '/chat/completions'),
      headers: {
        Authorization: `Bearer ${protocolTestConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model: protocolTestConfig.model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
        temperature: 0,
      },
    },
    {
      protocol: 'OpenAI Responses',
      endpoint: joinUrl(protocolTestConfig.openAiBaseUrl, '/responses'),
      headers: {
        Authorization: `Bearer ${protocolTestConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model: protocolTestConfig.model,
        input: 'Reply with OK.',
        max_output_tokens: 8,
      },
    },
    {
      protocol: 'Anthropic Messages',
      endpoint: anthropicMessagesUrl(protocolTestConfig.anthropicBaseUrl),
      headers: {
        'x-api-key': protocolTestConfig.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: {
        model: protocolTestConfig.model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      },
    },
  ]
}

async function runProtocolTest(requestConfig) {
  const startedAt = Date.now()

  try {
    const upstreamResponse = await fetchWithTimeout(requestConfig.endpoint, {
      method: 'POST',
      headers: requestConfig.headers,
      body: JSON.stringify(requestConfig.body),
    })
    const text = await upstreamResponse.text()
    const payload = text ? tryJson(text) : {}
    const compatible = upstreamResponse.ok && isProtocolCompatible(requestConfig.protocol, payload)
    const detail = upstreamResponse.ok
      ? compatible
        ? summarizeProtocolPayload(requestConfig.protocol, payload, text)
        : `返回 ${upstreamResponse.status}，但响应结构不符合 ${requestConfig.protocol}`
      : payload?.error?.message || payload?.message || text || `HTTP ${upstreamResponse.status}`

    return {
      protocol: requestConfig.protocol,
      endpoint: requestConfig.endpoint,
      ok: compatible,
      status: upstreamResponse.status,
      latencyMs: Date.now() - startedAt,
      model: protocolTestConfig.model,
      detail: detail || (upstreamResponse.ok ? '请求成功' : '请求失败'),
    }
  } catch (error) {
    return {
      protocol: requestConfig.protocol,
      endpoint: requestConfig.endpoint,
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      model: protocolTestConfig.model,
      detail: error instanceof Error ? error.message : '协议测试失败',
    }
  }
}

async function getSeatsUsage() {
  const seatInfoRows = []
  let pageNum = 1
  let total = null

  do {
    const seatInfoPayload = await callArk('ListSeatInfos', {
      Filter: { BizInfo: config.bizInfo },
      ProjectName: config.projectName,
      PageNum: pageNum,
      PageSize: config.pageSize,
    })
    const pageRows = extractRows(seatInfoPayload, ['SeatID', 'SeatId']).map(normalizeSeatInfo).filter((seat) => seat.seatId)
    seatInfoRows.push(...pageRows)
    total = extractTotal(seatInfoPayload)
    if (pageRows.length < config.pageSize) break
    pageNum += 1
  } while (!total || seatInfoRows.length < total)

  const seatIds = [...new Set(seatInfoRows.map((seat) => seat.seatId))]
  const usageRows = []

  for (const seatIdGroup of chunk(seatIds, config.usageBatchSize)) {
    const usagePayload = await callArk('ListSeatInfoUsages', {
      ProjectName: config.projectName,
      SeatIDs: seatIdGroup,
    })
    usageRows.push(...extractRows(usagePayload, ['SeatID', 'SeatId']).map(normalizeUsage))
  }

  const usageBySeatId = new Map(usageRows.filter((usage) => usage.seatId).map((usage) => [usage.seatId, usage]))
  const seats = seatInfoRows
    .filter((seat) => seat.status === '2')
    .map((seat) => {
      const usage = usageBySeatId.get(seat.seatId)
      return {
        seatId: seat.seatId,
        displayName: seat.displayName,
        bizInfo: seat.bizInfo,
        projectName: seat.projectName,
        usage5h: usage?.usage5h ?? null,
        usage7d: usage?.usage7d ?? null,
        usage30d: usage?.usage30d ?? null,
        effectiveAt: usage?.effectiveAt || seat.effectiveAt,
        effectiveEndAt: usage?.effectiveEndAt || seat.effectiveEndAt,
        status: seat.status,
      }
    })

  return {
    seats,
    fetchedAt: new Date().toISOString(),
    projectName: config.projectName,
    bizInfo: config.bizInfo,
    rawSeatCount: seatInfoRows.length,
  }
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/seats', async (_request, response) => {
  try {
    response.json(await getSeatsUsage())
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : '查询席位用量失败',
    })
  }
})

app.post('/api/protocol-tests', async (_request, response) => {
  const results = await Promise.all(protocolTestRequests().map(runProtocolTest))
  response.json({
    testedAt: new Date().toISOString(),
    model: protocolTestConfig.model,
    results,
  })
})

app.use(express.static(path.join(__dirname, '..', 'dist')))
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'dist', 'index.html'))
})

const port = Number(process.env.PORT || 8787)
app.listen(port, () => {
  console.log(`SeatsUsage API listening on http://localhost:${port}`)
})
