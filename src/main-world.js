// 运行在页面主世界：替换 getUserMedia 的音频输入，并在录音开始时播放当前选中的音频段。
// 与面板（隔离世界的 panel.js）通过 window.postMessage 通信，消息带 __fakeMic 标记。
;(() => {
  if (window.__fakeMicInstalled) return
  window.__fakeMicInstalled = true

  const TAG = '__fakeMic'
  const mediaDevices = navigator.mediaDevices
  // 非安全上下文（如 http + 局域网 IP）下 mediaDevices 不存在，页面本身也无法录音。
  if (!mediaDevices?.getUserMedia) return

  const realGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices)
  const settings = { enabled: true, autoPlay: true, monitor: false, trigger: 'recorder' }
  const fakeTracks = new WeakSet()
  let clip = null // { id, name, buffer }
  let loadingClipId = null
  let pendingPlay = false
  let ctx = null
  let bus = null
  let source = null
  let playStartedAt = 0
  let progressTimer = null
  let recording = 0

  // 只有面板确认“当前站点生效”时才替换麦克风；插件现在注入所有 http/https 站点，
  // 未启用的站点必须原样放行真实麦克风（见 panel.js 的站点判断）。
  let active = false
  let releaseGate
  const gate = new Promise((resolve) => (releaseGate = resolve))
  // 面板正常会在几毫秒内发来第一条设置；万一面板没跑起来，超时后按“未启用”处理。
  setTimeout(() => releaseGate(), 1000)

  const post = (message) => window.postMessage({ [TAG]: 'toPanel', ...message }, '*')

  function ensureContext() {
    if (!ctx) {
      ctx = new AudioContext()
      ctx.onstatechange = postStatus
      bus = ctx.createGain()
      if (settings.monitor) bus.connect(ctx.destination)
    }
    // 用户点击触发的调用里 resume 才会生效；不等待结果，避免在没有用户激活时挂起。
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  }

  function postStatus() {
    post({
      type: 'status',
      recording: recording > 0,
      playing: !!source,
      position: source ? Math.min(ctx.currentTime - playStartedAt, clip.buffer.duration) : 0,
      duration: clip?.buffer.duration ?? 0,
      clipId: clip?.id ?? null,
      contextState: ctx?.state ?? 'none',
    })
  }

  function stopPlayback() {
    pendingPlay = false
    if (!source) return
    const node = source
    source = null
    node.onended = null
    try {
      node.stop()
    } catch {}
    node.disconnect()
    clearInterval(progressTimer)
    postStatus()
  }

  function play() {
    ensureContext()
    stopPlayback()
    if (!clip) {
      // 音频还在加载时先记下，加载完立即播放。
      pendingPlay = loadingClipId !== null
      // 只发 code，文案由面板按当前界面语言渲染（见 i18n.js 的 warning.*）。
      if (!pendingPlay) post({ type: 'warning', code: 'noClip' })
      return
    }
    const node = ctx.createBufferSource()
    node.buffer = clip.buffer
    node.connect(bus)
    node.onended = () => {
      if (source !== node) return
      source = null
      node.disconnect()
      clearInterval(progressTimer)
      postStatus()
    }
    source = node
    playStartedAt = ctx.currentTime
    node.start()
    progressTimer = setInterval(postStatus, 250)
    postStatus()
  }

  // 每次调用返回独立的音轨：页面停止一条音轨不影响其他调用方。
  // 音频段播完后音轨继续输出静音，不会触发 ended，相当于真人说完话停下。
  function createFakeTrack() {
    ensureContext()
    const destination = ctx.createMediaStreamDestination()
    bus.connect(destination)
    const track = destination.stream.getAudioTracks()[0]
    fakeTracks.add(track)
    const realStop = track.stop.bind(track)
    let stopped = false
    track.stop = () => {
      realStop()
      if (stopped) return
      stopped = true
      bus.disconnect(destination)
      if (settings.trigger === 'getUserMedia') sessionEnded()
    }
    return track
  }

  function sessionStarted() {
    recording += 1
    if (settings.autoPlay) play()
    postStatus()
  }

  function sessionEnded() {
    recording = Math.max(0, recording - 1)
    stopPlayback()
    postStatus()
    post({ type: 'recordingEnded' })
  }

  mediaDevices.getUserMedia = async function getUserMedia(constraints) {
    // 等面板的第一次上报再决定替不替换，避免页面在 document_start 之后立刻取麦克风时误判。
    await gate
    if (!active || !constraints?.audio) return realGetUserMedia(constraints)
    const track = createFakeTrack()
    let videoTracks = []
    if (constraints.video) {
      try {
        videoTracks = (await realGetUserMedia({ video: constraints.video })).getVideoTracks()
      } catch (error) {
        track.stop()
        throw error
      }
    }
    if (settings.trigger === 'getUserMedia') sessionStarted()
    return new MediaStream([track, ...videoTracks])
  }

  if (typeof MediaRecorder !== 'undefined') {
    const realStart = MediaRecorder.prototype.start
    MediaRecorder.prototype.start = function start(...args) {
      const result = realStart.apply(this, args)
      if (settings.trigger === 'recorder' && this.stream?.getAudioTracks().some((t) => fakeTracks.has(t))) {
        this.addEventListener('stop', sessionEnded, { once: true })
        sessionStarted()
      }
      return result
    }
  }

  async function loadClip(message) {
    if (!message.id) {
      loadingClipId = null
      stopPlayback()
      clip = null
      postStatus()
      return
    }
    if (clip?.id === message.id || loadingClipId === message.id) return
    loadingClipId = message.id
    try {
      const buffer = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(message.data)
      if (loadingClipId !== message.id) return
      loadingClipId = null
      const wasPlaying = !!source
      stopPlayback()
      clip = { id: message.id, name: message.name, buffer }
      postStatus()
      if (pendingPlay || wasPlaying) play()
    } catch {
      if (loadingClipId === message.id) loadingClipId = null
      post({ type: 'warning', code: 'decodeFailed', name: message.name })
    }
  }

  function applySettings(next, siteActive) {
    const monitorChanged = next.monitor !== settings.monitor
    Object.assign(settings, next)
    if (monitorChanged && bus) {
      if (settings.monitor) bus.connect(ctx.destination)
      else bus.disconnect(ctx.destination)
    }
    if (typeof siteActive === 'boolean') {
      if (!siteActive && active) stopPlayback() // 在面板/弹窗里关掉当前站点时立刻停止播放
      active = siteActive
      releaseGate()
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data
    if (event.source !== window || message?.[TAG] !== 'toMain') return
    if (message.type === 'settings') applySettings(message.settings, message.active)
    else if (message.type === 'clip') void loadClip(message)
    else if (message.type === 'play') play()
    else if (message.type === 'stop') stopPlayback()
    else if (message.type === 'resume') ctx && ensureContext()
    else if (message.type === 'hello') postStatus()
  })

  post({ type: 'ready' })
})()
