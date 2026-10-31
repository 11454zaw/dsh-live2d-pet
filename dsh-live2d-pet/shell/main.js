// 鲸语桌面宠物外壳：把 http://127.0.0.1:61942/ 的舞台裁成一块透明浮窗。
// 无第三方依赖，只用 Electron 自带能力。
const { app, BrowserWindow, Menu, globalShortcut, screen, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const BRIDGE = process.env.L2D_BRIDGE || 'http://127.0.0.1:61942'
const STAGE_URL = `${BRIDGE}/`
const RATIO = 664 / 435
const MIN_WIDTH = 260
const MAX_WIDTH = 900
const COLLAPSED_SIZE = 84
const SIZE_PRESETS = [
  { label: '小（320）', width: 320 },
  { label: '中（435）', width: 435 },
  { label: '大（560）', width: 560 },
  { label: '特大（700）', width: 700 },
]

const statePath = () => path.join(app.getPath('userData'), 'pet-window.json')
const sayPath = () => path.join(__dirname, 'say.txt')
const injectPath = () => path.join(__dirname, 'inject.js')
const avatarDataPath = () => path.join(__dirname, 'assets', 'avatar.b64')
const chatPath = () => path.join(__dirname, 'chat.jsonl')
const statsPath = () => path.join(__dirname, 'stats.json')

let win = null
let clickThrough = false
let collapsed = false
let collapsedFrom = null
let lastSay = ''
let lastInertiaAt = 0
let burstFromX = null
let burstAt = 0
let burstTimer = null
let saveTimer = null
let debugActionsDone = false
// 启动那一下窗口尺寸/位置会被摆正，别把这次位移当成「被搬动」。
const inertiaReadyAt = Date.now() + 2600

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'))
  } catch {
    return {}
  }
}

function saveState(patch) {
  const next = { ...readState(), ...patch }
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true })
    fs.writeFileSync(statePath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* 存不下来也不影响用 */
  }
  return next
}

const savedFollow = () => (setting('follow', readState().follow) !== false)
const savedIdle = () => (setting('idleEnabled', readState().idle) !== false)

/** 插件写进来的 pet-settings.json（设置页 → 保存并套用）；没有就退回旧的状态文件。 */
const settingsPath = () => path.join(__dirname, 'pet-settings.json')
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}
function setting(key, fallback) {
  const s = readSettings()
  return s[key] === undefined || s[key] === null ? fallback : s[key]
}

const clampWidth = (value) => {
  const area = screen.getPrimaryDisplay().workArea
  // 高度按比例走，超过了屏幕就装不下——上限跟着屏幕算，别顶出桌面上沿。
  const byScreen = Math.floor((area.height - 24) / RATIO)
  const ceiling = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, byScreen))
  return Math.max(MIN_WIDTH, Math.min(ceiling, Math.round(value)))
}
const heightFor = (width) => Math.round(width * RATIO)

const PET_CSS = `
  html,body{background:transparent!important;overflow:hidden!important}
  .topbar,.director,.score,.stage-heading,.transport,.stage-options,
  .stage-panel>footer,.stage-caption,.view-switch,.scene-word,.scene-grid,
  .orbit,.stage-halo,.loading,.export-controls,.backend-controls,
  #toast,dialog{display:none!important}
  .workspace{display:block!important;height:100vh!important;min-height:0!important;
             max-width:none!important;margin:0!important}
  .stage-panel{padding:0!important;background:transparent!important;height:100vh!important;
               border:0!important;box-shadow:none!important}
  .scene{height:100vh!important;min-height:0!important;max-height:none!important;
         background:transparent!important;box-shadow:none!important;border-radius:0!important;
         overflow:visible!important}
  #model-canvas{position:absolute!important;inset:0!important;width:100%!important;
                height:100%!important;pointer-events:none!important;
                transform:scale(var(--pet-fit,1));transform-origin:50% 100%}
  #pet-drag{position:fixed;top:0;left:0;right:0;height:24px;pointer-events:none;
            z-index:999998}
  #pet-handle{position:fixed;left:8px;top:6px;width:54px;height:54px;border-radius:50%;
              background-color:rgba(255,255,255,.6);background-size:cover;background-position:center;
              border:2px solid rgba(255,255,255,.92);box-shadow:0 5px 16px rgba(20,40,70,.30);
              z-index:999999;cursor:grab;opacity:.9;
              transition:opacity .15s ease,transform .12s ease}
  #pet-handle:hover{opacity:1;transform:scale(1.05)}
  body.pet-grabbing{cursor:grabbing!important}
  #pet-grip{position:fixed;right:0;bottom:0;width:26px;height:26px;z-index:999999;
            -webkit-app-region:no-drag;cursor:nwse-resize;
            background:linear-gradient(135deg,transparent 52%,rgba(80,130,110,.28) 52%);
            border-bottom-right-radius:6px;opacity:.55;transition:opacity .15s}
  #pet-grip:hover{opacity:1}
  #pet-bubble{position:fixed;left:12px;right:12px;bottom:34px;z-index:999999;
              background:rgba(255,255,255,.93);color:#2f4a3f;border-radius:12px;
              padding:10px 13px;font:12px/1.75 "Microsoft YaHei",system-ui,sans-serif;
              box-shadow:0 6px 22px rgba(24,58,44,.18);opacity:0;transform:translateY(6px);
              transition:opacity .18s ease,transform .18s ease;pointer-events:none;
              -webkit-user-select:none;user-select:none;max-height:180px;overflow:hidden}
  #pet-bubble.on{opacity:1;transform:translateY(0)}
  #pet-hint{position:fixed;top:2px;left:0;right:0;text-align:center;z-index:999999;
            font:9px/20px "Microsoft YaHei",system-ui;color:rgba(90,120,105,.65);
            letter-spacing:1px;opacity:0;transition:opacity .2s;pointer-events:none}
  #pet-hint.on{opacity:1}
  #pet-chat-btn{position:fixed;right:8px;top:8px;width:30px;height:30px;border-radius:50%;
                border:1px solid rgba(255,255,255,.85);background:rgba(255,255,255,.72);
                color:#2f4a3f;font:12px/1 "Microsoft YaHei",system-ui;cursor:pointer;
                z-index:999999;opacity:.82;transition:opacity .15s,transform .12s}
  #pet-chat-btn:hover{opacity:1;transform:scale(1.06)}
  #pet-chat-btn.unread{opacity:1;border-color:#e2707a;color:#b3404d;
                       box-shadow:0 0 0 3px rgba(226,112,122,.28);animation:pet-nudge 1.6s ease-in-out infinite}
  #pet-chat-btn.unread::after{content:"";position:absolute;right:1px;top:1px;width:8px;height:8px;
                              border-radius:50%;background:#e2707a;box-shadow:0 0 0 1.5px rgba(255,255,255,.9)}
  @keyframes pet-nudge{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
  #pet-panel{position:fixed;left:10px;right:10px;bottom:10px;z-index:999999;display:none;
             flex-direction:column;gap:6px;padding:9px 10px;border-radius:12px;
             background:rgba(250,252,250,.94);box-shadow:0 8px 26px rgba(24,58,44,.22);
             font:11px/1.6 "Microsoft YaHei",system-ui;color:#2f4a3f}
  body.pet-chat-on #pet-panel{display:flex}
  body.pet-chat-on #pet-bubble{display:none}
  /* 页面自己的文字/卡片在窄窗里会漏出来：一律藏掉，只留画布和外壳自己的控件。 */
  body *{visibility:hidden}
  #pet-handle,#pet-chat-btn,#pet-panel,#pet-panel *,#pet-bubble,#pet-hint,#pet-grip,#pet-drag,
  canvas#model-canvas{visibility:visible!important}
  #pet-stats{font-size:10px;color:rgba(70,105,90,.85);letter-spacing:.3px;
             border-bottom:1px dashed rgba(120,155,140,.35);padding-bottom:4px}
  #pet-log{max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:4px}
  .pet-msg{max-width:86%;padding:4px 8px;border-radius:9px;white-space:pre-wrap;word-break:break-word}
  .pet-msg.me{align-self:flex-end;background:rgba(120,180,160,.26)}
  .pet-msg.her{align-self:flex-start;background:rgba(255,255,255,.92);
               border:1px solid rgba(140,175,160,.32)}
  .pet-msg.note{align-self:center;background:transparent;color:rgba(95,130,112,.8);
               font-size:10px;padding:1px 4px}
  #pet-row{display:flex;gap:6px}
  #pet-input{flex:1;min-width:0;padding:5px 8px;border-radius:8px;font:11px/1.5 "Microsoft YaHei",system-ui;
             border:1px solid rgba(140,175,160,.45);background:#fff;color:#2f4a3f;outline:none}
  #pet-input:focus{border-color:rgba(80,150,125,.75)}
  #pet-send{padding:5px 11px;border-radius:8px;border:0;cursor:pointer;
            background:rgba(96,158,132,.9);color:#fff;font:11px/1.5 "Microsoft YaHei",system-ui}
  #pet-send:hover{background:rgba(80,142,116,.95)}
  html.pet-collapsed{visibility:hidden!important}
  html.pet-collapsed #pet-handle{visibility:visible!important}
  body.pet-collapsed #model-canvas,body.pet-collapsed #pet-grip,body.pet-collapsed #pet-chat-btn,
  body.pet-collapsed #pet-panel,body.pet-collapsed #pet-bubble,body.pet-collapsed #pet-hint{display:none!important}
  body.pet-collapsed #pet-handle{display:block!important;left:6px;top:6px;width:72px;height:72px;
                                 opacity:1;cursor:pointer;box-shadow:0 6px 18px rgba(20,40,70,.34)}
`

function runInject() {
  if (!win || win.isDestroyed()) return
  win.webContents.insertCSS(PET_CSS).catch(() => {})
  let script = ''
  try {
    script = fs.readFileSync(injectPath(), 'utf8')
  } catch {
    script = ''
  }
  if (!script) return
  // 头像缩略图以 data URL 注入：页面是 http:// 的，加载 file:// 会被拦，内置最稳。
  let avatar = ''
  const customAvatar = String(setting('avatar', '') || '')
  if (customAvatar && fs.existsSync(customAvatar)) {
    try {
      const ext = path.extname(customAvatar).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      avatar = `data:${mime};base64,${fs.readFileSync(customAvatar).toString('base64')}`
    } catch {
      avatar = ''
    }
  }
  try {
    if (!avatar) {
      const raw = fs.readFileSync(avatarDataPath(), 'utf8').trim()
      avatar = raw ? `data:image/jpeg;base64,${raw}` : ''
    }
  } catch {
    avatar = ''
  }
  const debugFlag = process.env.L2D_PET_DEBUG ? 'window.__petDebug=true;\n' : ''
  const followFlag = savedFollow() ? 'window.__petFollow=true;\n' : 'window.__petFollow=false;\n'
  const idleFlag = savedIdle() ? 'window.__petIdle=true;\n' : 'window.__petIdle=false;\n'
  const idleTuning =
    `window.__petIdleMin=${Number(setting('idleMinMs', 22000)) || 22000};\n` +
    `window.__petIdleSpread=${Number(setting('idleSpreadMs', 45000)) || 0};\n` +
    `window.__petIdleAllow=${JSON.stringify(Array.isArray(setting('idleActions', [])) ? setting('idleActions', []) : [])};\n` +
    `window.__petBubbleHold=${Number(setting('bubbleHoldMs', 9000)) || 9000};\n`
  const idleGap = process.env.L2D_PET_IDLE_MIN ? `window.__petIdleMin=${Number(process.env.L2D_PET_IDLE_MIN)};\n` : ''
  const prelude = debugFlag + followFlag + idleFlag + idleTuning + idleGap + (avatar ? `window.__petAvatar='${avatar}';\n` : '')
  win.webContents.executeJavaScript(prelude + script, true).catch(() => {})
  // 宠物要整个人站在那儿，不是近景裁一半；等页面把按钮事件挂上再点。
  for (const delay of [1200, 2600, 4200]) {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      win.webContents
        .executeJavaScript('document.querySelector(\'[data-view="full"]\')?.click()', true)
        .catch(() => {})
    }, delay)
  }
  // 调试用：把面板/收起状态摆出来，方便截图核对。只在第一次注入时排一次。
  if (debugActionsDone) return
  if (!process.env.L2D_PET_CHAT && !process.env.L2D_PET_COLLAPSE && !process.env.L2D_PET_CHAT_SEND) return
  debugActionsDone = true
  if (process.env.L2D_PET_CHAT === '1') {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      win.webContents
        .executeJavaScript("document.getElementById('pet-chat-btn')?.click(); true", true)
        .catch(() => {})
    }, 5200)
  }
  if (process.env.L2D_PET_COLLAPSE === '1') {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      setCollapsed(true)
      applyCollapsedVisual(true)
    }, 6200)
  }
  if (process.env.L2D_PET_CHAT_SEND) {
    const text = JSON.stringify(String(process.env.L2D_PET_CHAT_SEND).slice(0, 200))
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      win.webContents
        .executeJavaScript(`
          (() => {
            const input = document.getElementById('pet-input')
            if (!input) return 'no input'
            input.value = ${text}
            document.getElementById('pet-send').click()
            return 'sent'
          })()
        `, true)
        .then((r) => console.error(`[pet] chat send: ${r}`))
        .catch((error) => console.error(`[pet] chat send failed: ${error.message}`))
    }, 7000)
  }
}

function applyCollapsedVisual(next) {
  if (!win || win.isDestroyed()) return
  win.webContents
    .executeJavaScript(
      `document.documentElement.classList.toggle('pet-collapsed', ${next});
       document.body.classList.toggle('pet-collapsed', ${next}); true`,
      true,
    )
    .catch(() => {})
}

function say(text) {
  if (!win || win.isDestroyed() || !text) return
  const payload = JSON.stringify(String(text).slice(0, 600))
  win.webContents.executeJavaScript(`
    (() => {
      const bubble = document.getElementById('pet-bubble')
      if (!bubble) return false
      bubble.textContent = ${payload}
      bubble.classList.add('on')
      clearTimeout(window.__petBubbleTimer)
      window.__petBubbleTimer = setTimeout(() => bubble.classList.remove('on'), 9000)
      return true
    })()
  `, true).catch(() => {})
}

function watchSayFile() {
  setInterval(() => {
    try {
      const text = fs.readFileSync(sayPath(), 'utf8').trim()
      if (text && text !== lastSay) {
        lastSay = text
        say(text)
      }
    } catch {
      /* 没有这句话就不说话 */
    }
  }, 1200)
}

// ---- 聊天记录：一行一条 JSON，user 是我打的，assistant 是洄回的 ----------------
function readChat(limit = 60) {
  let raw = ''
  try {
    raw = fs.readFileSync(chatPath(), 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (!text) continue
    try {
      const item = JSON.parse(text)
      if (item && typeof item.text === 'string' && (item.role === 'user' || item.role === 'assistant')) out.push(item)
    } catch {
      /* 半行/脏行跳过就好 */
    }
  }
  return out.slice(-limit)
}

function appendChat(role, text) {
  const item = { ts: Date.now(), role, text: String(text).slice(0, 2000) }
  try {
    fs.appendFileSync(chatPath(), `${JSON.stringify(item)}\n`, 'utf8')
  } catch {
    return null
  }
  return item
}

function readStats() {
  try {
    return JSON.parse(fs.readFileSync(statsPath(), 'utf8'))
  } catch {
    return null
  }
}

function setCollapsed(next) {
  if (!win || win.isDestroyed()) return null
  const want = !!next
  if (want === collapsed) return { collapsed }
  if (want) {
    collapsedFrom = win.getBounds()
    const area = screen.getPrimaryDisplay().workArea
    const x = Math.max(
      area.x,
      Math.min(collapsedFrom.x + collapsedFrom.width - COLLAPSED_SIZE, area.x + area.width - COLLAPSED_SIZE),
    )
    const y = Math.max(area.y, Math.min(collapsedFrom.y, area.y + area.height - COLLAPSED_SIZE))
    collapsed = true
    win.setBounds({ x, y, width: COLLAPSED_SIZE, height: COLLAPSED_SIZE })
  } else {
    collapsed = false
    if (collapsedFrom) {
      win.setBounds(collapsedFrom)
      collapsedFrom = null
    }
  }
  return { collapsed }
}

// 窗口被甩动时，让她身上有点惯性：朝着移动的反方向偏一下，头发尾巴跟着荡。
async function sendInertia(deltaX) {
  if (Date.now() < inertiaReadyAt) return
  const now = Date.now()
  if (now - lastInertiaAt < 420) return
  const speed = Math.abs(deltaX)
  if (speed < 4) return
  lastInertiaAt = now
  const direction = deltaX > 0 ? 'left' : 'right'
  const strength = Math.min(0.95, 0.3 + speed / 90)
  const plan = {
    version: 1,
    view: 'full',
    title: '被晃到了',
    intent: '整块被搬动，身体先朝反方向让一下',
    summary: '顺着惯性往反方向偏，再自己回正',
    actions: [{ kind: 'tilt', direction, at: 0.08, duration: 0.5, strength }],
  }
  try {
    await fetch(`${BRIDGE}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    })
  } catch {
    /* 舞台没开就算了 */
  }
}

// 光标在整个屏幕上跑，窗口只有一小块：主进程按屏幕坐标算方位再叫页面抬眼。
let lastGlobalZone = ''
function startGazePolling() {
  setInterval(() => {
    if (!win || win.isDestroyed() || collapsed || !savedFollow()) return
    let point = null
    try {
      point = screen.getCursorScreenPoint()
    } catch {
      return
    }
    if (!point) return
    const bounds = win.getBounds()
    const inside =
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    if (inside) return // 窗口内交给页面的 mousemove，更细
    const headX = bounds.x + bounds.width / 2
    const headY = bounds.y + bounds.height * 0.2
    const dx = (point.x - headX) / Math.max(160, bounds.width * 0.9)
    const dy = (point.y - headY) / Math.max(200, bounds.height * 0.9)
    let zone = 'center'
    if (Math.abs(dy) > Math.abs(dx) && dy < -0.32) zone = 'up'
    else if (dx < -0.28) zone = 'left'
    else if (dx > 0.28) zone = 'right'
    const far = Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6
    if (zone === lastGlobalZone) return
    lastGlobalZone = zone
    if (zone === 'center' && !far) return
    win.webContents
      .executeJavaScript(`window.__petGaze && window.__petGaze(${JSON.stringify(zone)}, ${far})`, true)
      .catch(() => {})
  }, 240)
}

function applyWidth(width, { save = true } = {}) {
  if (!win || win.isDestroyed() || collapsed) return
  const nextWidth = clampWidth(width)
  const nextHeight = heightFor(nextWidth)
  const bounds = win.getBounds()
  if (nextWidth === bounds.width && nextHeight === bounds.height) return
  // 右下角是钉住的：变大时往左上长，但别顶出屏幕。
  const area = screen.getPrimaryDisplay().workArea
  const nextX = Math.max(area.x, Math.min(bounds.x - (nextWidth - bounds.width), area.x + area.width - nextWidth))
  const nextY = Math.max(area.y, Math.min(bounds.y - (nextHeight - bounds.height), area.y + area.height - nextHeight))
  win.setBounds({ x: nextX, y: nextY, width: nextWidth, height: nextHeight })
  if (save) saveState({ width: nextWidth, height: nextHeight, x: nextX, y: nextY })
  const dx = nextX - bounds.x
  if (Math.abs(dx) >= 6) sendInertia(dx).catch(() => {})
}

function placeAt(width) {
  const area = screen.getPrimaryDisplay().workArea
  const x = area.x + area.width - width - 24
  const y = area.y + area.height - heightFor(width) - 12
  return { x, y }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: win ? win.isAlwaysOnTop() : true,
      click: (item) => win && win.setAlwaysOnTop(item.checked, 'screen-saver'),
    },
    {
      label: '忽略鼠标（穿透）',
      type: 'checkbox',
      checked: clickThrough,
      click: (item) => {
        clickThrough = item.checked
        win.setIgnoreMouseEvents(clickThrough, { forward: true })
      },
    },
    { type: 'separator' },
    {
      label: '大小',
      submenu: SIZE_PRESETS.map((preset) => ({
        label: preset.label,
        type: 'radio',
        checked: win ? Math.abs(win.getBounds().width - preset.width) < 3 : false,
        click: () => applyWidth(preset.width),
      })),
    },
    {
      label: '放回屏幕右下角',
      click: () => {
        if (collapsed) return
        const width = win.getBounds().width
        const { x, y } = placeAt(width)
        win.setPosition(x, y)
        saveState({ x, y })
      },
    },
    { label: '打开完整工作台', click: () => require('electron').shell.openExternal(STAGE_URL) },
    { type: 'separator' },
    {
      label: collapsed ? '展开' : '收起成头像',
      click: () => {
        const next = !collapsed
        setCollapsed(next)
        applyCollapsedVisual(next)
      },
    },
    {
      label: '聊天框',
      click: () => {
        if (win && !win.isDestroyed()) {
          win.webContents
            .executeJavaScript("document.getElementById('pet-chat-btn')?.click(); true", true)
            .catch(() => {})
        }
      },
    },
    {
      label: '视线跟着鼠标',
      type: 'checkbox',
      checked: savedFollow(),
      click: (item) => {
        saveState({ follow: item.checked })
        if (win && !win.isDestroyed()) {
          win.webContents.executeJavaScript(`window.__petFollow=${item.checked}; true`, true).catch(() => {})
        }
      },
    },
    {
      label: '闲着的时候自己动',
      type: 'checkbox',
      checked: savedIdle(),
      click: (item) => {
        saveState({ idle: item.checked })
        if (win && !win.isDestroyed()) {
          win.webContents.executeJavaScript(`window.__petSetIdle && window.__petSetIdle(${item.checked}); true`, true).catch(() => {})
        }
      },
    },
    { type: 'separator' },
    { label: '关掉这只', click: () => app.quit() },
  ])
}

function createWindow() {
  const saved = readState()
  const width = clampWidth(Number(setting('width', saved.width)) || 435)
  const height = heightFor(width)
  const fallback = placeAt(width)
  const x = Number.isFinite(saved.x) ? saved.x : fallback.x
  const y = Number.isFinite(saved.y) ? saved.y : fallback.y

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: process.env.L2D_PET_OPAQUE !== '1',
    backgroundColor: process.env.L2D_PET_BG || (process.env.L2D_PET_OPAQUE === '1' ? '#20302a' : '#00000000'),
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: saved.alwaysOnTop !== false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  win.setAlwaysOnTop(win.isAlwaysOnTop(), 'screen-saver')
  const opacity = Number(setting('opacity', 1))
  if (Number.isFinite(opacity)) win.setOpacity(Math.max(0.25, Math.min(1, opacity)))
  win.loadURL(STAGE_URL)
  runInject()
  win.webContents.on('did-finish-load', runInject)
  win.webContents.on('did-navigate', runInject)

  win.on('move', () => {
    const { x: px, y: py } = win.getBounds()
    // 拖动时 move 会连发上百次，落盘攒到停手之后再写一次。
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!collapsed) saveState({ x: px, y: py })
    }, 220)
    // 一次拖动会连着发很多小位移，按“这一趟总共挪了多少”来算惯性。
    const now = Date.now()
    if (burstFromX === null || now - burstAt > 300) {
      burstFromX = px
      burstAt = now
    }
    clearTimeout(burstTimer)
    const from = burstFromX
    burstTimer = setTimeout(() => {
      const delta = px - from
      burstFromX = null
      if (Math.abs(delta) >= 6 && !collapsed) sendInertia(delta).catch(() => {})
    }, 200)
  })

  win.webContents.on('context-menu', () => {
    buildMenu().popup({ window: win })
  })

  if (process.env.L2D_PET_SELFTEST === '1') {
    setTimeout(async () => {
      const script = `
        (() => {
          const w = window.innerWidth, h = window.innerHeight
          const fire = (type, x, y) => window.dispatchEvent(new PointerEvent(type, {clientX:x, clientY:y, bubbles:true, pointerId:1}))
          let i = 0
          const poke = () => { fire('pointerdown', w/2, h/2); fire('pointerup', w/2, h/2); if (++i < 4) setTimeout(poke, 140) }
          poke()
          setTimeout(() => {
            fire('pointerdown', w/2, h/2)
            setTimeout(() => fire('pointermove', w/2 + 60, h/2), 120)
            setTimeout(() => fire('pointerup', w/2 + 60, h/2), 380)
          }, 900)
          return 'selftest fired'
        })()
      `
      const result = await win.webContents.executeJavaScript(script, true).catch((error) => String(error))
      console.error(`[pet] selftest: ${result}`)
    }, 9000)
  }

  if (process.env.L2D_PET_DEBUG === '1') {
    win.webContents.on('console-message', (_event, level, message) => {
      console.error(`[page:${level}] ${message}`)
    })
    setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage()
        fs.writeFileSync(path.join(__dirname, 'capture.png'), image.toPNG())
        const view = await win
          .webContents.executeJavaScript(
            'document.querySelector(\'[data-view="full"]\').getAttribute("aria-pressed") + "|" + window.innerWidth + "x" + window.innerHeight',
            true,
          )
          .catch((error) => `err:${error.message}`)
        console.error(`[pet] bounds=${JSON.stringify(win.getBounds())} visible=${win.isVisible()} size=${JSON.stringify(image.getSize())} full=${view}`)
      } catch (error) {
        console.error(`[pet] capture failed: ${error.message}`)
      }
    }, 8000)
  }

  win.on('closed', () => {
    win = null
  })
}

ipcMain.handle('pet:menu', () => {
  if (!win) return null
  buildMenu().popup({ window: win })
  return true
})

ipcMain.handle('pet:move-by', (_event, { dx = 0, dy = 0 } = {}) => {
  if (!win) return null
  const bounds = win.getBounds()
  const area = screen.getPrimaryDisplay().workArea
  const keepVisibleX = Math.min(160, Math.round(bounds.width * 0.35))
  const keepVisibleY = Math.min(160, Math.round(bounds.height * 0.35))
  const minX = area.x - bounds.width + keepVisibleX
  const maxX = area.x + area.width - keepVisibleX
  const minY = area.y
  const maxY = area.y + area.height - keepVisibleY
  const nextX = Math.max(minX, Math.min(maxX, Math.round(bounds.x + (Number(dx) || 0))))
  const nextY = Math.max(minY, Math.min(maxY, Math.round(bounds.y + (Number(dy) || 0))))
  if (process.env.L2D_PET_DEBUG) {
    console.error(`[pet] moveBy dx=${dx} dy=${dy} ${bounds.x},${bounds.y} -> ${nextX},${nextY}`)
  }
  if (nextX !== bounds.x || nextY !== bounds.y) win.setPosition(nextX, nextY)
  return { x: nextX, y: nextY }
})

ipcMain.handle('pet:resize-by', (_event, { dx = 0, dy = 0 } = {}) => {
  if (!win) return null
  const current = win.getBounds().width
  const byX = (Number(dx) || 0) * 0.9
  const byY = (Number(dy) || 0) / RATIO
  const delta = Math.abs(byX) >= Math.abs(byY) ? byX : byY
  if (Math.abs(delta) < 1) return current
  applyWidth(current + delta)
  return win.getBounds().width
})

ipcMain.handle('pet:set-width', (_event, { width } = {}) => {
  applyWidth(Number(width) || 435)
  return win ? win.getBounds().width : null
})

ipcMain.handle('pet:size', () => (win ? win.getBounds() : null))

ipcMain.handle('pet:set-collapsed', (_event, { collapsed: next } = {}) => {
  const result = setCollapsed(Boolean(next))
  if (process.env.L2D_PET_DEBUG) {
    console.error(`[pet] collapsed=${result && result.collapsed} bounds=${JSON.stringify(win && win.getBounds())}`)
  }
  return result
})

ipcMain.handle('pet:chat-send', (_event, { text } = {}) => {
  const clean = String(text || '').trim()
  if (!clean) return null
  const item = appendChat('user', clean)
  if (process.env.L2D_PET_DEBUG) console.error(`[pet] chat <- ${clean.length} chars`)
  return item
})

ipcMain.handle('pet:chat-read', () => readChat(60))

ipcMain.handle('pet:stats', () => {
  const stats = readStats()
  if (!stats) return null
  return { line: stats.line || '', ...stats }
})

app.whenReady().then(() => {
  createWindow()
  watchSayFile()
  startGazePolling()

  globalShortcut.register('Control+Alt+L', () => {
    if (!win) return
    clickThrough = !clickThrough
    win.setIgnoreMouseEvents(clickThrough, { forward: true })
  })
  globalShortcut.register('Control+Alt+T', () => {
    if (!win) return
    const next = !win.isAlwaysOnTop()
    win.setAlwaysOnTop(next, 'screen-saver')
    saveState({ alwaysOnTop: next })
  })
  globalShortcut.register('Control+Alt+-', () => {
    if (win) applyWidth(win.getBounds().width - 40)
  })
  globalShortcut.register('Control+Alt+=', () => {
    if (win) applyWidth(win.getBounds().width + 40)
  })
  globalShortcut.register('Control+Alt+H', () => {
    if (!win) return
    const next = !collapsed
    setCollapsed(next)
    applyCollapsedVisual(next)
  })
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => globalShortcut.unregisterAll())
