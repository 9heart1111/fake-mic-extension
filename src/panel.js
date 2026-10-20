// 运行在隔离世界：悬浮面板 + 音频库（chrome.storage.local），把设置和当前音频段发给主世界的 main-world.js。
// 文案全部走 i18n.js（中英文），语言可在面板里切换，默认跟随浏览器界面语言。
;(() => {
  if (window.__fakeMicPanel) return
  window.__fakeMicPanel = true

  const TAG = '__fakeMic'
  const i18n = window.__fakeMicI18n
  const storage = chrome.storage.local
  const DEFAULT_SETTINGS = { enabled: true, autoPlay: true, autoAdvance: true, monitor: false, trigger: 'recorder' }
  const DEFAULT_UI = { collapsed: false, left: null, top: null, lang: 'auto' }

  let settings = { ...DEFAULT_SETTINGS }
  let ui = { ...DEFAULT_UI }
  let clips = [] // [{ id, name, duration }]，音频数据单独存在 clip:<id>
  let selectedId = null
  let status = { recording: false, playing: false, position: 0, duration: 0, contextState: 'none' }
  let notice = null // { key, params }；存 key 而不是文案，切换语言后当前提示也会跟着变
  let loaded = false
  let sentClipId // 已发给主世界的音频段 id；undefined 表示需要重发
  let sites = [] // 弹窗里手动启用的站点 origin 列表；localhost / 127.0.0.1 始终启用
  let siteAllowed = false

  let lang = 'en'
  let t = (key) => key

  /** 按 ui.lang 重新解析语言（'auto' 跟随浏览器），render 和状态渲染都用最新的 t。 */
  function applyLang() {
    const translator = i18n.translator(ui.lang)
    lang = translator.lang
    t = translator.t
    if (host) host.dataset.lang = lang
  }

  // ---------- 站点判断 ----------
  // 插件注入所有 http/https 站点，但只有本帧或它的祖先站点被允许时才生效；
  // 其余站点必须原样放行真实麦克风（main-world.js 的 active）。
  const LOCAL_HOSTS = ['localhost', '127.0.0.1']

  function hostnameOf(origin) {
    try {
      return new URL(origin).hostname
    } catch {
      return ''
    }
  }

  /** 本帧 + 所有祖先页面的 origin：允许顶层站点对内嵌的第三方录音 iframe 也生效。 */
  function candidateOrigins() {
    const origins = [location.origin]
    try {
      origins.push(...Array.from(location.ancestorOrigins ?? []))
    } catch {}
    return origins.filter(Boolean)
  }

  function computeSiteAllowed() {
    return candidateOrigins().some((origin) => LOCAL_HOSTS.includes(hostnameOf(origin)) || sites.includes(origin))
  }

  const toMain = (message, transfer) => window.postMessage({ [TAG]: 'toMain', ...message }, '*', transfer ?? [])

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer)
    let text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(text)
  }

  function base64ToBuffer(base64) {
    const text = atob(base64)
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
    return bytes.buffer
  }

  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)

  async function sendClip() {
    // 未启用的站点不下发音频数据：页面能监听 window 上的 postMessage，别把你的录音文件交给它。
    if (!siteAllowed) return
    if (sentClipId === selectedId) return
    const id = selectedId
    sentClipId = id
    if (!id) return toMain({ type: 'clip', id: null })
    const key = `clip:${id}`
    const base64 = (await storage.get(key))[key]
    if (sentClipId !== id || !base64) return
    const data = base64ToBuffer(base64)
    toMain({ type: 'clip', id, name: clips.find((c) => c.id === id)?.name ?? '', data }, [data])
  }

  function sendSettings() {
    toMain({ type: 'settings', settings, active: siteAllowed && settings.enabled })
  }

  function syncMain() {
    sendSettings()
    if (siteAllowed) return void sendClip()
    sentClipId = undefined
    toMain({ type: 'clip', id: null }) // 站点被关掉时让主世界丢掉已加载的音频段
  }

  async function updateSettings(patch) {
    settings = { ...settings, ...patch }
    sendSettings()
    render()
    await storage.set({ settings })
  }

  async function updateUi(patch) {
    ui = { ...ui, ...patch }
    render()
    await storage.set({ ui })
  }

  async function select(id) {
    selectedId = id
    notice = null
    render()
    void sendClip()
    await storage.set({ selectedId: id })
  }

  function step(delta) {
    if (!clips.length) return
    const index = clips.findIndex((c) => c.id === selectedId)
    const next = index + delta
    if (next < 0 || next >= clips.length) {
      notice = { key: delta > 0 ? 'noticeLast' : 'noticeFirst' }
      render()
      return
    }
    void select(clips[next].id)
  }

  async function addFiles(files) {
    for (const file of files) {
      const buffer = await file.arrayBuffer()
      let duration
      try {
        duration = (await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buffer.slice(0))).duration
      } catch {
        notice = { key: 'noticeBadAudio', params: { name: file.name } }
        continue
      }
      const id = newId()
      await storage.set({ [`clip:${id}`]: bufferToBase64(buffer) })
      clips = [...clips, { id, name: file.name, duration }]
      await storage.set({ clips })
      if (!selectedId) await select(id)
    }
    render()
  }

  async function removeClip(id) {
    const index = clips.findIndex((c) => c.id === id)
    clips = clips.filter((c) => c.id !== id)
    await storage.set({ clips })
    await storage.remove(`clip:${id}`)
    if (selectedId === id) await select(clips[Math.min(index, clips.length - 1)]?.id ?? null)
    else render()
  }

  async function moveClip(id, delta) {
    const index = clips.findIndex((c) => c.id === id)
    const target = index + delta
    if (target < 0 || target >= clips.length) return
    const next = [...clips]
    ;[next[index], next[target]] = [next[target], next[index]]
    clips = next
    render()
    await storage.set({ clips })
  }

  function togglePlay() {
    notice = null
    toMain({ type: status.playing ? 'stop' : 'play' })
  }

  window.addEventListener('message', (event) => {
    const message = event.data
    if (event.source !== window || message?.[TAG] !== 'toPanel') return
    if (message.type === 'ready') {
      sentClipId = undefined
      if (loaded) syncMain()
    } else if (message.type === 'status') {
      status = message
      renderStatus()
    } else if (message.type === 'warning') {
      // 主世界只发 code（它不关心界面语言），这里只记下 key，渲染时按当前语言取文案。
      notice = { key: `warning.${message.code}`, params: message }
      renderStatus()
    } else if (message.type === 'recordingEnded') {
      if (settings.autoAdvance) step(1)
    }
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue }
    }
    if (changes.ui) ui = { ...DEFAULT_UI, ...changes.ui.newValue }
    if (changes.clips) clips = changes.clips.newValue ?? []
    if (changes.selectedId) {
      selectedId = changes.selectedId.newValue ?? null
      void sendClip()
    }
    // 在弹窗里开关某个站点后，已打开的页面要立刻生效（不用刷新）。
    if (changes.sites) {
      sites = changes.sites.newValue ?? []
      siteAllowed = computeSiteAllowed()
      sentClipId = undefined
      syncMount()
      syncMain() // 同步 active，并按需下发或丢弃音频段
    }
    if (changes.settings) sendSettings()
    render()
  })

  // Option(Alt)+←/→ 切换上一段/下一段，Option(Alt)+P 播放/停止。用 code 判断，避免 macOS 下 Option 改变字符。
  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const action = { ArrowRight: () => step(1), ArrowLeft: () => step(-1), KeyP: togglePlay }[event.code]
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      action()
    },
    true,
  )

  // ---------- 界面（只在顶层页面显示） ----------
  const isTop = window === window.top
  let root = null
  let host = null

  // ---- 视觉素材：麦克风图标（遮罩）和 select 的下拉箭头，都用内联 SVG，避免依赖图片文件 ----
  const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  const MIC_MASK = svgUrl(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="black">' +
      '<rect x="9" y="2.5" width="6" height="11" rx="3"/>' +
      '<path d="M5.5 11a6.5 6.5 0 0 0 13 0" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M12 17.5V21" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>',
  )

  const chevron = (color) =>
    svgUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">' +
        `<path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
        '</svg>',
    )

  const chevronGlyph = (d) =>
    svgUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">' +
        `<path d="${d}" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
        '</svg>',
    )
  const CHEVRON_UP = chevronGlyph('M2.5 7.5 6 4l3.5 3.5')
  const CHEVRON_DOWN = chevronGlyph('M2.5 4.5 6 8l3.5-3.5')

  const CSS = `
    :host { all: initial; }
    .panel {
      --bg: #ffffff; --surface: #f6f8fa; --surface-hover: #eaeef2; --border: #d8dee4; --border-soft: #eaeef2;
      --text: #1f2328; --muted: #656d76; --accent: #1f6feb; --accent-soft: #e7f0ff; --track: #d0d7de;
      --warn-bg: #fff8e1; --warn-text: #7d4e00; --chevron: ${chevron('#656d76')}; --mic: ${MIC_MASK};
      --chev-up: ${CHEVRON_UP}; --chev-down: ${CHEVRON_DOWN};
      position: fixed; z-index: 2147483647; width: 336px;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif;
      color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(31,35,40,.14), 0 1px 3px rgba(31,35,40,.08);
      overflow: hidden; -webkit-font-smoothing: antialiased;
    }
    .panel *, .panel { box-sizing: border-box; }
    .panel.collapsed { width: auto; }

    .head { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px;
      background: var(--surface); border-bottom: 1px solid var(--border-soft); cursor: move; user-select: none; }
    .panel.collapsed .head { border-bottom: none; }
    .logo { width: 15px; height: 15px; flex: none; background: var(--accent); -webkit-mask: var(--mic) center/contain no-repeat;
      mask: var(--mic) center/contain no-repeat; }
    .title { flex: 1; font-weight: 600; font-size: 12.5px; letter-spacing: .01em; }
    .dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #8c959f; transition: background .15s, box-shadow .15s; }
    .dot.rec { background: #cf222e; box-shadow: 0 0 0 3px rgba(207,34,46,.16); animation: pulse 1.4s ease-in-out infinite; }
    .dot.off { background: transparent; box-shadow: inset 0 0 0 1px var(--muted); }
    @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .4 } }

    .body { display: grid; gap: 10px; padding: 10px 12px 12px; }
    .group { display: grid; gap: 1px; }

    .opt { display: flex; align-items: center; gap: 10px; padding: 4px 0; cursor: pointer; user-select: none; }
    .opt-label { flex: 1; min-width: 0; }

    input[type=checkbox] { appearance: none; -webkit-appearance: none; position: relative; flex: none; margin: 0;
      width: 30px; height: 18px; border-radius: 999px; background: var(--track); cursor: pointer;
      transition: background .16s ease; }
    input[type=checkbox]::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
      border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(31,35,40,.3); transition: transform .16s ease; }
    input[type=checkbox]:checked { background: var(--accent); }
    input[type=checkbox]:checked::after { transform: translateX(12px); }
    input[type=checkbox]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    input[type=checkbox]:disabled { opacity: .5; cursor: default; }

    /* 两行下拉共用一个网格：标签列取两行里最宽的那个，下拉框左右对齐 */
    .fields { display: grid; grid-template-columns: max-content 1fr; column-gap: 10px; row-gap: 6px; align-items: center; }
    .fields .field { display: contents; }
    .field-label { color: var(--muted); white-space: nowrap; }
    select { appearance: none; -webkit-appearance: none; flex: 1; min-width: 0; font: inherit; color: var(--text);
      background-color: var(--surface); background-image: var(--chevron); background-repeat: no-repeat;
      background-position: right 7px center; background-size: 10px; border: 1px solid var(--border); border-radius: 7px;
      padding: 4px 24px 4px 8px; cursor: pointer; text-overflow: ellipsis; transition: border-color .12s, background-color .12s; }
    select:hover { border-color: var(--muted); }
    select:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }

    .list { max-height: 186px; overflow: auto; overscroll-behavior: contain;
      border: 1px solid var(--border); border-radius: 9px; background: var(--bg); }
    .list::-webkit-scrollbar { width: 8px; }
    .list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
    .list::-webkit-scrollbar-track { background: transparent; }
    .empty { padding: 18px 10px; text-align: center; color: var(--muted); }
    .row { position: relative; display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px 10px;
      border-top: 1px solid var(--border-soft); cursor: pointer; }
    .row:first-child { border-top: none; }
    .row:hover { background: var(--surface); }
    .row.sel { background: var(--accent-soft); }
    .row.sel::before { content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 2px;
      border-radius: 2px; background: var(--accent); }
    .num { flex: none; width: 16px; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row.sel .name { font-weight: 600; }
    .dur { flex: none; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }

    button { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border);
      border-radius: 7px; padding: 5px 10px; cursor: pointer; transition: background .12s, border-color .12s, filter .12s; }
    button:hover { background: var(--surface-hover); }
    button:disabled { opacity: .5; cursor: default; }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    button.primary:hover { filter: brightness(1.07); }
    button.icon { flex: none; display: flex; align-items: center; justify-content: center;
      background: transparent; border-color: transparent; color: var(--muted);
      padding: 3px; line-height: 1; border-radius: 6px; }
    button.icon:hover { background: var(--surface-hover); color: var(--text); }
    .chev { width: 12px; height: 12px; background: currentColor; -webkit-mask: var(--chev) center/contain no-repeat;
      mask: var(--chev) center/contain no-repeat; }
    .chev.up { --chev: var(--chev-up); }
    .chev.down { --chev: var(--chev-down); }
    .row button.icon { opacity: .5; transition: opacity .12s, background .12s, color .12s; }
    .row:hover button.icon, .row.sel button.icon { opacity: 1; }
    .row button.icon:disabled { opacity: .15; }

    .actions { display: flex; gap: 8px; }
    .actions .grow { flex: 1; }
    .status { color: var(--muted); min-height: 16px; font-variant-numeric: tabular-nums; }
    .status[data-loading="1"] { opacity: .75; }
    .notice { color: var(--warn-text); background: var(--warn-bg); border-radius: 6px; padding: 5px 8px; }
    .notice:empty { display: none; }
    .hint { color: var(--muted); font-size: 11px; line-height: 1.5; }

    .panel.drop { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft), 0 12px 32px rgba(31,35,40,.14); }

    @media (prefers-color-scheme: dark) {
      .panel { --bg: #161b22; --surface: #1c2128; --surface-hover: #262c36; --border: #30363d; --border-soft: #21262d;
        --text: #e6edf3; --muted: #8d96a0; --accent: #388bfd; --accent-soft: #12304d; --track: #3d444d;
        --warn-bg: #2b2111; --warn-text: #d29922; --chevron: ${chevron('#8d96a0')};
        box-shadow: 0 12px 32px rgba(1,4,9,.55), 0 1px 3px rgba(1,4,9,.4); }
    }
    @media (prefers-reduced-motion: reduce) {
      .dot.rec { animation: none; }
      * { transition: none !important; }
    }
  `

  function h(tag, props, ...children) {
    const el = document.createElement(tag)
    for (const [key, value] of Object.entries(props ?? {})) {
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
      else if (key === 'class') el.className = value
      else if (value !== undefined && value !== null && value !== false) el.setAttribute(key, value === true ? '' : value)
    }
    for (const child of children.flat()) if (child != null && child !== false) el.append(child)
    return el
  }

  const formatSeconds = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  // data-key 让测试不依赖界面语言；label 的文本只有选项文字，开关是原生 checkbox 画的。
  function checkbox(key, text) {
    const input = h('input', { type: 'checkbox', 'data-key': key, onchange: (e) => updateSettings({ [key]: e.target.checked }) })
    input.checked = settings[key]
    return h('label', { class: 'opt' }, h('span', { class: 'opt-label' }, text), input)
  }

  // 选中的音频段还没送到主世界（主世界已在播另一段）时算“加载中”。
  const isLoading = () => Boolean(selectedId) && status.clipId !== selectedId

  function statusText() {
    if (!settings.enabled) return t('statusOff')
    const index = clips.findIndex((c) => c.id === selectedId)
    const parts = [t(status.recording ? 'statusRecording' : 'statusIdle')]
    parts.push(index >= 0 ? t('statusClip', { index: index + 1, total: clips.length }) : t('statusNoClip'))
    if (isLoading()) parts.push(t('statusLoading'))
    if (status.playing) parts.push(t('statusPlaying', { position: status.position.toFixed(1), duration: status.duration.toFixed(1) }))
    if (status.contextState === 'suspended') parts.push(t('statusSuspended'))
    return parts.join(' · ')
  }

  function renderStatus() {
    if (!root) return
    const line = root.querySelector('.status')
    if (line) {
      line.textContent = statusText()
      if (isLoading()) line.setAttribute('data-loading', '1')
      else line.removeAttribute('data-loading')
    }
    const noticeLine = root.querySelector('.notice')
    if (noticeLine) noticeLine.textContent = notice ? t(notice.key, notice.params) : ''
    const playButton = root.querySelector('.play')
    if (playButton) playButton.textContent = t(status.playing ? 'stop' : 'play')
    const dot = root.querySelector('.dot')
    if (dot) dot.className = `dot${!settings.enabled ? ' off' : status.recording ? ' rec' : ''}`
  }

  function startDrag(event) {
    if (event.target.closest('button, select, input, label')) return
    const panel = root.querySelector('.panel')
    const rect = panel.getBoundingClientRect()
    const dx = event.clientX - rect.left
    const dy = event.clientY - rect.top
    const move = (e) => {
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - rect.width, e.clientX - dx))}px`
      panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 30, e.clientY - dy))}px`
      panel.style.right = panel.style.bottom = 'auto'
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      void updateUi({ left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function render() {
    if (!root) return
    applyLang()

    const fileInput = h('input', {
      type: 'file',
      accept: 'audio/*,.wav,.mp3,.m4a,.ogg,.webm',
      multiple: true,
      hidden: true,
      onchange: (e) => {
        void addFiles([...e.target.files])
        e.target.value = ''
      },
    })
    const trigger = h(
      'select',
      { 'data-key': 'trigger', onchange: (e) => updateSettings({ trigger: e.target.value }) },
      h('option', { value: 'recorder' }, t('triggerRecorder')),
      h('option', { value: 'getUserMedia' }, t('triggerGetUserMedia')),
    )
    trigger.value = settings.trigger
    const langSelect = h(
      'select',
      { 'data-key': 'lang', onchange: (e) => updateUi({ lang: e.target.value }) },
      h('option', { value: 'auto' }, t('langAuto')),
      h('option', { value: 'zh' }, t('langZh')),
      h('option', { value: 'en' }, t('langEn')),
    )
    langSelect.value = ui.lang

    const list = clips.length
      ? clips.map((clip, i) =>
          h(
            'div',
            { class: `row${clip.id === selectedId ? ' sel' : ''}`, title: clip.name, onclick: () => select(clip.id) },
            h('span', { class: 'num' }, String(i + 1)),
            h('span', { class: 'name' }, clip.name),
            h('span', { class: 'dur' }, formatSeconds(clip.duration)),
            h(
              'button',
              { class: 'icon', title: t('moveUp'), disabled: i === 0, onclick: (e) => (e.stopPropagation(), moveClip(clip.id, -1)) },
              '↑',
            ),
            h(
              'button',
              {
                class: 'icon',
                title: t('moveDown'),
                disabled: i === clips.length - 1,
                onclick: (e) => (e.stopPropagation(), moveClip(clip.id, 1)),
              },
              '↓',
            ),
            h('button', { class: 'icon', title: t('remove'), onclick: (e) => (e.stopPropagation(), removeClip(clip.id)) }, '✕'),
          ),
        )
      : [h('div', { class: 'empty' }, t('listEmpty'))]

    const field = (labelKey, control) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, t(labelKey)), control)

    const panel = h(
      'div',
      {
        class: `panel${ui.collapsed ? ' collapsed' : ''}`,
        lang,
        onpointerdown: () => toMain({ type: 'resume' }),
        ondragover: (e) => {
          e.preventDefault()
          panel.classList.add('drop')
        },
        ondragleave: () => panel.classList.remove('drop'),
        ondrop: (e) => {
          e.preventDefault()
          panel.classList.remove('drop')
          void addFiles([...e.dataTransfer.files])
        },
      },
      h(
        'div',
        { class: 'head', onpointerdown: startDrag },
        h('span', { class: 'logo', 'aria-hidden': 'true' }),
        h('span', { class: 'title' }, t('appName')),
        h('span', { class: 'dot' }),
        h(
          'button',
          { class: 'icon', title: ui.collapsed ? t('expand') : t('collapse'), onclick: () => updateUi({ collapsed: !ui.collapsed }) },
          h('span', { class: `chev ${ui.collapsed ? 'down' : 'up'}` }),
        ),
      ),
      !ui.collapsed &&
        h(
          'div',
          { class: 'body' },
          h(
            'div',
            { class: 'group' },
            checkbox('enabled', t('optionEnabled')),
            checkbox('monitor', t('optionMonitor')),
            checkbox('autoPlay', t('optionAutoPlay')),
            checkbox('autoAdvance', t('optionAutoAdvance')),
          ),
          h('div', { class: 'group fields' }, field('triggerLabel', trigger), field('langLabel', langSelect)),
          h('div', { class: 'list' }, list),
          h(
            'div',
            { class: 'actions' },
            fileInput,
            h('button', { class: 'grow', onclick: () => fileInput.click() }, t('addAudio')),
            h(
              'button',
              { class: 'play primary', disabled: !selectedId, onclick: togglePlay },
              t(status.playing ? 'stop' : 'play'),
            ),
          ),
          h('div', { class: 'status' }),
          h('div', { class: 'notice' }),
          h('div', { class: 'hint' }, t('hint')),
        ),
    )
    if (ui.left != null && ui.top != null) Object.assign(panel.style, { left: `${ui.left}px`, top: `${ui.top}px` })
    else Object.assign(panel.style, { right: '16px', bottom: '16px' })
    root.replaceChildren(h('style', null, CSS), panel)
    renderStatus()
  }

  // 面板只在顶层页面、且当前站点被允许时挂载；其余站点保持“隐身”，不干扰页面。
  function mount() {
    if (host) return
    host = document.createElement('fake-mic-panel')
    root = host.attachShadow({ mode: 'open' })
    document.documentElement.append(host)
    render()
  }

  function unmount() {
    host?.remove()
    host = null
    root = null
  }

  function syncMount() {
    if (!isTop) return
    if (!siteAllowed) return unmount()
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
    else mount()
  }

  storage.get(['settings', 'ui', 'clips', 'selectedId', 'sites']).then((data) => {
    settings = { ...DEFAULT_SETTINGS, ...data.settings }
    ui = { ...DEFAULT_UI, ...data.ui }
    clips = data.clips ?? []
    selectedId = data.selectedId ?? null
    sites = data.sites ?? []
    siteAllowed = computeSiteAllowed()
    loaded = true
    syncMain()
    toMain({ type: 'hello' })
    syncMount()
    render()
  })
})()
