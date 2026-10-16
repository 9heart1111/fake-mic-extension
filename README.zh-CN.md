# Fake Mic：用音频文件模拟麦克风的 Chrome 插件

[English](README.md)

测试录音功能时不用对着麦克风说话：插件替换页面里 `navigator.mediaDevices.getUserMedia` 返回的音频，改成你上传的音频文件。适合多轮录音测试，每一轮可以用不同的音频段。

- 不需要 BlackHole 等虚拟声卡，也不用改被测项目的代码。
- 页面拿到的是真正的 `MediaStream`，`MediaRecorder`、Web Audio 都能照常处理。
- 音频段播完后音轨不会结束，而是继续输出静音，相当于真人说完话停下来，不会被页面当成“麦克风断开”。

## 安装

1. 打开 `chrome://extensions`，打开右上角的“开发者模式”。
2. 点“加载已解压的扩展程序”，选择本项目根目录（`manifest.json` 所在的目录）。
3. 改了插件代码后，在扩展页点刷新按钮，再刷新被测页面。

插件默认只在 `localhost` 和 `127.0.0.1`（任意端口，http 和 https 都算）上生效。要用在其他地址，把地址加进 `manifest.json` 里两个 `content_scripts` 的 `matches`，例如 `"https://192.168.1.10/*"`，然后刷新插件。

## 使用

打开被测页面后，右下角会出现“模拟麦克风”面板。面板可以拖动，也可以折叠。

1. 点“+ 添加音频”，或者直接把音频文件拖到面板上，支持 mp3、wav、m4a、ogg、webm，可以一次选多个。音频保存在插件里，所有 localhost 页面共用，刷新页面后不会丢。
2. 点列表里的某一行，把它设为当前段；用 ↑ ↓ 调整顺序，✕ 删除。
3. 在页面上点开始录音，插件会自动播放当前段，录完后自动切到下一段。多轮测试时，按顺序排好音频，依次答题就行。

| 选项 | 作用 |
| --- | --- |
| 启用模拟麦克风 | 关闭后页面使用真实麦克风 |
| 录音开始自动播放 | 关闭后需要手动点“▶ 播放”或按快捷键，可以模拟停顿一会儿再说话 |
| 录完切到下一段 | 每次录音结束后选中下一段 |
| 扬声器同时播放 | 播放时你也能听到声音 |
| 开始播放 | `MediaRecorder.start 时`：默认值，页面开始录音时播放。`getUserMedia 返回时`：页面拿到麦克风时就播放，用于不用 MediaRecorder 的页面（例如用 AudioWorklet 做流式识别），这种模式下页面停止音轨时视为录音结束 |

快捷键（在被测页面上使用）：

- `Option/Alt + →` / `Option/Alt + ←`：切到下一段 / 上一段
- `Option/Alt + P`：播放 / 停止。录音中途按下可以重新开始播放当前段

状态行如果显示“音频未激活，点一下面板”，说明浏览器的自动播放策略挡住了声音，点一下面板就能恢复。

## 已知限制

- 不支持 `webkitSpeechRecognition` / `SpeechRecognition`：这类接口由浏览器直接读取系统麦克风，不经过 `getUserMedia`。
- 没有改写 `enumerateDevices` 和 `navigator.permissions.query`，依赖设备列表或麦克风权限状态的页面看到的是真实情况。
- 页面如果先把麦克风的流交给自己的 AudioContext 处理，再录制处理后的流，`MediaRecorder.start 时` 识别不出这是模拟音轨，请改用 `getUserMedia 返回时`。
- 状态行只反映顶层页面里的录音；录音发生在 iframe 内时，音频照常替换、自动切段也正常，但状态行不会显示“录音中”。
- 音频以 base64 存在插件本地存储里，单个文件建议不超过几十 MB。

## 开发与测试

```bash
npm install
npx playwright install chromium   # 首次运行
npm test
```

测试会启动一个加载了本插件的 Chromium，在 `127.0.0.1:4321` 的测试页上录音，再分析录到声音的频率，检查三件事：

- 录到的是当前选中的段落，段落播完后音轨仍然在线；
- 录完会自动切到下一段，下一轮录到的是新段落；
- 关闭插件后，页面拿到的是真实麦克风（Chrome 的模拟设备）。

## 文件

- `manifest.json`：插件清单（Manifest V3）。
- `src/main-world.js`：运行在页面主世界，替换 `getUserMedia`，监听 `MediaRecorder` 的开始和停止，用 Web Audio 播放音频段。
- `src/panel.js`：运行在隔离世界，负责悬浮面板、音频库（`chrome.storage.local`）和快捷键，通过 `window.postMessage` 与主世界通信。
- `tests/`：Playwright 端到端测试、测试页和静态服务器。

## 开源协议

[MIT](LICENSE)
