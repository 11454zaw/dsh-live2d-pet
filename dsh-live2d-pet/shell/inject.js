// 渲染层外壳：头像、气泡、聊天框、Token 条，以及“点/拖/盯着看”的反应。
// 由 main.js 用 executeJavaScript 注入，跑在鲸语页面自己的上下文里。
(() => {
  const BUILD = 'inject-6'
  if (window.__petBuild === BUILD) return true
  window.__petBuild = BUILD
  window.__petBusyUntil = window.__petBusyUntil || 0
  window.__petFollow = window.__petFollow !== false

  async function execute(plan) {
    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: { version: 1, view: 'full', ...plan } }),
      })
      if (response.ok) return response.json()
      return null
    } catch {
      return null
    }
  }

  async function postPlan(plan, { force = false } = {}) {
    const now = Date.now()
    if (!force && now < window.__petBusyUntil) return null
    const duration = (plan.actions || []).reduce(
      (latest, action) => Math.max(latest, (action.at || 0) + (action.duration || 0)),
      0,
    )
    window.__petBusyUntil = now + Math.max(360, duration * 1000 + 200)
    if (force) {
      try {
        await fetch('/api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      } catch {
        /* 停不下来就直接发，让服务端自己判断 */
      }
    }
    return execute(plan)
  }

  function sayLocal(line, hold = Number(window.__petBubbleHold) || 6000) {
    if (window.__petTouch) window.__petTouch()
    const bubble = document.getElementById('pet-bubble')
    if (!bubble) return
    bubble.textContent = line
    bubble.classList.add('on')
    clearTimeout(window.__petBubbleTimer)
    window.__petBubbleTimer = setTimeout(() => bubble.classList.remove('on'), hold)
  }

  function ensureShell() {
    if (document.getElementById('pet-handle')) return
    const drag = document.createElement('div')
    drag.id = 'pet-drag'
    document.body.appendChild(drag)

    const bubble = document.createElement('div')
    bubble.id = 'pet-bubble'
    document.body.appendChild(bubble)

    const hint = document.createElement('div')
    hint.id = 'pet-hint'
    hint.textContent = '按住她挪 · 点头像收起 · 右下角缩放 · 右键菜单'
    document.body.appendChild(hint)
    drag.addEventListener('mouseenter', () => hint.classList.add('on'))
    drag.addEventListener('mouseleave', () => hint.classList.remove('on'))

    const grip = document.createElement('div')
    grip.id = 'pet-grip'
    document.body.appendChild(grip)

    const handle = document.createElement('div')
    handle.id = 'pet-handle'
    handle.title = '按住拖动 · 点一下收起 · 右键菜单'
    if (window.__petAvatar) handle.style.backgroundImage = `url("${window.__petAvatar}")`
    document.body.appendChild(handle)

    // 聊天/统计面板
    const panel = document.createElement('div')
    panel.id = 'pet-panel'
    panel.innerHTML = `
      <div id="pet-stats">—</div>
      <div id="pet-log"></div>
      <div id="pet-row">
        <input id="pet-input" type="text" maxlength="200" placeholder="跟她说句话…（回车发送）" />
        <button id="pet-send" type="button">发</button>
      </div>`
    document.body.appendChild(panel)

    const chatBtn = document.createElement('button')
    chatBtn.id = 'pet-chat-btn'
    chatBtn.type = 'button'
    chatBtn.title = '聊天'
    chatBtn.textContent = '聊'
    document.body.appendChild(chatBtn)
  }

  // ---- 头像：拖窗口 / 点收起 / 右键菜单 -------------------------------------
  function wireHandle() {
    const handle = document.getElementById('pet-handle')
    if (!handle || handle.dataset.wired) return
    handle.dataset.wired = '1'

    let down = false
    let startX = 0
    let startY = 0
    let lastX = 0
    let lastY = 0
    let moved = false

    handle.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      window.petShell?.openMenu?.()
    })

    handle.addEventListener('pointerdown', (event) => {
      if (event.button === 2) return
      down = true
      moved = false
      startX = event.screenX
      startY = event.screenY
      lastX = event.screenX
      lastY = event.screenY
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        /* 拿不到捕获也能拖，只要光标还在窗口里 */
      }
      event.preventDefault()
      event.stopPropagation()
    })

    handle.addEventListener('pointermove', (event) => {
      if (!down || !window.petShell) return
      if (!moved && (Math.abs(event.screenX - startX) > 2 || Math.abs(event.screenY - startY) > 2)) {
        moved = true
        document.body.classList.add('pet-grabbing')
      }
      const dx = event.screenX - lastX
      const dy = event.screenY - lastY
      lastX = event.screenX
      lastY = event.screenY
      if (moved && (dx || dy)) window.petShell.moveBy(dx, dy)
      event.preventDefault()
      event.stopPropagation()
    })

    const finish = (event) => {
      if (!down) return
      down = false
      document.body.classList.remove('pet-grabbing')
      try {
        handle.releasePointerCapture(event.pointerId)
      } catch {
        /* 已经放开过了 */
      }
      if (!moved) toggleCollapsed()
      event.preventDefault()
      event.stopPropagation()
    }
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', () => {
      down = false
      document.body.classList.remove('pet-grabbing')
    })
  }

  function applyCollapsed(collapsed) {
    document.documentElement.classList.toggle('pet-collapsed', !!collapsed)
    document.body.classList.toggle('pet-collapsed', !!collapsed)
    const handle = document.getElementById('pet-handle')
    if (handle) handle.title = collapsed ? '点一下展开' : '按住拖动 · 点一下收起'
  }

  function toggleCollapsed() {
    const next = !document.body.classList.contains('pet-collapsed')
    applyCollapsed(next)
    window.petShell?.setCollapsed?.(next)
    if (!next) sayLocal('回来了。', 2600)
  }

  // ---- 缩放：右下角手柄 + Ctrl+滚轮 -----------------------------------------
  function wireResize() {
    const grip = document.getElementById('pet-grip')
    if (!grip || grip.dataset.wired) return
    grip.dataset.wired = '1'
    let dragging = false
    let lastX = 0
    let lastY = 0

    grip.addEventListener('pointerdown', (event) => {
      dragging = true
      lastX = event.screenX
      lastY = event.screenY
      grip.setPointerCapture(event.pointerId)
      event.preventDefault()
    })
    grip.addEventListener('pointermove', (event) => {
      if (!dragging || !window.petShell) return
      const dx = event.screenX - lastX
      const dy = event.screenY - lastY
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
      lastX = event.screenX
      lastY = event.screenY
      window.petShell.resizeBy(dx, dy)
    })
    const stop = (event) => {
      if (!dragging) return
      dragging = false
      try {
        grip.releasePointerCapture(event.pointerId)
      } catch {
        /* 已经放开过了 */
      }
    }
    grip.addEventListener('pointerup', stop)
    grip.addEventListener('pointercancel', stop)

    window.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey || !window.petShell) return
        event.preventDefault()
        window.petShell.resizeBy(0, event.deltaY > 0 ? -28 : 28)
      },
      { passive: false },
    )
  }

  // ---- 视线跟着光标 ----------------------------------------------------------
  let lastGaze = 0
  let lastZone = ''
  // 主进程用屏幕坐标调它（光标在窗口外时也跟），页面自己也调（窗口内更细）。
  function gazeAt(zone, far) {
    if (!window.__petFollow) return false
    const now = Date.now()
    if (now - lastGaze < 700 || now < window.__petBusyUntil) return false
    if (zone === lastZone) return false
    lastZone = zone
    lastGaze = now
    if (zone === 'center' && !far) return false
    const actions = [{ kind: 'look', direction: zone, at: 0.1, duration: 0.85, strength: far ? 0.86 : 0.66 }]
    if (far && zone !== 'up') {
      actions.push({ kind: 'tilt', direction: zone, at: 0.16, duration: 0.9, strength: 0.22 })
    }
    postPlan({ title: '看过去', intent: '把视线挪向你的方向', summary: '眼睛先动，跟得远了才带一点头', actions })
    return true
  }
  window.__petGaze = gazeAt

  function gaze(event) {
    if (!window.__petFollow) return
    const x = event.clientX / Math.max(1, window.innerWidth) - 0.5
    const y = event.clientY / Math.max(1, window.innerHeight) - 0.34
    let zone = 'center'
    if (Math.abs(y) > Math.abs(x) && y < -0.18) zone = 'up'
    else if (x < -0.18) zone = 'left'
    else if (x > 0.18) zone = 'right'
    gazeAt(zone, Math.abs(x) > 0.36 || Math.abs(y) > 0.36)
  }

  // ---- 点、戳、拖 ------------------------------------------------------------
  const SETTLE = (direction) => ({
    title: '站稳',
    intent: '被放开之后晃两下慢慢站定',
    summary: '阻尼回摆，幅度递减',
    actions: [
      {
        kind: 'trajectory',
        at: 0.1,
        duration: 1.25,
        frames: [
          { time: 0.2, values: { AngleZ: direction * 6.0, AngleX: 0.4 } },
          { time: 0.55, values: { AngleZ: direction * -3.0, AngleX: -0.2 } },
          { time: 0.85, values: { AngleZ: direction * 1.4, AngleX: 0.1 } },
          { time: 1.1, values: { AngleZ: direction * -0.4, AngleX: 0 } },
        ],
      },
      { kind: 'blink', at: 0.75, duration: 0.4, count: 1 },
    ],
  })

  // ---- 闲置：没人理的时候，她自己动一下 --------------------------------------
  // 间隔不是固定的：最短 12 秒、平均半分钟上下，偶尔连做两个。聊天面板开着的时候
  // 不插动作（正在说话，别抢她的嘴），收起成头像时也停。
  const IDLE_MOVES = [
    {
      weight: 4,
      plan: () => ({
        title: '闲着·望一眼',
        intent: '没人说话，先往旁边看一眼',
        summary: '视线偏出去，眨一下',
        actions: [
          { kind: 'look', direction: Math.random() < 0.5 ? 'left' : 'right', at: 0.05, duration: 0.9, strength: 0.62 },
          { kind: 'blink', at: 0.55, duration: 0.4, count: 1 },
        ],
      }),
    },
    {
      weight: 3,
      plan: () => ({
        title: '闲着·想事情',
        intent: '偏着头想点什么',
        summary: '偏头、抬眼、慢慢眨一下',
        actions: [
          { kind: 'tilt', direction: Math.random() < 0.5 ? 'left' : 'right', at: 0.05, duration: 1.1, strength: 0.3 },
          { kind: 'look', direction: 'up', at: 0.2, duration: 0.9, strength: 0.5 },
          { kind: 'blink', at: 0.85, duration: 0.45, count: 1 },
        ],
      }),
    },
    {
      weight: 3,
      plan: () => ({
        title: '闲着·眨眼',
        intent: '眨两下眼睛',
        summary: '眨眼两下，顺便点一下头',
        actions: [
          { kind: 'blink', at: 0.05, duration: 0.5, count: 2 },
          { kind: 'nod', at: 0.55, duration: 0.7, count: 1 },
        ],
      }),
    },
    {
      weight: 2,
      plan: () => ({
        title: '闲着·点头',
        intent: '轻轻点一下头',
        summary: '点头一下，回正',
        actions: [
          { kind: 'nod', at: 0.05, duration: 0.8, count: 1 },
          { kind: 'blink', at: 0.6, duration: 0.4, count: 1 },
        ],
      }),
    },
    {
      weight: 2,
      plan: () => ({
        title: '闲着·松一口气',
        intent: '松一口气，肩膀塌下来一点',
        summary: '低头、浅浅笑一下、偏一点头',
        actions: [
          { kind: 'look', direction: 'down', at: 0.05, duration: 1.0, strength: 0.45 },
          { kind: 'smile', at: 0.35, duration: 0.8, strength: 0.22 },
          { kind: 'tilt', direction: 'left', at: 0.45, duration: 0.9, strength: 0.16 },
        ],
      }),
    },
    {
      weight: 1,
      plan: () => ({
        title: '闲着·理袖子',
        intent: '抬手理一下袖口',
        summary: '手放到胸口再放下',
        actions: [
          { kind: 'gesture', name: 'hand_on_chest', at: 0.05, duration: 2.2 },
          { kind: 'look', direction: 'down', at: 0.4, duration: 0.9, strength: 0.35 },
        ],
      }),
    },
    {
      weight: 1,
      plan: () => ({
        title: '闲着·被叫醒',
        intent: '像被谁喊了一声似的',
        summary: '摇一下头、睁眼',
        actions: [
          { kind: 'shake_head', at: 0.05, duration: 0.7, count: 1 },
          { kind: 'blink', at: 0.4, duration: 0.35, count: 1 },
        ],
      }),
    },
    {
      weight: 1,
      plan: () => ({
        title: '闲着·不屑',
        intent: '想通了什么，露出一点不屑',
        summary: '屑屑眼闪一下',
        actions: [
          { kind: 'expression', name: '屑屑眼', layer: 'exclusive', at: 0.05, duration: 1.8 },
          { kind: 'tilt', direction: 'right', at: 0.2, duration: 0.9, strength: 0.2 },
        ],
      }),
    },
    {
      weight: 1,
      plan: () => ({
        title: '闲着·笑一下',
        intent: '想到什么，笑一下',
        summary: '＞＜ 半张脸，马上收',
        actions: [
          { kind: 'expression', name: '＞＜', layer: 'exclusive', at: 0.05, duration: 1.5 },
          { kind: 'blink', at: 0.9, duration: 0.4, count: 1 },
        ],
      }),
    },
  ]

  const idleState = {
    lastActivity: Date.now(),
    nextAt: 0,
    lastAt: 0,
    chain: 0,
  }
  window.__petIdle = window.__petIdle !== false
  // 默认 22–67 秒动一下：太勤像抽搐，太懒像死机。
  window.__petIdleMin = Number(window.__petIdleMin) || 22000
  window.__petIdleSpread = Number(window.__petIdleSpread) || 45000

  function touchIdle() {
    idleState.lastActivity = Date.now()
    idleState.chain = 0
  }
  window.__petTouch = touchIdle
  window.__petSetIdle = (on) => {
    window.__petIdle = Boolean(on)
    idleState.nextAt = 0
    idleState.lastActivity = Date.now()
  }

  function pickIdleMove() {
    // 设置页可以把某些待机动作关掉；空数组 = 全部允许。
    const allow = Array.isArray(window.__petIdleAllow) ? window.__petIdleAllow : []
    const pool = allow.length ? IDLE_MOVES.filter((m) => allow.includes(m.name)) : IDLE_MOVES
    const list = pool.length ? pool : IDLE_MOVES
    const total = list.reduce((sum, m) => sum + m.weight, 0)
    let roll = Math.random() * total
    for (const move of list) {
      roll -= move.weight
      if (roll <= 0) return move
    }
    return list[0]
  }

  function idleBlockedReason() {
    const now = Date.now()
    if (!window.__petIdle) return 'idle off'
    if (document.documentElement.classList.contains('pet-collapsed')) return 'collapsed'
    const panel = document.getElementById('pet-panel')
    if (panel && panel.classList.contains('on')) return 'chat open'
    if (now < (window.__petBusyUntil || 0)) return 'busy'
    if (now - idleState.lastActivity < 8000) return 'recent activity ' + (now - idleState.lastActivity)
    return ''
  }

  function idleBlocked() {
    return Boolean(idleBlockedReason())
  }

  function idleTick() {
    const why = idleBlockedReason()
    if (why) {
      if (window.__petDebug) console.log('[pet-idle] blocked: ' + why)
      return Promise.resolve()
    }
    const now = Date.now()
    if (now < idleState.nextAt) return Promise.resolve()
    // 上一次动完到这次，至少留 6 秒
    if (now - idleState.lastAt < 6000) return Promise.resolve()
    const move = pickIdleMove()
    const gap = window.__petIdleMin + Math.random() * window.__petIdleSpread
    idleState.nextAt = now + gap
    idleState.lastAt = now
    idleState.lastActivity = now
    if (window.__petDebug) console.log('[pet-idle] fire: ' + move.plan().title + ' next in ' + Math.round(gap) + 'ms')
    return postPlan(move.plan()).catch((error) => {
      if (window.__petDebug) console.log('[pet-idle] plan failed: ' + (error && error.message ? error.message : error))
    })
  }

  // 偶尔连着做第二个：让"闲着"看起来不是定时器
  async function idleMaybeChain() {
    if (idleBlocked()) return
    if (Math.random() > 0.22) return
    if (idleState.chain >= 1) return
    idleState.chain += 1
    await new Promise((resolve) => setTimeout(resolve, 2600 + Math.random() * 3600))
    if (idleBlocked()) return
    const move = pickIdleMove()
    idleState.lastAt = Date.now()
    await postPlan(move.plan())
  }

  function startIdle() {
    if (window.__petIdleTimer) return
    window.__petIdleTimer = setInterval(() => {
      idleTick().then(idleMaybeChain).catch(() => {})
    }, 1800)
  }
  startIdle()
  window.__petIdleNow = () => {
    idleState.nextAt = 0
    idleState.lastActivity = 0
    return idleTick()
  }

  function wirePointer() {
    if (window.__petPointerWired) return
    window.__petPointerWired = true

    let downAt = 0
    let downX = 0
    let downScreenX = 0
    let downScreenY = 0
    let lastScreenX = 0
    let lastScreenY = 0
    let moved = false
    let leaning = false
    let dragging = false
    let captureTarget = null

    window.addEventListener('pointermove', gaze, true)

    window.addEventListener('pointerdown', (event) => {
      if (event.target && event.target.closest && event.target.closest('#pet-grip,#pet-handle,#pet-panel,#pet-chat-btn')) return
      if (window.__petTouch) window.__petTouch()
      downAt = Date.now()
      downX = event.clientX
      downScreenX = event.screenX
      downScreenY = event.screenY
      lastScreenX = event.screenX
      lastScreenY = event.screenY
      moved = false
      leaning = false
      dragging = false
      captureTarget = event.target
      try {
        captureTarget.setPointerCapture(event.pointerId)
      } catch {
        /* 拿不到就算了，鼠标在窗口内时照样能用 */
      }
    }, true)

    window.addEventListener('pointermove', (event) => {
      if (!downAt) return
      const totalX = event.screenX - downScreenX
      const totalY = event.screenY - downScreenY
      if (!dragging && (Math.abs(totalX) > 3 || Math.abs(totalY) > 3)) {
        dragging = true
        document.body.classList.add('pet-grabbing')
      }
      if (dragging && window.petShell) {
        const dx = event.screenX - lastScreenX
        const dy = event.screenY - lastScreenY
        lastScreenX = event.screenX
        lastScreenY = event.screenY
        if (dx || dy) window.petShell.moveBy(dx, dy)
      }
      if (leaning) return
      if (Math.abs(totalX) < 14 && Math.abs(totalY) < 14) return
      moved = true
      const direction = totalX >= 0 ? 1 : -1
      const strength = Math.min(0.9, 0.35 + Math.abs(totalX) / 320)
      leaning = true
      postPlan({
        title: '被拽住',
        intent: '被拉着往一边去，身体先偏过去',
        summary: '顺着拉的方向倾斜，幅度跟着距离走',
        actions: [{ kind: 'tilt', direction: direction > 0 ? 'right' : 'left', at: 0.1, duration: 0.55, strength }],
      }, { force: true })
    }, true)

    window.addEventListener('pointerup', (event) => {
      if (!downAt) return
      const held = Date.now() - downAt
      const wasDrag = moved || dragging || held > 900
      downAt = 0
      dragging = false
      document.body.classList.remove('pet-grabbing')
      try {
        if (captureTarget) captureTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* 已经放开过了 */
      }
      captureTarget = null
      if (wasDrag) {
        postPlan(SETTLE(event.screenX >= downScreenX ? 1 : -1), { force: true })
        if (Math.random() < 0.5) sayLocal('别拽，站不稳。', 4200)
        return
      }
      if (held > 700) {
        postPlan({
          title: '被按住',
          intent: '被按住不动，先抬眼看看你',
          summary: '抬眼加一次轻眨眼',
          actions: [
            { kind: 'look', direction: 'up', at: 0.12, duration: 1.0, strength: 0.55 },
            { kind: 'blink', at: 0.7, duration: 0.4, count: 1 },
          ],
        })
        sayLocal('手拿开再说。', 4200)
        return
      }
      poke(event.clientX)
    }, true)
  }

  const pokes = []
  function poke(x) {
    const now = Date.now()
    pokes.push(now)
    while (pokes.length && now - pokes[0] > 4500) pokes.shift()
    const side = x > window.innerWidth / 2 ? 'right' : 'left'
    const angry = pokes.length >= 4

    if (angry) {
      pokes.length = 0
      postPlan({
        title: '被戳烦了',
        intent: '被连戳了好几下，别过头去',
        summary: '摇头、偏头、嘴角不高兴',
        actions: [
          { kind: 'shake_head', at: 0.15, duration: 0.9, count: 2 },
          { kind: 'tilt', direction: side === 'right' ? 'left' : 'right', at: 0.9, duration: 1.0, strength: 0.55 },
          { kind: 'blink', at: 1.2, duration: 0.4, count: 1 },
        ],
      }, { force: true })
      sayLocal('戳够了没有。', 5000)
      return
    }

    postPlan({
      title: '被点了一下',
      intent: '你伸手点了点她，她先眨一下眼，再偏头看你',
      summary: '轻眨眼、偏头，克制不夸张',
      actions: [
        { kind: 'blink', at: 0.18, duration: 0.45, count: 1 },
        { kind: 'tilt', direction: side, at: 0.45, duration: 1.0, strength: 0.42 },
        { kind: 'smile', at: 0.8, duration: 1.0, strength: 0.16 },
      ],
    })
    if (pokes.length % 2 === 0) {
      const lines = ['别戳，会歪的。', '……嗯，在。', '敲头不算打招呼。', '再戳就记住了。']
      sayLocal(lines[Math.floor(Math.random() * lines.length)], 4800)
    }
  }

  // ---- 聊天框 ---------------------------------------------------------------
  let lastChatCount = 0
  let chatting = false
  // 只在面板里出现的提示行（没落盘），重画时挂在最后，别被轮询冲掉。
  const notes = []

  function renderChat(lines) {
    const log = document.getElementById('pet-log')
    if (!log) return
    log.textContent = ''
    for (const line of lines.slice(-40)) {
      const row = document.createElement('div')
      row.className = `pet-msg ${line.role === 'user' ? 'me' : 'her'}`
      row.textContent = line.text
      log.appendChild(row)
    }
    for (const text of notes) {
      const row = document.createElement('div')
      row.className = 'pet-msg note'
      row.textContent = text
      log.appendChild(row)
    }
    log.scrollTop = log.scrollHeight
    const last = lines[lines.length - 1]
    const grew = lines.length > lastChatCount
    if (last && last.role === 'assistant' && grew) {
      sayLocal(last.text, 9000)
      // 面板关着的时候，别让人以为她没吭声：按钮上挂一个红点。
      if (!chatting) markUnread()
    }
    lastChatCount = lines.length
  }

  function markUnread() {
    const btn = document.getElementById('pet-chat-btn')
    if (btn) btn.classList.add('unread')
  }

  function clearUnread() {
    const btn = document.getElementById('pet-chat-btn')
    if (btn) btn.classList.remove('unread')
  }

  function setChatting(next) {
    chatting = next
    document.body.classList.toggle('pet-chat-on', next)
    if (next) clearUnread()
    const input = document.getElementById('pet-input')
    if (next && input) setTimeout(() => input.focus(), 60)
  }

  async function sendChat() {
    const input = document.getElementById('pet-input')
    if (!input || !window.petShell) return
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    const sent = await window.petShell.chatSend(text)
    if (!sent) {
      // 写盘失败别装作发出去了：把字放回去，让人看得见。
      input.value = text
      noteLocal('没写进去，再试一次。')
      return
    }
    // 先把手里的这条画上去，别等下一轮轮询——不然看着像没发出去。
    localEcho({ role: 'user', text })
    await refreshChat()
    noteLocal('贴上了。我下次过来读，回话会落到这块面板。')
  }

  // 只画在面板里、不落盘的系统提示行。
  function localEcho(line) {
    const log = document.getElementById('pet-log')
    if (!log) return
    const row = document.createElement('div')
    row.className = `pet-msg ${line.role === 'user' ? 'me' : 'her'}`
    row.textContent = line.text
    log.appendChild(row)
    log.scrollTop = log.scrollHeight
  }

  let noteTimer = null
  function noteLocal(text) {
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => {
      notes.push(text)
      if (notes.length > 2) notes.shift()
      const log = document.getElementById('pet-log')
      if (!log) return
      const row = document.createElement('div')
      row.className = 'pet-msg note'
      row.textContent = text
      log.appendChild(row)
      log.scrollTop = log.scrollHeight
    }, 900)
  }

  async function refreshChat() {
    if (!window.petShell) return
    const [lines, stats] = await Promise.all([window.petShell.chatRead(), window.petShell.stats()])
    const incoming = Array.isArray(lines) ? lines : []
    const lastAssistant = [...incoming].reverse().find((line) => line && line.role === 'assistant')
    if (lastAssistant && lastAssistant.ts && lastAssistant.ts !== lastSeenAssistantTs) {
      lastSeenAssistantTs = lastAssistant.ts
      if (window.__petTouch) window.__petTouch()
    }
    renderChat(incoming)
    const statsEl = document.getElementById('pet-stats')
    if (statsEl) statsEl.textContent = stats && stats.line ? stats.line : '—'
  }
  let lastSeenAssistantTs = 0

  function wireChat() {
    const btn = document.getElementById('pet-chat-btn')
    if (!btn || btn.dataset.wired) return
    btn.dataset.wired = '1'
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      setChatting(!chatting)
      if (chatting) refreshChat()
    })
    document.getElementById('pet-send').addEventListener('click', (event) => {
      event.stopPropagation()
      sendChat()
    })
    const input = document.getElementById('pet-input')
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      // 中文输入法按回车是在选字，不是发送；两条都挡掉，别把人半句话发出去。
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Enter') {
        event.preventDefault()
        sendChat()
      }
      if (event.key === 'Escape') setChatting(false)
    })
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && chatting) setChatting(false)
    })
  }

  ensureShell()
  applyCollapsed(false)
  wireResize()
  wireHandle()
  wirePointer()
  wireChat()
  refreshChat()
  setInterval(refreshChat, 2000)
  return true
})()
