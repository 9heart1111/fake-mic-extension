// 运行在隔离世界：悬浮面板 + 音频库（chrome.storage.local），把设置和当前音频段发给主世界的 main-world.js。
;(() => {
  if (window.__fakeMicPanel) return
  window.__fakeMicPanel = true

  const TAG = '__fakeMic'
  const storage = chrome.storage.local
  const DEFAULT_SETTINGS = { enabled: true, autoPlay: true, autoAdvance: true, monitor: false, trigger: 'recorder' }
  const DEFAULT_UI = { collapsed: false, left: null, top: null }

  let settings = { ...DEFAULT_SETTINGS }
  let ui = { ...DEFAULT_UI }
  let clips = [] // [{ id, name, duration }]，音频数据单独存在 clip:<id>
  let selectedId = null
  let status = { recording: false, playing: false, position: 0, duration: 0, contextState: 'none' }
  let notice = ''
  let loaded = false
  let sentClipId // 已发给主世界的音频段 id；undefined 表示需要重发

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

  function syncMain() {
    toMain({ type: 'settings', settings })
    void sendClip()
  }

  async function updateSettings(patch) {
    settings = { ...settings, ...patch }
    toMain({ type: 'settings', settings })
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
    notice = ''
    render()
    void sendClip()
    await storage.set({ selectedId: id })
  }

  function step(delta) {
    if (!clips.length) return
    const index = clips.findIndex((c) => c.id === selectedId)
    const next = index + delta
    if (next < 0 || next >= clips.length) {
      notice = delta > 0 ? '已经是最后一段' : '已经是第一段'
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
        notice = `不是可用的音频：${file.name}`
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
    notice = ''
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
      notice = message.text
      renderStatus()
    } else if (message.type === 'recordingEnded') {
      if (settings.autoAdvance) step(1)
    }
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue }
      toMain({ type: 'settings', settings })
    }
    if (changes.ui) ui = { ...DEFAULT_UI, ...changes.ui.newValue }
    if (changes.clips) clips = changes.clips.newValue ?? []
    if (changes.selectedId) {
      selectedId = changes.selectedId.newValue ?? null
      void sendClip()
    }
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

  const CSS = `
    :host { all: initial; }
    .panel { position: fixed; z-index: 2147483647; width: 300px; box-sizing: border-box;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
      color: #1f2328; background: #ffffff; border: 1px solid #d0d7de; border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,.18); overflow: hidden; }
    .head { display: flex; align-items: center; gap: 6px; padding: 7px 10px; background: #f6f8fa;
      border-bottom: 1px solid #d0d7de; cursor: move; user-select: none; }
    .title { font-weight: 600; flex: 1; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #8c959f; }
    .dot.rec { background: #cf222e; box-shadow: 0 0 0 3px rgba(207,34,46,.2); }
    .dot.off { background: transparent; border: 1px solid #8c959f; }
    .body { padding: 8px 10px 10px; display: grid; gap: 8px; }
    .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 8px; }
    label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    select { font: inherit; padding: 1px 2px; }
    .list { max-height: 220px; overflow: auto; border: 1px solid #d0d7de; border-radius: 6px; }
    .empty { padding: 14px 8px; text-align: center; color: #656d76; }
    .row { display: flex; align-items: center; gap: 4px; padding: 4px 6px; cursor: pointer; border-top: 1px solid #eaeef2; }
    .row:first-child { border-top: none; }
    .row:hover { background: #f6f8fa; }
    .row.sel { background: #ddf4ff; font-weight: 600; }
    .num { width: 18px; color: #656d76; text-align: right; }
    .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dur { color: #656d76; font-variant-numeric: tabular-nums; }
    button { font: inherit; border: 1px solid #d0d7de; background: #f6f8fa; color: inherit; border-radius: 5px;
      padding: 2px 8px; cursor: pointer; }
    button:hover { background: #eaeef2; }
    button:disabled { opacity: .45; cursor: default; }
    .icon { padding: 0 4px; border-color: transparent; background: transparent; color: #656d76; }
    .actions { display: flex; gap: 6px; }
    .actions .grow { flex: 1; }
    .status { color: #424a53; font-variant-numeric: tabular-nums; min-height: 18px; }
    .notice { color: #9a6700; }
    .hint { color: #8c959f; font-size: 11px; }
    .drop { outline: 2px dashed #0969da; outline-offset: -4px; }
    @media (prefers-color-scheme: dark) {
      .panel { color: #e6edf3; background: #161b22; border-color: #30363d; }
      .head { background: #0d1117; border-color: #30363d; }
      .list { border-color: #30363d; }
      .row { border-color: #21262d; }
      .row:hover { background: #1f242c; }
      .row.sel { background: #12304d; }
      button { background: #21262d; border-color: #30363d; }
      button:hover { background: #30363d; }
      .icon { background: transparent; border-color: transparent; color: #8d96a0; }
      .status { color: #c9d1d9; }
      .notice { color: #d29922; }
      .num, .dur, .empty { color: #8d96a0; }
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

  function checkbox(key, text) {
    const input = h('input', { type: 'checkbox', onchange: (e) => updateSettings({ [key]: e.target.checked }) })
    input.checked = settings[key]
    return h('label', null, input, text)
  }

  function statusText() {
    if (!settings.enabled) return '已关闭：页面使用真实麦克风'
    const index = clips.findIndex((c) => c.id === selectedId)
    const parts = [status.recording ? '● 录音中' : '未录音']
    parts.push(index >= 0 ? `第 ${index + 1}/${clips.length} 段` : '未选择音频段')
    if (selectedId && status.clipId !== selectedId) parts.push('加载中…')
    if (status.playing) parts.push(`播放 ${status.position.toFixed(1)}/${status.duration.toFixed(1)}s`)
    if (status.contextState === 'suspended') parts.push('音频未激活，点一下面板')
    return parts.join(' · ')
  }

  function renderStatus() {
    if (!root) return
    const line = root.querySelector('.status')
    if (line) line.textContent = statusText()
    const noticeLine = root.querySelector('.notice')
    if (noticeLine) noticeLine.textContent = notice
    const playButton = root.querySelector('.play')
    if (playButton) playButton.textContent = status.playing ? '■ 停止' : '▶ 播放'
    const dot = root.querySelector('.dot')
    if (dot) dot.className = `dot${!settings.enabled ? ' off' : status.recording ? ' rec' : ''}`
  }

  function startDrag(event) {
    if (event.target.closest('button')) return
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
      { onchange: (e) => updateSettings({ trigger: e.target.value }) },
      h('option', { value: 'recorder' }, 'MediaRecorder.start 时'),
      h('option', { value: 'getUserMedia' }, 'getUserMedia 返回时'),
    )
    trigger.value = settings.trigger

    const list = clips.length
      ? clips.map((clip, i) =>
          h(
            'div',
            { class: `row${clip.id === selectedId ? ' sel' : ''}`, title: clip.name, onclick: () => select(clip.id) },
            h('span', { class: 'num' }, String(i + 1)),
            h('span', { class: 'name' }, clip.name),
            h('span', { class: 'dur' }, formatSeconds(clip.duration)),
            h('button', { class: 'icon', title: '上移', disabled: i === 0, onclick: (e) => (e.stopPropagation(), moveClip(clip.id, -1)) }, '↑'),
            h('button', { class: 'icon', title: '下移', disabled: i === clips.length - 1, onclick: (e) => (e.stopPropagation(), moveClip(clip.id, 1)) }, '↓'),
            h('button', { class: 'icon', title: '删除', onclick: (e) => (e.stopPropagation(), removeClip(clip.id)) }, '✕'),
          ),
        )
      : [h('div', { class: 'empty' }, '点“添加音频”或把音频文件拖到这里')]

    const panel = h(
      'div',
      {
        class: 'panel',
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
        h('span', { class: 'dot' }),
        h('span', { class: 'title' }, '模拟麦克风'),
        h('button', { class: 'icon', title: ui.collapsed ? '展开' : '折叠', onclick: () => updateUi({ collapsed: !ui.collapsed }) }, ui.collapsed ? '▢' : '—'),
      ),
      !ui.collapsed &&
        h(
          'div',
          { class: 'body' },
          h(
            'div',
            { class: 'opts' },
            checkbox('enabled', '启用模拟麦克风'),
            checkbox('monitor', '扬声器同时播放'),
            checkbox('autoPlay', '录音开始自动播放'),
            checkbox('autoAdvance', '录完切到下一段'),
          ),
          h('label', null, '开始播放：', trigger),
          h('div', { class: 'list' }, list),
          h(
            'div',
            { class: 'actions' },
            fileInput,
            h('button', { class: 'grow', onclick: () => fileInput.click() }, '+ 添加音频'),
            h('button', { class: 'play', disabled: !selectedId, onclick: togglePlay }, '▶ 播放'),
          ),
          h('div', { class: 'status' }),
          h('div', { class: 'notice' }),
          h('div', { class: 'hint' }, 'Option/Alt + ←/→ 切换段落，Option/Alt + P 播放/停止'),
        ),
    )
    if (ui.left != null && ui.top != null) Object.assign(panel.style, { left: `${ui.left}px`, top: `${ui.top}px` })
    else Object.assign(panel.style, { right: '16px', bottom: '16px' })
    root.replaceChildren(h('style', null, CSS), panel)
    renderStatus()
  }

  function mount() {
    host = document.createElement('fake-mic-panel')
    root = host.attachShadow({ mode: 'open' })
    document.documentElement.append(host)
    render()
  }

  if (isTop) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
    else mount()
  }

  storage.get(['settings', 'ui', 'clips', 'selectedId']).then((data) => {
    settings = { ...DEFAULT_SETTINGS, ...data.settings }
    ui = { ...DEFAULT_UI, ...data.ui }
    clips = data.clips ?? []
    selectedId = data.selectedId ?? null
    loaded = true
    syncMain()
    toMain({ type: 'hello' })
    render()
  })
})()
