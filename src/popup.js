// 工具栏弹窗：显示当前站点的启用状态，并写入 sites 白名单（chrome.storage.local）。
// 面板（panel.js）监听 storage 变化，所以开关立即生效，不用刷新页面。
;(async () => {
  const i18n = window.__fakeMicI18n
  const LOCAL_HOSTS = ['localhost', '127.0.0.1']
  const $ = (id) => document.getElementById(id)

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const { ui, sites = [] } = await chrome.storage.local.get(['ui', 'sites'])
  const { t, lang } = i18n.translator(ui?.lang ?? 'auto')
  document.documentElement.lang = lang
  $('title').textContent = t('appName')
  $('toggle-label').textContent = t('popupEnable')

  let origin = ''
  try {
    const url = new URL(tab?.url ?? '')
    if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin
  } catch {}

  // 扩展页、chrome:// 等页面拿不到可注入的站点，只提示不支持。
  if (!origin) {
    $('site').textContent = t('popupUnsupported')
    return
  }

  $('site').textContent = t('popupSite', { origin })
  $('toggle-row').hidden = false

  // localhost / 127.0.0.1 始终启用，不给关。
  if (LOCAL_HOSTS.includes(new URL(origin).hostname)) {
    $('toggle').checked = true
    $('toggle').disabled = true
    $('hint').textContent = t('popupLocal')
    return
  }

  $('toggle').checked = sites.includes(origin)
  $('hint').textContent = t('popupHint')
  $('toggle').addEventListener('change', async (event) => {
    const current = (await chrome.storage.local.get('sites')).sites ?? []
    const next = new Set(current)
    if (event.target.checked) next.add(origin)
    else next.delete(origin)
    await chrome.storage.local.set({ sites: [...next] })
    $('hint').textContent = t(event.target.checked ? 'popupOn' : 'popupOff')
  })
})()
