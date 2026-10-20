# Contributing to Fake Mic

Thanks for taking the time to help! This is a small project with no build step — `src/` is loaded by Chrome exactly as it is committed.

[中文说明在下面](#中文说明)

## Getting started

```bash
git clone https://github.com/9heart1111/fake-mic-extension.git
cd fake-mic-extension
npm install
npx playwright install chromium   # first run only
npm test
```

Requires Node.js 20.11 or newer (the test helpers use `import.meta.dirname`).

To try the extension by hand: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and pick the repository root. After changing a file, hit the reload button on the extensions page and refresh the page under test.

## Conventions

- **No build step, no dependencies at runtime.** `src/*.js` are plain scripts loaded as content scripts; keep it that way.
- **Code style:** 2-space indent, no semicolons, single quotes, ~120 columns. `.editorconfig` covers the basics.
- **Tests must stay green** (`npm test`). If you change behaviour, add or adjust a test in `tests/`. The UI keeps `data-key` attributes on form controls specifically so tests don't depend on the interface language — please keep them.
- **Both languages, always.** Any user-visible string goes into the `zh` *and* `en` tables in [`src/i18n.js`](src/i18n.js). Manifest-level name/description live in `_locales/{en,zh_CN}/messages.json`.
- **Don't leak clips.** The panel only sends audio data to pages that are enabled for the extension; keep that invariant when touching `src/panel.js` or `src/main-world.js`.
- **Screenshots and icons are generated.** If you change the UI, run `npm run screenshots` and commit the updated images in `docs/screenshots/`. Icons come from `npm run icons`.

## Pull requests

- Keep a PR focused on one thing, and describe what you changed and how you tested it.
- Commit messages follow a light conventional style, e.g. `feat: …`, `fix: …`, `docs: …`, `test: …`.
- CI (`.github/workflows/test.yml`) runs the Playwright suite on every push and pull request.

## Ideas that would be welcome

- More languages (copy the `en` table in `src/i18n.js` and the `_locales/en` folder).
- Support for `SpeechRecognition` (hard: it bypasses `getUserMedia`).
- A per-site options page for clip management, or importing a folder of clips at once.

---

## 中文说明

感谢你帮忙改进这个项目！项目**没有构建步骤**：`src/` 里的文件就是 Chrome 直接加载的内容。

### 本地开发

```bash
git clone https://github.com/9heart1111/fake-mic-extension.git
cd fake-mic-extension
npm install
npx playwright install chromium   # 首次运行
npm test
```

需要 Node.js 20.11 或更高版本。

手动试用：打开 `chrome://extensions`，开启「开发者模式」，点「加载已解压的扩展程序」选择仓库根目录。改完代码后在扩展页点刷新，再刷新被测页面。

### 约定

- **不要引入构建步骤**：`src/*.js` 是直接当作 content script 加载的普通脚本。
- **代码风格**：2 空格缩进、不写分号、单引号、约 120 列（`.editorconfig` 已覆盖基础项）。
- **测试必须通过**：改了行为就补/改 `tests/` 里的用例。表单控件上的 `data-key` 是给测试用的（让测试不依赖界面语言），请保留。
- **中英文都要加**：所有界面文案要同时写进 `src/i18n.js` 的 `zh` 和 `en` 两张表；插件名称和简介在 `_locales/{en,zh_CN}/messages.json`。
- **不要泄漏音频数据**：面板只向「已启用」的站点下发音频段，改动 `panel.js` / `main-world.js` 时请保持这个前提。
- **截图和图标是脚本生成的**：改了界面就运行 `npm run screenshots`，把 `docs/screenshots/` 的更新一起提交；图标用 `npm run icons`。

### 提交 PR

- 一个 PR 做一件事，写清楚改了什么、怎么验证的。
- 提交信息用轻量的 conventional 风格：`feat: …`、`fix: …`、`docs: …`、`test: …`。
- CI（`.github/workflows/test.yml`）会在每次 push 和 PR 上跑 Playwright 测试。
