import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

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
  const response = await fetch(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.bodyText,
  })
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

function normalizeModelInfo(item) {
  const modelId = stringValue(
    pickDeep(item, ['ModelID', 'ModelId', 'ModelName', 'Model', 'Name', 'ID', 'Id'], 2),
  )
  const displayName = stringValue(
    pickDeep(item, ['DisplayName', 'ModelDisplayName', 'ModelName', 'Name', 'ModelID', 'ModelId'], 2),
  )
  return {
    modelId: modelId || displayName || 'unknown',
    displayName: displayName || modelId || '未命名模型',
    provider: stringValue(pickDeep(item, ['Provider', 'Supplier', 'Vendor'], 2)),
    contextLength: numericOrString(pickDeep(item, ['ContextLength', 'ContextWindow', 'MaxContextLength', 'MaxTokens'], 2)),
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

function dateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date) {
  const day = date.getDay() || 7
  return addDays(startOfDay(date), 1 - day)
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function weekLabel(date) {
  const start = startOfWeek(date)
  const end = addDays(start, 6)
  return `${dateKey(start).slice(5).replace('-', '/')} - ${dateKey(end).slice(5).replace('-', '/')}`
}

function monthLabel(date) {
  const key = dateKey(startOfMonth(date))
  return key.slice(0, 7).replace('-', '/')
}

function emptyUsagePoint(label, key) {
  return {
    label,
    key,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokensHit: 0,
    reqCnt: 0,
    imageCount: 0,
  }
}

function addUsagePoint(target, source) {
  target.totalTokens += source.totalTokens
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheTokensHit += source.cacheTokensHit
  target.reqCnt += source.reqCnt
  target.imageCount += source.imageCount
}

function parseInferenceUsage(payload, fallbackDay = '') {
  const fields = asArray(payload?.Result?.Fields).map((field) => field?.Name).filter(Boolean)
  return asArray(payload?.Result?.Data).map((row) => {
    const item = Object.fromEntries(fields.map((field, index) => [field, row[index]]))
    const timeValue = String(item.Hour || item.Time || item.Timestamp || item.StartTime || item.Day || '')
    return {
      day: String(item.Day || fallbackDay || ''),
      hour: parseHourKey(timeValue, item.Day || fallbackDay),
      totalTokens: numericValue(item.TotalTokens),
      inputTokens: numericValue(item.InputTokens),
      outputTokens: numericValue(item.OutputTokens),
      cacheTokensHit: numericValue(item.CacheTokensHit),
      reqCnt: numericValue(item.ReqCnt),
      imageCount: numericValue(item.ImageCount),
    }
  })
}

function parseHourKey(value, fallbackDay) {
  const text = String(value || '')
  const dayMatch = text.match(/(\d{4}-\d{2}-\d{2})/)
  const compactDayMatch = text.match(/(\d{8})/)
  const hourMatch =
    text.match(/(?:T|\s)(\d{1,2})(?::\d{2})?/) ||
    text.match(/\b(\d{1,2}):\d{2}\b/) ||
    (/^\d{1,2}$/.test(text) ? ['', text] : null)
  const day =
    dayMatch?.[1] ||
    (compactDayMatch ? `${compactDayMatch[1].slice(0, 4)}-${compactDayMatch[1].slice(4, 6)}-${compactDayMatch[1].slice(6, 8)}` : '') ||
    String(fallbackDay || '')
  const hour = hourMatch ? Number(hourMatch[1]) : Number.NaN

  if (!day || !Number.isFinite(hour)) return ''
  return `${day} ${String(hour).padStart(2, '0')}`
}

function aggregateInferenceUsage(rows, now = new Date()) {
  const byDay = new Map(rows.filter((row) => row.day).map((row) => [row.day, row]))
  const today = startOfDay(now)
  const dailyStart = addDays(today, -13)
  const daily = []

  for (let index = 0; index < 14; index += 1) {
    const date = addDays(dailyStart, index)
    const key = dateKey(date)
    const point = emptyUsagePoint(key.slice(5).replace('-', '/'), key)
    const row = byDay.get(key)
    if (row) addUsagePoint(point, row)
    daily.push(point)
  }

  const weekly = []
  const firstWeek = addDays(startOfWeek(today), -7 * 7)
  for (let index = 0; index < 8; index += 1) {
    const start = addDays(firstWeek, index * 7)
    const point = emptyUsagePoint(weekLabel(start), dateKey(start))
    for (let offset = 0; offset < 7; offset += 1) {
      const row = byDay.get(dateKey(addDays(start, offset)))
      if (row) addUsagePoint(point, row)
    }
    weekly.push(point)
  }

  const monthly = []
  const firstMonth = addMonths(startOfMonth(today), -5)
  for (let index = 0; index < 6; index += 1) {
    const month = addMonths(firstMonth, index)
    const point = emptyUsagePoint(monthLabel(month), dateKey(month).slice(0, 7))
    const nextMonth = addMonths(month, 1)
    for (let date = new Date(month); date < nextMonth && date <= today; date = addDays(date, 1)) {
      const row = byDay.get(dateKey(date))
      if (row) addUsagePoint(point, row)
    }
    monthly.push(point)
  }

  return { daily, weekly, monthly }
}

function aggregateHourlyUsage(rows, now = new Date()) {
  const today = startOfDay(now)
  const todayKey = dateKey(today)
  const byHour = new Map(rows.filter((row) => row.hour).map((row) => [row.hour, row]))
  const hourly = []

  for (let hour = 0; hour < 24; hour += 1) {
    const hourText = String(hour).padStart(2, '0')
    const key = `${todayKey} ${hourText}`
    const point = emptyUsagePoint(`${hourText}:00`, key)
    const row = byHour.get(key)
    if (row) addUsagePoint(point, row)
    hourly.push(point)
  }

  return hourly
}

function chunk(values, size) {
  const safeSize = Number.isFinite(size) && size > 0 ? size : 50
  const result = []
  for (let index = 0; index < values.length; index += safeSize) {
    result.push(values.slice(index, index + safeSize))
  }
  return result
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

async function getInferenceUsage() {
  const today = startOfDay(new Date())
  const start = addMonths(startOfMonth(today), -5)
  const rows = []

  for (let cursor = new Date(start); cursor <= today; cursor = addDays(cursor, 30)) {
    const end = addDays(cursor, 29) > today ? today : addDays(cursor, 29)
    const usagePayload = await callArk('GetInferenceUsage', {
      StartTime: dateKey(cursor),
      EndTime: dateKey(end),
      ProjectName: config.projectName,
      QueryInterval: 'Day',
    })
    rows.push(...parseInferenceUsage(usagePayload))
  }

  const hourlyPayload = await callArk('GetInferenceUsage', {
    StartTime: dateKey(today),
    EndTime: dateKey(today),
    ProjectName: config.projectName,
    QueryInterval: 'Hour',
  })
  const series = aggregateInferenceUsage(rows, today)
  const hourly = aggregateHourlyUsage(parseInferenceUsage(hourlyPayload, dateKey(today)), today)

  return {
    hourly,
    ...series,
    fetchedAt: new Date().toISOString(),
    projectName: config.projectName,
    metric: 'TotalTokens',
    range: {
      start: dateKey(start),
      end: dateKey(today),
    },
  }
}

async function getCodingPlanModels() {
  const requestBodies = [
    { ProjectName: config.projectName, BizInfo: config.bizInfo },
    { ProjectName: config.projectName },
    {},
  ]
  let payload = null
  let lastError = null

  for (const body of requestBodies) {
    try {
      payload = await callArk('ListArkCodingPlanModel', body)
      break
    } catch (error) {
      lastError = error
    }
  }

  if (!payload) {
    throw lastError || new Error('查询 Coding Plan 支持模型失败')
  }

  const rows = extractRows(payload, ['ModelID', 'ModelId', 'ModelName', 'Model', 'Name'])
  const models = rows.map(normalizeModelInfo).filter((model) => model.modelId)

  return {
    models,
    fetchedAt: new Date().toISOString(),
    projectName: config.projectName,
    bizInfo: config.bizInfo,
    rawModelCount: rows.length,
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

app.get('/api/inference-usage', async (_request, response) => {
  try {
    response.json(await getInferenceUsage())
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : '查询推理用量失败',
    })
  }
})

app.get('/api/models', async (_request, response) => {
  try {
    response.json(await getCodingPlanModels())
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : '查询支持模型列表失败',
    })
  }
})

app.use(express.static(path.join(__dirname, '..', 'dist')))
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'dist', 'index.html'))
})

const port = Number(process.env.PORT || 8787)
app.listen(port, () => {
  console.log(`SeatsUsage API listening on http://localhost:${port}`)
})
