// dsh-live2d-pet — 把鲸语的 Live2D 舞台变成桌面宠物，并给 AI 一组驱动工具。
//
// 设计取舍：
//   · 舞台（渲染、动作、物理）不是这个插件的东西，它是 jingyu-live2d-agent；
//     插件只负责：起外壳、读写气泡与聊天文件、把动作计划 POST 过去。
//   · 模型必须用户自备——大肥鱼公皮的许可禁止重新分发模型文件。
//   · 没有 UI、没有快捷键冲突：设置写在 $DSH_HOME/live2d-pet/config.json。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineTool } from '@deepseek-ai/dsh-tools'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLED_SHELL = path.join(HERE, 'shell')

/** Cordis 插件名。 */
const name = 'live2d-pet'
/** 需要宿主注入的服务。 */
const inject = ['tools', 'webServer']

const DEFAULT_STAGE = 'http://127.0.0.1:61942'

function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh')
}

function home() {
  return path.join(dshHome(), 'live2d-pet')
}

function configPath() {
  return path.join(home(), 'config.json')
}

function defaults() {
  return {
    stageUrl: DEFAULT_STAGE,
    electron: '',
    launchScript: '',
    autoStart: false,
    avatar: '',
    // 外观
    width: 435,
    opacity: 1,
    follow: true,
    // 行为
    idleEnabled: true,
    idleMinMs: 22000,
    idleSpreadMs: 45000,
    idleActions: [], // 空 = 全部允许；填名字则只用这些
    bubbleHoldMs: 9000,
    hotkeys: true,
    note: 'electron 留空时依次尝试 $DSH_HOME/electron/electron.exe 与 PATH 里的 electron。launchScript 指向你自己的启动脚本（.ps1 / .cmd），设置页的「全部拉起」会先跑它。avatar 填一张本机图片路径（png/jpg），会压成 128×128 给左上角当拖动手柄。',
  }
}

const LIMITS = {
  width: [260, 900],
  opacity: [0.25, 1],
  idleMinMs: [8000, 600000],
  idleSpreadMs: [0, 600000],
  bubbleHoldMs: [1000, 60000],
}

function clampNumber(key, value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const [lo, hi] = LIMITS[key] ?? [-Infinity, Infinity]
  return Math.min(hi, Math.max(lo, n))
}

/** 只认白名单里的键，数字一律夹到安全范围（前端写错、手改 config 都不至于把壳弄坏）。 */
function normalizeConfig(input, base = defaults()) {
  const next = { ...base }
  if (!input || typeof input !== 'object') return next
  for (const key of ['stageUrl', 'electron', 'launchScript', 'avatar']) {
    if (typeof input[key] === 'string') next[key] = input[key].trim()
  }
  for (const key of ['autoStart', 'follow', 'idleEnabled', 'hotkeys']) {
    if (typeof input[key] === 'boolean') next[key] = input[key]
  }
  for (const key of Object.keys(LIMITS)) {
    if (key in input) next[key] = Math.round(clampNumber(key, input[key], next[key]) * 100) / 100
  }
  if (Array.isArray(input.idleActions)) {
    next.idleActions = input.idleActions.filter((x) => typeof x === 'string').slice(0, 32)
  }
  return next
}

function readConfig() {
  try {
    return normalizeConfig(JSON.parse(readFileSync(configPath(), 'utf8')))
  } catch {
    return defaults()
  }
}

function writeConfig(patch) {
  const next = normalizeConfig(patch, readConfig())
  mkdirSync(home(), { recursive: true })
  writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/** 外壳读这个文件决定尺寸/不透明度/待机节奏；改了它再重启外壳就生效。 */
function writeShellSettings(cfg = readConfig()) {
  const target = path.join(home(), 'shell')
  mkdirSync(target, { recursive: true })
  const payload = {
    width: cfg.width,
    opacity: cfg.opacity,
    follow: cfg.follow,
    idleEnabled: cfg.idleEnabled,
    idleMinMs: cfg.idleMinMs,
    idleSpreadMs: cfg.idleSpreadMs,
    idleActions: cfg.idleActions,
    bubbleHoldMs: cfg.bubbleHoldMs,
    avatar: cfg.avatar,
    updatedAt: Date.now(),
  }
  writeFileSync(path.join(target, 'pet-settings.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

/** 把打包进来的外壳复制到用户目录，避免往 node_modules 里写运行时文件。 */
function ensureShell() {
  const target = path.join(home(), 'shell')
  mkdirSync(path.join(target, 'assets'), { recursive: true })
  if (!existsSync(BUNDLED_SHELL)) throw new Error(`live2d-pet: 安装目录缺 shell/（${BUNDLED_SHELL}）`)
  const copyDir = (from, to) => {
    for (const entry of readdirSync(from)) {
      const a = path.join(from, entry)
      const b = path.join(to, entry)
      if (statSync(a).isDirectory()) {
        mkdirSync(b, { recursive: true })
        copyDir(a, b)
      } else {
        copyFileSync(a, b)
      }
    }
  }
  copyDir(BUNDLED_SHELL, target)
  writeFileSync(path.join(target, 'package.json'), `${JSON.stringify({ name: 'live2d-pet-shell', version: '0.1.0', main: 'main.js' }, null, 2)}\n`, 'utf8')
  for (const f of ['say.txt', 'chat.jsonl']) {
    const p = path.join(target, f)
    if (!existsSync(p)) writeFileSync(p, '', 'utf8')
  }
  const stats = path.join(target, 'stats.json')
  if (!existsSync(stats)) {
    writeFileSync(stats, `${JSON.stringify({ line: '还没有用量数据', updatedAt: Date.now() }, null, 2)}\n`, 'utf8')
  }
  return target
}

function findElectron(cfg) {
  if (cfg.electron && existsSync(cfg.electron)) return cfg.electron
  const guesses = [
    path.join(dshHome(), 'electron', 'electron.exe'),
    path.join(dshHome(), 'electron', 'electron'),
  ]
  for (const g of guesses) if (existsSync(g)) return g
  return cfg.electron || ''
}

function readPid() {
  try {
    return Number(readFileSync(path.join(home(), 'pet.pid'), 'utf8').trim()) || 0
  } catch {
    return 0
  }
}

function alive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function stageState(cfg) {
  try {
    const res = await fetch(`${cfg.stageUrl}/api/state`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, state: await res.json() }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

/** 舞台忙的时候要先停，否则 /api/execute 会被 400 顶回来（stop 必须带 JSON body）。 */
async function stopStage(cfg) {
  try {
    await fetch(`${cfg.stageUrl}/api/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2500),
    })
  } catch {
    /* 舞台没开就没得停 */
  }
}

async function executePlan(cfg, plan) {
  const res = await fetch(`${cfg.stageUrl}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, source: 'dsh-live2d-pet' }),
    signal: AbortSignal.timeout(8000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`舞台拒绝了这条计划（HTTP ${res.status}）：${body.error || JSON.stringify(body)}`)
  return body
}

/** 把一组 {kind,...} 包成舞台能吃的计划。view 必须 full，否则近景会把腿裁掉。 */
function buildPlan(title, actions) {
  return { version: 1, view: 'full', intent: title, summary: title, actions }
}

const EXPRESSIONS = [
  '默认体型', '体型1', '体型2', '脸红', '＞＜', '流泪', '流冷汗', '圈圈眼',
  '屑屑眼', '黑脸', '黑框眼镜', '单片眼镜', '兔牙', '爱心眼', '钢盆',
  '前倾', '加载', '尾巴开关', '竖食指开', '竖食指关', '胸口衣服', '裙子切换', '脱鞋',
]
const GESTURES = { hand_on_chest: '举手', point: '竖手指', grass: '狗尾草' }

/** 待机动作的名字，必须和外壳 inject.js 里的 IDLE_MOVES 对得上（设置页拿它做勾选表）。 */
const IDLE_ACTION_NAMES = [
  '望一眼', '想事情', '眨两下', '轻点头', '松一口气', '理袖子', '被叫醒', '不屑', '笑一下',
]

/** 把设置页点的一组动作变成 actions（表情/手势/点头摇头/说话）。 */
function actionsFromOps(ops = {}) {
  const actions = []
  const at = 0
  if (ops.expression && EXPRESSIONS.includes(String(ops.expression))) {
    actions.push({ kind: 'expression', name: String(ops.expression), at, duration: 2.4, layer: 'overlay' })
  }
  if (ops.gesture && GESTURES[String(ops.gesture)]) {
    actions.push({ kind: 'gesture', name: String(ops.gesture), at, duration: 2.2 })
  }
  if (ops.look) actions.push({ kind: 'look', direction: String(ops.look), at, duration: 1.2 })
  if (ops.tilt) actions.push({ kind: 'tilt', direction: String(ops.tilt), at, duration: 1.2 })
  if (ops.nod) actions.push({ kind: 'nod', count: Math.min(4, Math.max(1, Number(ops.nod) || 1)), at, duration: 1.4 })
  if (ops.shake_head) actions.push({ kind: 'shake_head', count: Math.min(4, Math.max(1, Number(ops.shake_head) || 1)), at, duration: 1.2 })
  if (ops.smile) actions.push({ kind: 'smile', at, duration: 1.6 })
  if (ops.blink) actions.push({ kind: 'blink', count: 1, at, duration: 0.5 })
  if (ops.talk) actions.push({ kind: 'talk', at, duration: 2.5 })
  if (actions.length === 0) actions.push({ kind: 'blink', count: 1, at, duration: 0.5 })
  return actions
}

async function performOps(cfg, title, ops, say) {
  await stopStage(cfg)
  const job = await executePlan(cfg, buildPlan(title, actionsFromOps(ops)))
  if (say) writeSay(String(say), cfg.bubbleHoldMs)
  return job
}

function startPet(cfg) {
  const shellDir = ensureShell()
  const electron = findElectron(cfg)
  if (!electron) throw new Error('live2d-pet: 找不到 electron，请在 config.json 里填 electron 的绝对路径')
  const pid = readPid()
  if (alive(pid)) return { started: false, pid, reason: '已经有一只在跑' }
  writeShellSettings(cfg)
  const env = { ...process.env, L2D_BRIDGE: cfg.stageUrl }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [shellDir], { cwd: shellDir, env, detached: true, stdio: 'ignore' })
  child.unref()
  mkdirSync(home(), { recursive: true })
  writeFileSync(path.join(home(), 'pet.pid'), String(child.pid), 'utf8')
  return { started: true, pid: child.pid }
}

function stopPet() {
  const pid = readPid()
  if (!alive(pid)) return { stopped: false, reason: '没在跑' }
  try {
    process.kill(pid)
  } catch {
    /* 已经退了 */
  }
  return { stopped: true, pid }
}

function sayPath() {
  return path.join(home(), 'shell', 'say.txt')
}

function writeSay(text, holdMs = 9000) {
  mkdirSync(path.dirname(sayPath()), { recursive: true })
  const line = `${String(text).trim()}\n${holdMs}`.trim()
  writeFileSync(sayPath(), String(text).trim(), 'utf8')
  return { said: String(text).trim(), holdMs }
}

function tailFile(file, lines = 1) {
  try {
    const arr = readFileSync(file, 'utf8').split(/\r?\n/).filter((x) => x.trim())
    return arr.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

function shellDir() {
  return path.join(home(), 'shell')
}

async function stageStatus(cfg) {
  const res = await stageState(cfg)
  if (!res.ok) return { url: cfg.stageUrl, online: false }
  const s = res.state || {}
  const clients = Array.isArray(s.clients) ? s.clients.length : Number(s.clients || 0)
  return {
    url: cfg.stageUrl,
    online: true,
    version: String(s.version || s.bridgeVersion || ''),
    rendererReady: Boolean(s.rendererReady ?? s.renderer?.ready),
    clients,
  }
}

/** 跑用户自己的启动脚本（.ps1 / .cmd / .exe）。detached 是为了别挂死在 DSH 的进程树上。 */
function runLaunchScript(cfg) {
  const file = String(cfg.launchScript || '')
  if (!file || !existsSync(file)) return { ran: false, reason: file ? `没有这个文件：${file}` : '没配 launchScript' }
  const ext = path.extname(file).toLowerCase()
  const opts = { cwd: path.dirname(file), detached: true, stdio: 'ignore', windowsHide: true }
  let child
  if (ext === '.ps1') child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], opts)
  else if (ext === '.cmd' || ext === '.bat') child = spawn('cmd.exe', ['/c', file], opts)
  else child = spawn(file, [], opts)
  child.unref()
  return { ran: true, file, pid: child.pid }
}

async function fullStatus() {
  const cfg = readConfig()
  const pid = readPid()
  const stage = await stageStatus(cfg)
  const launcher = String(cfg.launchScript || '')
  // pid 文件只在"插件自己起的"那条路上有；外壳被人手动拉起来时，靠舞台上的客户端连接判断。
  const running = alive(pid) || Number(stage.clients || 0) > 0
  return {
    stage,
    pet: { running, pid },
    launcher: { path: launcher, exists: Boolean(launcher) && existsSync(launcher) },
    shell: shellDir(),
    sayFile: path.join(shellDir(), 'say.txt'),
    realtimeLog: tailFile(path.join(shellDir(), 'realtime.log'), 1),
    config: { ...cfg, electron: findElectron(cfg) },
    catalog: {
      expressions: EXPRESSIONS,
      gestures: GESTURES,
      idleActions: IDLE_ACTION_NAMES,
      limits: LIMITS,
    },
  }
}

function sendJson(res, code, body) {
  try {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  } catch {
    /* 连接已断 */
  }
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

const TOOL_NS = 'live2d_pet'

export { name, inject }

export async function apply(ctx) {
  // 加载诊断：每一步留一行到 apply.log（出问题时不用连累用户重启第二次）
  const step = (m) => {
    try {
      mkdirSync(home(), { recursive: true })
      appendFileSync(path.join(home(), 'apply.log'), `${new Date().toISOString()} ${m}\n`, 'utf8')
    } catch {
      /* 写日志失败不影响插件 */
    }
  }
  step('apply 开始')
  try {
    ensureShell()
  } catch (error) {
    ctx.logger?.warn?.(`live2d-pet: 准备外壳目录失败 ${error?.message || error}`)
  }

  const cfg = () => readConfig()
  step('外壳就绪')

  const ensureStage = async () => {
    const c = cfg()
    const state = await stageState(c)
    if (!state.ok) {
      throw new Error(`连不上舞台 ${c.stageUrl}：${state.error || `HTTP ${state.status}`}。先启动 jingyu-live2d-agent（python launch.py --no-browser）。`)
    }
    return c
  }

  try {
  ctx.tools.register(defineTool({
    name: `${TOOL_NS}_status`,
    description: '查看桌面宠物状态：外壳进程、舞台连通性、当前模型与动作能力。第一次用之前先调它确认舞台在跑。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          shellRunning: { type: 'boolean' },
          shellPid: { type: 'integer' },
          stageUrl: { type: 'string' },
          stageOnline: { type: 'boolean' },
          model: { type: 'string' },
          bridgeVersion: { type: 'string' },
          capabilities: { type: 'object', additionalProperties: true },
        },
      },
      render: (_a, v) => [{
        type: 'text',
        text: v.stageOnline
          ? `外壳：${v.shellRunning ? `在跑（pid ${v.shellPid}）` : '没在跑'}；舞台：${v.stageUrl} 在线，模型 ${v.model}（bridge ${v.bridgeVersion}）。`
          : `外壳：${v.shellRunning ? `在跑（pid ${v.shellPid}）` : '没在跑'}；舞台：${v.stageUrl} 连不上。`,
      }],
    },
    async execute() {
      const c = cfg()
      const pid = readPid()
      const state = await stageState(c)
      let cap = {}
      try {
        const res = await fetch(`${c.stageUrl}/api/capabilities`, { signal: AbortSignal.timeout(2500) })
        if (res.ok) cap = await res.json()
      } catch {
        /* 老版本没这个接口 */
      }
      return {
        shellRunning: alive(pid),
        shellPid: pid,
        stageUrl: c.stageUrl,
        stageOnline: state.ok,
        model: String(cap.model || cap.name || ''),
        bridgeVersion: String(cap.bridgeVersion || ''),
        capabilities: { parameters: cap.parameters, expressions: cap.expressions, motions: cap.motions },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: `${TOOL_NS}_say`,
    description: '让她在桌面窗口里冒一句话（气泡，9 秒淡出）。不说话语内容之外的东西，不做动作；要动作配 perform。',
    parameters: {
      text: { type: 'string', required: true, description: '要说的话，一句话，别太长。' },
      holdMs: { type: 'integer', description: '气泡停留毫秒数，默认 9000。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { said: { type: 'string' }, holdMs: { type: 'integer' } } },
      render: (_a, v) => [{ type: 'text', text: `气泡：${v.said}` }],
    },
    async execute(args) {
      const text = String(args.text ?? '').trim()
      if (!text) throw new Error('live2d_pet_say: text 不能为空')
      return writeSay(text, Number(args.holdMs) || 9000)
    },
  }))

  ctx.tools.register(defineTool({
    name: `${TOOL_NS}_perform`,
    description: '让她做一组动作并在需要时说话。可用：抬眼 look(up/down/left/right/center)、点头 nod、摇头 shake_head、偏头 tilt(left/right)、笑 smile、眨眼 blink、表情 expression(23 个表情名)、手势 gesture(hand_on_chest/point/grass)。会先停掉正在播的动作再下发。',
    parameters: {
      look: { type: 'string', description: 'up / down / left / right / center' },
      nod: { type: 'integer', description: '点头次数 1–4' },
      shake_head: { type: 'integer', description: '摇头次数 1–4' },
      tilt: { type: 'string', description: 'left / right' },
      smile: { type: 'boolean', description: '笑一下' },
      blink: { type: 'boolean', description: '眨一下眼' },
      expression: { type: 'string', description: '表情名，例如 脸红 / 爱心眼 / 屑屑眼 / 流冷汗 / ＞＜' },
      gesture: { type: 'string', description: 'hand_on_chest / point / grass' },
      say: { type: 'string', description: '同时说一句（可选）' },
      duration_ms: { type: 'integer', description: '整组动作的总时长，默认 2600' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { jobId: { type: 'string' }, duration: { type: 'number' }, text: { type: 'string' } } },
      render: (_a, v) => [{ type: 'text', text: `动作已下发（job ${v.jobId || '?'}，约 ${v.duration ?? '?'} 秒）` }],
    },
    async execute(args) {
      const c = await ensureStage()
      const total = Math.max(0.6, Math.min(6, (Number(args.duration_ms) || 2600) / 1000))
      const actions = []
      let at = 0.15
      const push = (kind, extra = {}) => {
        const duration = Math.min(2.2, Math.max(0.4, total * 0.35))
        actions.push({ kind, at: Math.round(at * 100) / 100, duration: Math.round(duration * 100) / 100, ...extra })
        at = Math.min(total - 0.2, at + duration * 0.55)
      }
      if (args.look) push('look', { direction: String(args.look) })
      if (args.nod) push('nod', { count: Math.max(1, Math.min(4, Number(args.nod))) })
      if (args.shake_head) push('shake_head', { count: Math.max(1, Math.min(4, Number(args.shake_head))) })
      if (args.tilt) push('tilt', { direction: String(args.tilt) })
      if (args.smile) push('smile', { strength: 0.6 })
      if (args.blink) push('blink', {})
      if (args.expression) push('expression', { name: String(args.expression), layer: 'exclusive' })
      if (args.gesture) push('gesture', { name: String(args.gesture) })
      if (!actions.length && !args.say) throw new Error('live2d_pet_perform: 至少要给一个动作或一句话')
      const text = args.say ? String(args.say).trim() : ''
      if (text) writeSay(text, 9000)
      let result = { jobId: '', duration: total, text }
      if (actions.length) {
        await stopStage(c)
        const raw = await executePlan(c, {
          version: 1,
          view: 'full',
          title: 'dsh-live2d-pet',
          intent: text ? `说话并动一下：${text}` : '动一下',
          actions,
        })
        result = { jobId: String(raw.jobId || raw.id || ''), duration: Number(raw.duration || total), text }
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: `${TOOL_NS}_restart`,
    description: '重启桌面宠物外壳（舞台不动）。外壳死了、或者改完 config.json 想让它重新读时用。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { started: { type: 'boolean' }, pid: { type: 'integer' } } },
      render: (_a, v) => [{ type: 'text', text: v.started ? `外壳已起（pid ${v.pid}）` : `外壳没起：${v.reason || ''}` }],
    },
    async execute() {
      const c = cfg()
      stopPet()
      await new Promise((r) => setTimeout(r, 600))
      return startPet(c)
    },
  }))

  step('工具已注册')
  } catch (error) {
    step(`工具注册失败：${error?.message || error}`)
    ctx.logger?.warn?.(`live2d-pet: 工具注册失败 ${error?.message || error}`)
  }

  // ── 设置页 / 输入框状态卡用的接口 ──────────────────────────────────────
  // 两道闸：① DSH 自己的信任栅栏（认 cookie / token）；② 本机同源兜底。
  const sameOriginOk = (req) => {
    try {
      const host = String(req.headers.host || '')
      if (!host) return true
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) return false
      const pick = String(req.headers.origin || req.headers.referer || '')
      if (!pick) return true
      try {
        const u = new URL(pick)
        return String(u.host || '').toLowerCase() === String(host).toLowerCase()
      } catch {
        return false
      }
    } catch {
      return false
    }
  }
  let fenceCache
  const getConnection = () => {
    if (fenceCache !== undefined) return fenceCache
    for (const fn of [
      () => (typeof ctx.get === 'function' ? ctx.get('connection') : null),
      () => Reflect.get(ctx, 'connection'),
      () => (ctx.root && typeof ctx.root === 'object' ? ctx.root.connection : null),
    ]) {
      try {
        const c = fn()
        if (c && typeof c.requestRejection === 'function') {
          fenceCache = c
          return c
        }
      } catch {
        /* 换下一个 */
      }
    }
    fenceCache = null
    return null
  }
  const fenceReject = (req, res) => {
    const conn = getConnection()
    if (!conn) return false
    try {
      const rejection = conn.requestRejection({ headers: req.headers })
      if (rejection === undefined) return false
      res.statusCode = typeof rejection === 'number' ? rejection : 403
      try {
        res.end()
      } catch {
        /* 忽略 */
      }
      return true
    } catch {
      res.statusCode = 403
      try {
        res.end()
      } catch {
        /* 忽略 */
      }
      return true
    }
  }

  const handleApi = async (req, res, url) => {
    const p = url.pathname
    if (req.method === 'GET' && p === '/api/live2d-pet/status') {
      return sendJson(res, 200, { ok: true, ...(await fullStatus()) })
    }
    if (req.method === 'POST' && p === '/api/live2d-pet/start') {
      const c = cfg()
      const ran = runLaunchScript(c)
      let started = { skipped: true }
      if (!ran.ran) started = startPet(c)
      await new Promise((r) => setTimeout(r, 1500))
      return sendJson(res, 200, { ok: true, launcher: ran, pet: started, ...(await fullStatus()) })
    }
    if (req.method === 'POST' && p === '/api/live2d-pet/restart') {
      const c = cfg()
      const stopped = stopPet()
      await new Promise((r) => setTimeout(r, 700))
      const started = startPet(c)
      return sendJson(res, 200, { ok: true, stopped, pet: started, ...(await fullStatus()) })
    }
    if (req.method === 'POST' && p === '/api/live2d-pet/config') {
      const body = await readBody(req)
      const next = writeConfig(body)
      writeShellSettings(next)
      return sendJson(res, 200, { ok: true, saved: next, ...(await fullStatus()) })
    }
    if (req.method === 'POST' && p === '/api/live2d-pet/apply') {
      // 保存后套用：写外壳设置 + 重启外壳（舞台不动）
      const c = writeConfig(readConfig())
      writeShellSettings(c)
      const stopped = stopPet()
      await new Promise((r) => setTimeout(r, 600))
      const pet = startPet(c)
      return sendJson(res, 200, { ok: true, stopped, pet, ...(await fullStatus()) })
    }
    if (req.method === 'POST' && p === '/api/live2d-pet/perform') {
      const body = await readBody(req)
      const c = cfg()
      if ((await stageState(c)).ok === false) {
        return sendJson(res, 503, { ok: false, error: `舞台没在跑（${c.stageUrl}）` })
      }
      const job = await performOps(c, body.title || '设置页试动作', body, body.say)
      return sendJson(res, 200, { ok: true, job })
    }
    if (req.method === 'POST' && p === '/api/live2d-pet/say') {
      const body = await readBody(req)
      const c = cfg()
      writeSay(String(body.text || ''), Number(body.holdMs) || c.bubbleHoldMs)
      return sendJson(res, 200, { ok: true, said: String(body.text || '') })
    }
    return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${p}` })
  }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/api/live2d-pet',
      handler: async (req, res) => {
        if (fenceReject(req, res)) return
        if (!sameOriginOk(req)) {
          sendJson(res, 403, { ok: false, error: '只接受本机同源请求' })
          return
        }
        try {
          await handleApi(req, res, new URL(req.url, 'http://127.0.0.1'))
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message || error) })
        }
      },
    }), 'live2d-pet: /api/live2d-pet 路由')
    step('路由已注册')
  } catch (error) {
    step(`路由注册失败：${error?.message || error}`)
    ctx.logger?.warn?.(`live2d-pet: HTTP 路由没挂上 ${error?.message || error}`)
  }

  const c = cfg()
  if (c.autoStart) {
    try {
      startPet(c)
    } catch (error) {
      ctx.logger?.warn?.(`live2d-pet: 自启失败 ${error?.message || error}`)
    }
  }
}
