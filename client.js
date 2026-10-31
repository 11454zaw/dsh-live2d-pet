/**
 * dsh-live2d-pet —— 浏览器半端
 * ============================================================================
 * 两处露面：
 *   ① 设置 → 「桌宠」：状态 + 所有参数 + 动作试玩（改完点「保存并套用」）
 *   ② 对话输入框左边一枚小圆点：离线灰、在线绿、点一下拉起来
 *
 * 约定（照 dsh-bili-scroll 抄的，2026-11 实测可用）：
 *   client bundle 不是 ESM，是自注册脚本 —— window.__ModuleLoader__.load({ id, factory })
 *   id 必须等于 package.json 的 name；factory 返回 { inject: ['slots'], apply(ctx) }。
 *   进设置页：slots.inject('settings.section', () => slots.register({...}, () => h(Panel)))
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-live2d-pet',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/live2d-pet'

    const MUTED = { opacity: 0.6, fontSize: 12, lineHeight: 1.7 }

    const Dot = ({ color }) =>
      h('span', {
        style: {
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          marginRight: 8,
          flex: '0 0 auto',
        },
      })

    const Row = ({ ok, label, children }) =>
      h('div', {
        style: {
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
          padding: '7px 0',
          borderBottom: '1px solid rgba(127,127,127,.14)',
          fontSize: 13,
          lineHeight: 1.5,
        },
      },
      h(Dot, { color: ok ? '#3ec78b' : '#8a8f98' }),
      h('span', { style: { opacity: 0.6, minWidth: 64 } }, label),
      h('span', { style: { flex: 1, wordBreak: 'break-all' } }, children))

    const Btn = ({ onClick, disabled, children, primary, small }) =>
      h('button', {
        onClick,
        disabled,
        type: 'button',
        style: {
          padding: small ? '3px 9px' : '6px 14px',
          borderRadius: 7,
          border: '1px solid ' + (primary ? 'transparent' : 'rgba(127,127,127,.35)'),
          background: primary ? '#2f6df6' : 'transparent',
          color: primary ? '#fff' : 'inherit',
          fontSize: small ? 12 : 13,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        },
      }, children)

    const Section = ({ title, note, children }) =>
      h('div', { style: { marginTop: 18 } },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, title),
        note ? h('div', { style: { ...MUTED, marginBottom: 8 } }, note) : null,
        h('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: 'minmax(96px, 140px) 1fr',
            gap: '8px 12px',
            alignItems: 'center',
            fontSize: 13,
          },
        }, children))

    const Field = ({ label, hint, children }) =>
      h(React.Fragment, null,
        h('div', { style: { opacity: 0.72 } }, label),
        h('div', null,
          children,
          hint ? h('div', { style: { ...MUTED, fontSize: 11, marginTop: 2 } }, hint) : null))

    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '5px 8px',
      borderRadius: 6,
      border: '1px solid rgba(127,127,127,.35)',
      background: 'transparent',
      color: 'inherit',
      fontSize: 13,
      fontFamily: 'inherit',
    }

    const Text = ({ value, onChange, placeholder }) =>
      h('input', {
        type: 'text',
        value: value == null ? '' : value,
        placeholder,
        onChange: (e) => onChange(e.target.value),
        style: inputStyle,
      })

    const Num = ({ value, onChange, min, max, step, suffix }) =>
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('input', {
          type: 'range',
          min,
          max,
          step: step || 1,
          value: value == null ? min : value,
          onChange: (e) => onChange(Number(e.target.value)),
          style: { flex: 1 },
        }),
        h('span', { style: { minWidth: 64, fontSize: 12, opacity: 0.75, textAlign: 'right' } },
          String(value) + (suffix || '')))

    const Check = ({ checked, onChange, label }) =>
      h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: Boolean(checked), onChange: (e) => onChange(e.target.checked) }),
        h('span', { style: { fontSize: 13 } }, label))

    async function jget(path) {
      const res = await fetch(API + path, { headers: { accept: 'application/json' } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) throw new Error(body.error || 'HTTP ' + res.status)
      return body
    }

    async function jpost(path, payload) {
      const res = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) throw new Error(body.error || 'HTTP ' + res.status)
      return body
    }

    function Panel() {
      const [state, setState] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [toast, setToast] = React.useState('')
      const [line, setLine] = React.useState('')
      const [touched, setTouched] = React.useState(false)

      const load = React.useCallback(async () => {
        try {
          const next = await jget('/status')
          setState(next)
          setError('')
          // 用户没动过表单时才跟着后端刷新，免得 5 秒一轮把正在改的值冲掉
          setForm((prev) => (prev && touched ? prev : { ...next.config }))
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        }
      }, [touched])

      React.useEffect(() => {
        load()
        const t = setInterval(load, 5000)
        return () => clearInterval(t)
      }, [load])

      const set = (patch) => {
        setTouched(true)
        setForm((prev) => ({ ...(prev || {}), ...patch }))
      }

      const act = React.useCallback(async (kind) => {
        setBusy(kind)
        try {
          const next = kind === 'start'
            ? await jpost('/start')
            : kind === 'restart'
              ? await jpost('/restart')
              : await jget('/status')
          setState(next)
          setError('')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setBusy('')
        }
      }, [])

      const save = async (apply) => {
        if (!form) return
        setBusy(apply ? 'apply' : 'save')
        try {
          const next = await jpost('/config', form)
          setState(next)
          setForm({ ...next.config })
          setTouched(false)
          setError('')
          if (apply) {
            const after = await jpost('/apply')
            setState(after)
            setToast('已保存并套用（外壳重启了一次）')
          } else {
            setToast('已保存；点「保存并套用」才会作用到正在跑的外壳')
          }
          setTimeout(() => setToast(''), 4000)
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setBusy('')
        }
      }

      const play = async (ops, label) => {
        setBusy('play')
        try {
          await jpost('/perform', ops)
          setError('')
          setToast(label || '做了一次')
          setTimeout(() => setToast(''), 2500)
        } catch (e) {
          const msg = String(e && e.message ? e.message : e)
          setError(msg.indexOf('404') >= 0 ? '这版后端还没有 /perform —— 重启一次 DSH 就有。' : msg)
        } finally {
          setBusy('')
        }
      }

      const say = async () => {
        const text = line.trim()
        if (!text) return
        setBusy('say')
        try {
          await jpost('/say', { text })
          setLine('')
          setError('')
          setToast('气泡已冒出')
          setTimeout(() => setToast(''), 2500)
        } catch (e) {
          const msg = String(e && e.message ? e.message : e)
          setError(msg.indexOf('404') >= 0 ? '这版后端还没有 /say —— 重启一次 DSH 就有。' : msg)
        } finally {
          setBusy('')
        }
      }

      const stage = (state && state.stage) || {}
      const pet = (state && state.pet) || {}
      const launcher = (state && state.launcher) || {}
      const catalog = (state && state.catalog) || {}
      const idleList = catalog.idleActions || []
      const allowed = form && Array.isArray(form.idleActions) ? form.idleActions : []
      const toggleIdle = (name) => {
        const next = allowed.includes(name) ? allowed.filter((x) => x !== name) : allowed.concat(name)
        set({ idleActions: next })
      }

      return h('div', { style: { maxWidth: 760, fontSize: 14, paddingBottom: 24 } },
        h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 4 } }, '桌面宠物'),
        h('div', { style: { ...MUTED, marginBottom: 14 } },
          '她站在桌面上。画面由鲸语（jingyu-live2d-agent）渲染，这个插件负责把她拉起来、调参数、让她说话和动。'),

        h(Row, { ok: Boolean(stage.online), label: '舞台' },
          stage.online
            ? [String(stage.url || ''), ' · 在线', stage.rendererReady ? ' · 画面已就绪' : ' · 没有窗口连着', stage.clients ? ' · ' + stage.clients + ' 个窗口' : ''].join('')
            : String(stage.url || '') + ' · 连不上（先起舞台，或用下面的「全部拉起」）'),
        h(Row, { ok: Boolean(pet.running), label: '宠物窗' }, pet.running ? '在跑' : '没在跑'),
        h(Row, { ok: Boolean(launcher.exists), label: '启动脚本' },
          launcher.exists ? launcher.path : (launcher.path ? launcher.path + '（文件不存在）' : '没配置 —— 「全部拉起」只起宠物窗，舞台得你自己先开')),

        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0' } },
          h(Btn, { onClick: () => act('start'), disabled: Boolean(busy), primary: true },
            busy === 'start' ? '正在拉…' : '全部拉起'),
          h(Btn, { onClick: () => act('restart'), disabled: Boolean(busy) }, '只重启宠物窗'),
          h(Btn, { onClick: () => act('refresh'), disabled: Boolean(busy) }, '刷新状态')),

        error ? h('div', { style: { color: '#e5484d', fontSize: 12, marginBottom: 8, whiteSpace: 'pre-wrap' } }, error) : null,
        toast ? h('div', { style: { color: '#2f8f5b', fontSize: 12, marginBottom: 8 } }, toast) : null,

        form ? h(React.Fragment, null,
          h(Section, { title: '外观', note: '宽度是窗口宽度；高度按 435:664 的比例自己算，窗口钉在右下角。' },
            h(Field, { label: '宽度', hint: '260–900，屏幕上装不下时会自动收' },
              h(Num, { value: form.width, onChange: (v) => set({ width: v }), min: 260, max: 900, step: 10, suffix: ' px' })),
            h(Field, { label: '不透明度', hint: '想让她更"贴"桌面就调低' },
              h(Num, { value: form.opacity, onChange: (v) => set({ opacity: v }), min: 0.25, max: 1, step: 0.05 })),
            h(Field, { label: '头像图片', hint: '左上角那个圆图标；填本机 png/jpg 绝对路径，留空用内置的那张' },
              h(Text, { value: form.avatar, onChange: (v) => set({ avatar: v }), placeholder: 'C:\\Users\\you\\Pictures\\avatar.jpg' }))),

          h(Section, { title: '行为', note: '' },
            h(Field, { label: '视线跟随' }, h(Check, { checked: form.follow, onChange: (v) => set({ follow: v }), label: '鼠标动的时候她会看过去' })),
            h(Field, { label: '待机小动作' }, h(Check, { checked: form.idleEnabled, onChange: (v) => set({ idleEnabled: v }), label: '没人理她的时候自己动' })),
            h(Field, { label: '待机最短间隔', hint: '太勤像抽搐，太懒像死机；默认 22 秒' },
              h(Num, { value: Math.round((form.idleMinMs || 22000) / 1000), onChange: (v) => set({ idleMinMs: v * 1000 }), min: 8, max: 300, step: 1, suffix: ' 秒' })),
            h(Field, { label: '随机范围', hint: '在最短间隔上再加 0–N 秒' },
              h(Num, { value: Math.round((form.idleSpreadMs || 0) / 1000), onChange: (v) => set({ idleSpreadMs: v * 1000 }), min: 0, max: 300, step: 5, suffix: ' 秒' })),
            h(Field, { label: '气泡停留' },
              h(Num, { value: Math.round((form.bubbleHoldMs || 9000) / 1000), onChange: (v) => set({ bubbleHoldMs: v * 1000 }), min: 1, max: 60, step: 1, suffix: ' 秒' })),
            h(Field, { label: '允许的待机动作', hint: '一个都不勾 = 全部允许（勾了就只用勾上的）' },
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px' } },
                idleList.map((name) => h(Check, {
                  key: name,
                  checked: allowed.includes(name),
                  onChange: () => toggleIdle(name),
                  label: name,
                }))))),

          h(Section, { title: '启动', note: '改完记得点下面的「保存并套用」。' },
            h(Field, { label: '舞台地址' }, h(Text, { value: form.stageUrl, onChange: (v) => set({ stageUrl: v }) })),
            h(Field, { label: 'Electron 路径', hint: '留空则找 $DSH_HOME/electron/electron.exe 和 PATH' },
              h(Text, { value: form.electron, onChange: (v) => set({ electron: v }), placeholder: 'C:\\Users\\you\\.dsh\\electron\\electron.exe' })),
            h(Field, { label: '启动脚本', hint: '点「全部拉起」时先跑它（.ps1 / .cmd），适合把舞台和回话器一起拉起来' },
              h(Text, { value: form.launchScript, onChange: (v) => set({ launchScript: v }), placeholder: 'D:\\path\\launch-detached.ps1' })),
            h(Field, { label: '开机自启' }, h(Check, { checked: form.autoStart, onChange: (v) => set({ autoStart: v }), label: 'DSH 启动时自动把宠物窗拉起来' }))),

          h('div', { style: { display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' } },
            h(Btn, { onClick: () => save(true), disabled: Boolean(busy), primary: true }, busy === 'apply' ? '正在套用…' : '保存并套用'),
            h(Btn, { onClick: () => save(false), disabled: Boolean(busy) }, busy === 'save' ? '正在保存…' : '只保存'),
            touched ? h('span', { style: { ...MUTED, alignSelf: 'center' } }, '有未套用的改动') : null),

          h(Section, { title: '动作', note: '点一下就在桌面上做一次。表情是长在模型上的（23 个），手势是三套开关式的。' },
            h(Field, { label: '表情' },
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                (catalog.expressions || []).map((name) => h(Btn, {
                  key: name,
                  small: true,
                  disabled: Boolean(busy),
                  onClick: () => play({ expression: name, title: '设置页试表情：' + name }, '表情：' + name),
                }, name)))),
            h(Field, { label: '手势' },
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                Object.keys(catalog.gestures || {}).map((key) => h(Btn, {
                  key,
                  small: true,
                  disabled: Boolean(busy),
                  onClick: () => play({ gesture: key, title: '设置页试手势：' + key }, '手势：' + (catalog.gestures[key] || key)),
                }, catalog.gestures[key] || key)))),
            h(Field, { label: '组合动作' },
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                h(Btn, { small: true, disabled: Boolean(busy), onClick: () => play({ look: 'up', smile: true }, '抬眼笑一下') }, '抬眼笑'),
                h(Btn, { small: true, disabled: Boolean(busy), onClick: () => play({ tilt: 'right', blink: true }, '偏头眨眼') }, '偏头眨眼'),
                h(Btn, { small: true, disabled: Boolean(busy), onClick: () => play({ nod: 2, smile: true }, '点两下头') }, '点头'),
                h(Btn, { small: true, disabled: Boolean(busy), onClick: () => play({ shake_head: 2 }, '摇两下头') }, '摇头'),
                h(Btn, { small: true, disabled: Boolean(busy), onClick: () => play({ talk: true, expression: '脸红' }, '说话+脸红') }, '说话+脸红'))),
            h(Field, { label: '说一句' },
              h('div', { style: { display: 'flex', gap: 8 } },
                h('input', {
                  type: 'text',
                  value: line,
                  placeholder: '让她冒个气泡…',
                  onChange: (e) => setLine(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') say() },
                  style: inputStyle,
                }),
                h(Btn, { onClick: say, disabled: Boolean(busy) || !line.trim() }, '发送')))),
        ) : h('div', { style: MUTED }, error ? '' : '读取配置中…'),

        state ? h('div', { style: { ...MUTED, fontSize: 11, marginTop: 22, whiteSpace: 'pre-wrap' } },
          '外壳目录：' + state.shell + '\n' +
          '气泡文件：' + state.sayFile + '\n' +
          (state.realtimeLog ? '回话器最近一条：' + state.realtimeLog : '回话器：没有日志（她不会自动接话）') + '\n' +
          '快捷键：Ctrl+Alt+H 收起/展开，L 点按穿透，T 置顶，+/- 改大小；右键她也有同样的菜单。') : null,
      )
    }

    /** 输入框左边的小圆点：一眼看见她在不在，点一下就能拉起来。 */
    function StatusChip() {
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const next = await jget('/status')
            if (alive) setState(next)
          } catch {
            if (alive) setState(null)
          }
        }
        load()
        const t = setInterval(load, 10000)
        return () => {
          alive = false
          clearInterval(t)
        }
      }, [])

      const online = Boolean(state && state.pet && state.pet.running)
      const stage = Boolean(state && state.stage && state.stage.online)
      const color = online ? '#3ec78b' : stage ? '#e0a33e' : '#8a8f98'
      const label = online ? '桌宠在线' : stage ? '桌宠没起来' : '舞台离线'
      const tip = online ? '她在桌面上（设置 → 桌宠 里能改）' : '点一下，把她拉起来'

      const click = async () => {
        if (busy) return
        setBusy(true)
        try {
          const next = await jpost('/start')
          setState(next)
        } catch {
          /* 失败就让圆点维持原样 */
        } finally {
          setBusy(false)
        }
      }

      return h('button', {
        onClick: click,
        title: tip,
        type: 'button',
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 26,
          padding: '0 10px',
          marginRight: 6,
          borderRadius: 13,
          border: '1px solid rgba(127,127,127,.28)',
          background: 'transparent',
          color: 'inherit',
          fontSize: 12,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
          whiteSpace: 'nowrap',
        },
      },
      h(Dot, { color }),
      h('span', null, busy ? '正在拉…' : label))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (!slots) return
        try {
          slots.inject('settings.section', () => slots.register({
            name: 'settings.section',
            id: 'live2d-pet',
            order: 32,
            label: '桌宠',
          }, () => h(Panel)))
        } catch {
          /* 宿主没这个槽位就算了 */
        }
        try {
          slots.inject('conversation.input.left', () => slots.register({
            name: 'conversation.input.left',
            id: 'live2d-pet-chip',
            order: 6,
          }, () => h(StatusChip)))
        } catch {
          /* 同上 */
        }
      },
    }
  },
})
