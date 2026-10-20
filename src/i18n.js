// 面板文案：中英文两套，按 key 取用。运行在隔离世界，供 panel.js 读取（manifest 里排在 panel.js 前面）。
// 插件在 Chrome 里显示的名称和简介不走这里，而是 _locales/<locale>/messages.json（由浏览器语言决定）。
// 新增语言：在 MESSAGES 里加一份同样 key 的表，并在 _locales/ 下加一个同名目录即可。
;(() => {
  if (window.__fakeMicI18n) return

  const MESSAGES = {
    zh: {
      appName: '模拟麦克风',
      collapse: '折叠',
      expand: '展开',
      optionEnabled: '启用模拟麦克风',
      optionMonitor: '扬声器同时播放',
      optionAutoPlay: '录音开始自动播放',
      optionAutoAdvance: '录完切到下一段',
      triggerLabel: '开始播放：',
      triggerRecorder: 'MediaRecorder.start 时',
      triggerGetUserMedia: 'getUserMedia 返回时',
      langLabel: '语言：',
      langAuto: '跟随浏览器',
      langZh: '中文',
      langEn: 'English',
      listEmpty: '点“添加音频”或把音频文件拖到这里',
      addAudio: '+ 添加音频',
      play: '▶ 播放',
      stop: '■ 停止',
      moveUp: '上移',
      moveDown: '下移',
      remove: '删除',
      statusOff: '已关闭：页面使用真实麦克风',
      statusRecording: '录音中',
      statusIdle: '未录音',
      statusClip: '第 {index}/{total} 段',
      statusNoClip: '未选择音频段',
      statusLoading: '加载中…',
      statusPlaying: '播放 {position}/{duration}s',
      statusSuspended: '音频未激活，点一下面板',
      noticeLast: '已经是最后一段',
      noticeFirst: '已经是第一段',
      noticeBadAudio: '不是可用的音频：{name}',
      'warning.noClip': '没有选中的音频段，录到的是静音',
      'warning.decodeFailed': '无法解码音频：{name}',
      hint: 'Option/Alt + ←/→ 切换段落，Option/Alt + P 播放/停止',
      popupSite: '当前站点：{origin}',
      popupEnable: '在此站点启用模拟麦克风',
      popupLocal: 'localhost / 127.0.0.1 默认始终启用',
      popupUnsupported: '此页面不支持，请在 http / https 网页上打开插件',
      popupHint: '开关立即生效，无需刷新页面',
      popupOn: '已在本站启用',
      popupOff: '已停用本站',
    },
    en: {
      appName: 'Fake Mic',
      collapse: 'Collapse',
      expand: 'Expand',
      optionEnabled: 'Enable fake mic',
      optionMonitor: 'Monitor through speakers',
      optionAutoPlay: 'Auto-play on record',
      optionAutoAdvance: 'Advance after recording',
      triggerLabel: 'Playback trigger:',
      triggerRecorder: 'On MediaRecorder start',
      triggerGetUserMedia: 'On getUserMedia',
      langLabel: 'Language:',
      langAuto: 'Automatic',
      langZh: '中文',
      langEn: 'English',
      listEmpty: 'Click “Add audio” or drop audio files here',
      addAudio: '+ Add audio',
      play: '▶ Play',
      stop: '■ Stop',
      moveUp: 'Move up',
      moveDown: 'Move down',
      remove: 'Delete',
      statusOff: 'Off — the page uses the real microphone',
      statusRecording: 'Recording',
      statusIdle: 'Idle',
      statusClip: 'Clip {index}/{total}',
      statusNoClip: 'No clip selected',
      statusLoading: 'Loading…',
      statusPlaying: 'Playing {position}/{duration}s',
      statusSuspended: 'Audio inactive — click the panel',
      noticeLast: 'Already at the last clip',
      noticeFirst: 'Already at the first clip',
      noticeBadAudio: 'Not a usable audio file: {name}',
      'warning.noClip': 'No clip selected — the recording will be silent',
      'warning.decodeFailed': 'Could not decode audio: {name}',
      hint: 'Option/Alt + ←/→ switch clip, Option/Alt + P play/stop',
      popupSite: 'Current site: {origin}',
      popupEnable: 'Enable fake mic on this site',
      popupLocal: 'Always enabled on localhost / 127.0.0.1',
      popupUnsupported: 'Not available on this page — open a regular http / https page',
      popupHint: 'Takes effect immediately, no reload needed',
      popupOn: 'Enabled on this site',
      popupOff: 'Disabled on this site',
    },
  }

  const SUPPORTED = Object.keys(MESSAGES)

  /** 浏览器界面语言（扩展页语言），拿不到就退回页面语言。 */
  function uiLanguage() {
    try {
      return chrome.i18n.getUILanguage() || navigator.language || ''
    } catch {
      return navigator.language || ''
    }
  }

  /** 'auto' 跟随浏览器：中文环境用中文，其余用英文；'zh' / 'en' 为手动指定。 */
  function resolveLang(choice) {
    if (SUPPORTED.includes(choice)) return choice
    return uiLanguage().toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }

  /** 返回 { lang, t }；t(key, params) 用 params 替换文案里的 {占位符}。 */
  function translator(choice) {
    const lang = resolveLang(choice)
    const table = MESSAGES[lang]
    return {
      lang,
      t(key, params) {
        const text = table[key] ?? MESSAGES.en[key] ?? key
        return params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match)) : text
      },
    }
  }

  window.__fakeMicI18n = { MESSAGES, SUPPORTED, uiLanguage, resolveLang, translator }
})()
