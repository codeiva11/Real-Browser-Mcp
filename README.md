# 🦁 Real Browser MCP

[![npm version](https://img.shields.io/npm/v/real-browser-mcp-server.svg)](https://www.npmjs.com/package/real-browser-mcp-server)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg)](https://nodejs.org/)
[![Build & Test](https://github.com/codeiva11/Real-Browser-Mcp/actions/workflows/publish.yml/badge.svg)](https://github.com/codeiva11/Real-Browser-Mcp/actions/workflows/publish.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A production-ready **Model Context Protocol (MCP)** server that equips AI agents with a reliable, controlled web browser for automation and testing. Built on **Patchright** (a hardened Playwright fork) and integrated with **Ghostery Adblocker**, **Ghost Cursor** (natural mouse dynamics), and an automation assistant for Cloudflare Turnstile challenges.

This server is **100% compatible with all major AI IDEs** (Cursor, VS Code, Cline, Roo Code, Windsurf, PearAI, OpenCode, Kilo Code, and Claude Desktop) using standard **STDIO** communication.

> 📋 See [POLICY.md](./POLICY.md) for acceptable use guidelines. This tool is intended for QA, testing, accessibility automation, and authorized research.

---

## ⚙️ Installation & Setup
Since this project is published on NPM, you can run it either globally via `npx` / `npm`, or locally by building from source.

### ⚡ Quick Start (Using npx)

Add the following to your MCP Configuration file (e.g. `cline_mcp_settings.json`, `claude_desktop_config.json`, or Cursor):

```json
{
  "mcpServers": {
    "real-browser": {
      "command": "npx",
      "args": ["-y", "real-browser-mcp-server@latest", "mcp"]
    }
  }
}
```

### 💻 Local Run (Direct Source / Pre-built)
If running directly from the local repository build:

```json
{
  "mcpServers": {
    "real_browser_mcp_server": {
      "command": "node",
      "args": [
        "E:/Github-Software/Real-Browser-Mcp/dist/src/index.js"
      ],
      "env": {
        "AI_HEALING": "true",
        "HEADLESS": "false"
      }
    }
  }
}
```
### 🌍 Global Installation

Install it globally on your system. The hardened browser (Patchright Chromium) is **downloaded automatically** during install — no extra steps needed:

```bash
# One command: installs the server AND auto-downloads Patchright Chromium
npm install -g real-browser-mcp-server

# Run the MCP server
real-browser-mcp mcp
```

> [!NOTE]
> The `postinstall` step automatically runs `patchright install chromium`, which detects your OS and CPU architecture (Windows / Linux / macOS × x64 / arm64 / arm) and fetches the correct binary. If auto-download is skipped (e.g. offline), run it manually:
> ```bash
> npx patchright install chromium
> ```
>
> Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` before `npm install` to skip the download (e.g. in CI that only builds).

### 🛠️ Local Development & Build (Git Clone)

If you want to clone the repository and run it locally, follow these exact steps:

```bash
# 1. Clone the repository
git clone https://github.com/codeiva11/Real-Browser-Mcp.git

# 2. Navigate to the project directory
cd Real-Browser-Mcp

# 3. Install dependencies (Patchright Chromium is auto-downloaded via postinstall)
npm install

# 4. Build the TypeScript files
npm run build

# 5. Start the MCP server
npm run mcp
```

> [!NOTE]
> *Why does `npm run build` not build the entire project alone?*
> `npm run build` only compiles the TypeScript code into JavaScript (`dist/`). However, the hardened browser engine (`patchright`) requires the browser binaries, which are now fetched **automatically** by the `postinstall` hook (`npx patchright install chromium`). If you skipped it, run that command manually. Without Chromium, the server will crash trying to find it.

### 🐳 Run via Docker (Recommended for Servers)

We automatically build and publish a production-ready Docker image to GitHub Container Registry (GHCR).

```bash
# Pull the latest image
docker pull ghcr.io/codeiva11/real-browser-mcp:latest

# Run the MCP Server (Interactive stdio mode for AI IDEs)
docker run -i --rm ghcr.io/codeiva11/real-browser-mcp:latest
```

*(Note: When running via Docker, it automatically runs in headless mode.)*

---

## 🚀 Key Automation & Reliability Features

* **Reliable Browser Engine**: Powered by **Patchright Chromium**, a hardened Playwright fork that reduces false-positives in automation environments (does not expose automation indicators or Webdriver/BiDi flags).
* **Integrated Ad & Tracker Blocker**: Utilizes `@ghostery/adblocker-playwright` with in-memory prebuilt filter lists (no disk cache), blocking ads and speed-bumps.
* **Natural Interactions**: Integrates **ghost-cursor-patchright** (Bézier curves) to simulate natural mouse movements, velocity, and hover-before-click behaviors. Features **Physics-based Smooth Scrolling** (`page.realScroll`) utilizing real mouse-wheel events and Cubic Ease-Out deceleration to mimic manual trackpad/mouse flicks for reliable interaction with dynamic UIs.
* **Human-like Browsing**: `see_page` lets the AI agent plan an entire multi-step task from **one** view and execute all actions in a single continuous flow via its unified `steps` workflow — no screenshot pause after every micro-step, just like a human. (The previously separate `browse_task` tool is now merged into `see_page` to avoid agent confusion.)
* **Rich Single-Shot Vision**: `see_page` now returns a screenshot **plus** full page text, all interactive elements with selectors, and an iframe inventory in one call — eliminating the need to re-capture the same page repeatedly.
* **Turnstile Assist**: Detects and assists with Cloudflare Turnstile challenges on pages you are authorized to access.
* **Anti-Race Condition Guards**: Robust state-guards ensure popup blockers, shims, and adblockers attach exactly once per page, preventing context destruction.
* **TypeScript**: Entire codebase is written in TypeScript with `strict: true` for type safety and maintainability.

---

## 🛠️ AI IDE Compatibility & Configuration Guide

Since this server adheres strictly to the official Model Context Protocol (MCP) specification over **STDIO** (with all informational logging directed safely to `stderr` to avoid JSON-RPC corruption), it is fully compatible with every modern AI editor.

### 1. Claude Desktop
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "command": "npx",
      "args": ["-y", "real-browser-mcp-server@latest", "mcp"],
      "env": {
        "HEADLESS": "false",
        "AI_HEALING": "true"
      }
    }
  }
}
```

### 2. Cursor IDE
1. Open Cursor Settings ➔ **Features** ➔ **MCP**.
2. Click **+ Add New MCP Server**.
3. Configure as follows:
   * **Name**: `real-browser-mcp-server`
   * **Type**: `command`
   * **Command**: `npx -y real-browser-mcp-server@latest mcp`
4. Click **Save**.

### 3. Cline / Roo Code (VS Code)
Add the server entry to your global MCP settings file (typically found at `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "real-browser-mcp-server@latest", "mcp"],
      "env": {
        "HEADLESS": "false",
        "AI_HEALING": "true"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### 4. Kilo Code (VS Code)
Add the server entry to your `~/.config/kilo/kilo.jsonc` (global) or project `kilo.jsonc`:

**Option A: Local Clone (Recommended for development)**
```json
{
  "mcp": {
    "real_browser_mcp_server": {
      "type": "local",
      "command": [
        "node",
        "E:/Github-Software/Real-Browser-Mcp/dist/src/index.js"
      ],
      "environment": {
        "HEADLESS": "false",
        "AI_HEALING": "true"
      },
      "enabled": true
    }
  }
}
```

**Option B: Global via npx (Windows)**
On Windows, call through `cmd.exe /c npx` so the batch script resolves cleanly:
```json
{
  "mcp": {
    "real_browser_mcp_server": {
      "type": "local",
      "command": ["cmd.exe", "/c", "npx", "-y", "real-browser-mcp-server@latest", "mcp"],
      "environment": {
        "HEADLESS": "false",
        "AI_HEALING": "true"
      },
      "enabled": true
    }
  }
}
```

**Option C: Global via npx (macOS / Linux)**
```json
{
  "mcp": {
    "real_browser_mcp_server": {
      "type": "local",
      "command": ["npx", "-y", "real-browser-mcp-server@latest", "mcp"],
      "environment": {
        "HEADLESS": "false",
        "AI_HEALING": "true"
      },
      "enabled": true
    }
  }
}
```

### 5. Windsurf IDE
Configure the server in your `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "command": "npx",
      "args": ["-y", "real-browser-mcp-server@latest", "mcp"],
      "env": {
        "HEADLESS": "false",
        "AI_HEALING": "true"
      }
    }
  }
}
```

### 6. PearAI
Add the configuration via **PearAI Settings** ➔ **MCP Servers** using the standard `command` setup:

```json
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "command": "npx",
      "args": ["-y", "real-browser-mcp-server@latest", "mcp"],
      "env": { "HEADLESS": "false" }
    }
  }
}
```

### 7. OpenCode AI IDE
Configure the server in your `opencode.jsonc` or standard MCP settings configuration:

```jsonc
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "command": "npx",
      "args": ["-y", "real-browser-mcp-server@latest", "mcp"],
      "env": {
        "HEADLESS": "false",
        "AI_HEALING": "true"
      }
    }
  }
}
```

---

## ⚙️ Environment Variables

You can configure `browser_init` defaults directly from the MCP client `env` block, without passing parameters on every call. Explicit parameters passed to `browser_init` always override these environment variables.

| Variable | Values | Default | Controls |
|:---|:---|:---|:---|
| `HEADLESS` | `true` / `false` / `1` / `0` / `yes` / `no` | auto (CI + no-display detection) | Run browser headless (no visible window) |
| `AI_HEALING` | `true` / `false` / `1` / `0` / `yes` / `no` / `on` / `off` | `true` | Auto-repair broken CSS selectors in `click`/`type` |
| `ENABLE_BLOCKER` | `true` / `false` / `1` / `0` / `yes` / `no` / `on` / `off` | `true` | Block ads and trackers |
| `TURNSTILE` | `true` / `false` / `1` / `0` / `yes` / `no` / `on` / `off` | `false` | Assist with Cloudflare Turnstile challenges |
| `REAL_BROWSER_ALLOW_PRIVATE_NETWORK` | `true` / `1` / `yes` | off | Allow `navigate`/`replay_request`/`redirect_tracer` to target localhost/private IPs (off by default — SSRF guard) |
| `CHROME_NO_SANDBOX` | `true` / `1` / `yes` / `false` / `0` | auto (CI/root detection) | Force-disable or force-enable the Chromium OS sandbox |
| `REAL_BROWSER_TOOL_TIMEOUT_MS` | integer | `120000` | Hard watchdog budget per tool call (avoids client "Request timed out") |
| `REAL_BROWSER_LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` | Structured JSON log verbosity (stdout stays clean for MCP) |
| `REAL_BROWSER_SEND_PROGRESS` | `true` / `1` | off | Emit `notifications/progress` JSON-RPC messages to the MCP client |
| `REAL_BROWSER_VIDEO_DIR` | path | `$TMPDIR/real-browser-mcp/videos` | Where `recordVideo` writes `.webm` recordings |
| `REAL_BROWSER_USER_AGENT` | UA string or comma-separated list | auto (built from Chromium version) | Override/rotate the browser User-Agent. A list (`ua1,ua2`) rotates one entry per `browser_init` call |
| `REAL_BROWSER_ALLOW_DECRYPT` | `true` / `1` / `yes` | off | Opt-in for `extract_data`'s auto key-discovery AES conversion. Off by default because it can strip content protection (and it also trips AI-provider safety classifiers). Basic format conversion (URL/base64/hex) always works |

Values are case-insensitive. Priority for each option is: **explicit `browser_init` param > environment variable > built-in default**.

> ⚠️ **Tool-result content safety:** some AI providers (e.g. Anthropic) run safety classifiers on tool *results*, not just tool definitions. Tool payloads in this server are written content-neutral on purpose — do not patch instructions into tool results telling the model to "read the verification image and type the answer", or you will get `[400]: content-blocked`.

> 🛡️ **Input caps (hard limits):** `press_key.count` ≤ 100, `click.clickCount` ≤ 50, `see_page.steps` ≤ 100, `media_extractor batch_extract.urls` ≤ 50, `execute_js.code` ≤ 200k chars. Values beyond these are clamped with a warning — a runaway agent can never lock the server for hours.

---

## 🌐 Complete MCP Tool Reference (21 Tools)

The server exposes **21 tools** categorized into functional units:

### 🌐 Browser & Session
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `browser_init` | Initialize Patchright browser with ad blocker, AI healing, embedded-widget assist, WebGL/hardware spoofing, and WebRTC leak protection. | `headless`, `proxy`, `widgetAssist`, `enableBlocker`, `aiHealing`, `spoofFingerprint`, `blockWebRTCLeaks` |
| `browser_close` | Close browser with cleanup. | `force` |

### 🧭 Navigation & Tab Management
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `navigate` | Navigate to URL or manage browser tabs (`list`, `switch`, `new`, `close`) with auto-switch for popups and smart retry. | `url`, `tabAction`, `tabIndex`, `autoSwitchNewTab`, `waitUntil`, `timeout` |

### 👆 Natural Interaction
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `click` | Natural click or drag-and-drop (`dragTo`) using ghost cursor with slider friction, iframe, hover, and video player support. | `selector`, `annotationId`, `dragTo`, `humanLike`, `hoverFirst`, `iframe`, `autoDetectPlayer` |
| `type` | Type text with natural speed variation, smart clearing, and iframe support. | `selector`, `annotationId`, `text`, `clear`, `pressEnter`, `iframe` |
| `solve_captcha` | Form filling and embedded widget completion for pages you are testing (JS widgets, text/image input recognition). Externally hosted services are not supported. | `type`, `captchaSelector`, `formData`, `submit` |
| `random_scroll` | Natural scrolling with lazy-load detection. | `direction`, `amount`, `smooth`, `aiDetectLazyLoad` |
| `press_key` | Press keyboard keys with modifier key support (Ctrl/Shift/Alt). | `key`, `modifiers`, `count` |
| `execute_js` | Run custom JavaScript inside a page or iframe. ⚠️ Use with trusted input only. | `code`, `async`, `iframe`, `timeout` |

### 📄 Extraction & Decoding
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `get_content` | Retrieve page content in `html`, `text`, `markdown`, `rawHttp`, or `elements` mode. | `format`, `selector`, `xpath`, `saveAs` |
| `extract_data` | Advanced extractor: regex, JSON, meta, structured, auto, API discovery, string conversion, links. | `type`, `pattern`, `source`, `transformKey` |
| `media_extractor` | Extract HLS/DASH/MP4, control player APIs, convert string formats. | `action`, `types`, `quality`, `playerAction` |

### 📡 Network & Utilities
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `redirect_tracer` | Trace full redirect chains (HTTP 301/302, JS, meta refresh). | `url`, `maxRedirects`, `decodeURLs` |
| `network_recorder` | Capture requests, responses, intercepted APIs, GraphQL, WebSockets, media URLs, block unwanted resource URLs (3x faster loads), and mock API routes. Export HAR. | `action`, `patterns`, `mock`, `captureXhrBody` |
| `deep_analysis` | DOM structure, scripts, page components, tech stack, SEO, and recommendations. | `types`, `detailed`, `detectAccessControls` |
| `wait` | Smart delay for selectors, navigation events, or fixed timeout. | `type`, `value`, `timeout` |
| `progress_tracker` | Track automation progress with AI-estimated remaining time. | `action`, `taskName`, `progress` |
| `storage_inspector` | Inspect & manage client-side storage, cookies, and session state persistence (`cookies`, `save_session`, `load_session`, `clear_cookies`, `indexeddb`, `service_workers`). | `action`, `sessionPath` |
| `replay_request` | Replay a captured API request in browser context. | `url`, `method`, `headers`, `body` |
| `api_analyzer` | Generate JSON schemas, diff two JSONs, or create SDK boilerplates (Python/TypeScript). | `action`, `data`, `lang` |

### 👁️ AI Vision & Human-like Workflow
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `see_page` | **Unified vision + human-like task runner**: screenshot + page text + all interactive elements + iframe inventory in ONE call. Optionally pass a `steps[]` array (`click`, `type`, `drag`, `hover`, `double_click`, `triple_click`, `idle`, `scroll`, `wait`, `extract`, `see`) to execute the whole multi-step task back-to-back in a single continuous flow — no screenshot pause between steps, with automatic before + after screenshots and a per-step report. | `fullPage`, `annotate`, `includePageText`, `scanIframes`, `maxElements`, `format`, `quality`, `steps[]`, `captureBefore`, `captureAfter`, `stopOnError` |

> **Human-like Workflow Pattern:**
> ```
> OLD (repetitive): see_page → click → see_page → type → see_page → click ...
> NEW (human-like): see_page (once, fullPage) → steps:[click, type, scroll, extract] → see_page (only on page change)
> ```

> [!IMPORTANT]
> [!IMPORTANT]
> The verification-widget tool is named **`solve_captcha`** and its
> **`captchaSelector`** parameter targets the input image or widget element.
> It only assists with widgets on pages you are testing; externally hosted
> services (reCAPTCHA/hCaptcha) are not supported — descriptions stay neutral.

If the current model cannot consume images, `see_page` still returns a full text + JSON summary, and `solve_captcha` can return text-only fallback guidance when called with `preferTextFallback: true`.

---

## 📈 Reliability & Test Coverage

Our test suites cover several real-world pages. Results depend on environment, third-party site changes, and network conditions.

| Target Test Platform | Detection Type | Status |
|:---|:---|:---|
| **Sannysoft WebDriver** | WebDriver/navigator properties check | ✅ Pass |
| **Cloudflare WAF** | Web Application Firewall challenge | ✅ Pass |
| **Cloudflare Turnstile** | CAPTCHA widget assist | ✅ Pass |
| **FingerprintJS Bot Detector** | Fingerprint-based bot detection | ✅ Pass |
| **reCAPTCHA v3 Score** | Google Trust Score test | ✅ Environment-dependent |
| **Pixelscan Fingerprint** | Canvas fingerprint check | ✅ Pass (No Masking Detected) |
| **Rebrowser Bot Detector** | Advanced bot signal detection | ✅ Pass |

### 🧪 Local Test Suite

| Test Suite | Test Case | Status |
|:---|:---|:---|
| **CJS + ESM** | Sannysoft WebDriver Detector | ✅ Passed |
| **CJS + ESM** | Cloudflare WAF | ✅ Passed |
| **CJS + ESM** | Cloudflare Turnstile | ✅ Passed |
| **CJS + ESM** | Fingerprint JS Bot Detector | ✅ Passed |
| **CJS + ESM** | Recaptcha V3 Score | ✅ Passed |
| **CJS + ESM** | Pixelscan Fingerprint Check | ✅ Passed |

---

## 💻 Programmatic Usage (Node.js SDK)

You can also use the core browser connector directly in your custom Node.js scripts.

### CommonJS
```javascript
const { connect } = require('real-browser-mcp-server');

(async () => {
  const { browser, page } = await connect({
    headless: false,
    turnstile: true
  });

  await page.goto('https://example.com');

  // Natural mouse movement and click
  await page.realClick('#my-button');

  // Natural smooth scrolling (60FPS Cubic Ease-Out physics)
  await page.realScroll(400); // scrolls down 400px smoothly

  await browser.close();
})();
```

### ESM (ECMAScript Modules)
```javascript
import { connect } from 'real-browser-mcp-server';

const { browser, page } = await connect({
  headless: false,
  turnstile: true
});

await page.goto('https://example.com');
await page.realClick('#my-button');

// Natural smooth scrolling (60FPS Cubic Ease-Out physics)
await page.realScroll(400); // scrolls down 400px smoothly

await browser.close();
```

---

## ⌨️ NPM Script Commands

Run these scripts from the project root directory:

| Command | Description |
|:---|:---|
| `npm start` | Start the MCP server using standard STDIO transport. |
| `npm run dev` | Build and start the MCP server. |
| `npm run mcp` | Start the MCP server. |
| `npm run mcp:verbose` | Start the MCP server with verbose tool listing on `stderr`. |
| `npm run list` | List all 21 registered MCP tools with categories. |
| `npm run build` | Compile TypeScript into the `dist/` folder. |
| `npm test` | Build, then run the live anti-bot test suite (`test/test.mjs`) for both CJS and ESM. ⚠️ Launches a real browser and hits live third-party sites — network- and IP-dependent. Every check is strict; a failing check fails the run, nothing is skipped. |
| `npm run cjs_test` | Run CommonJS test scripts. |
| `npm run esm_test` | Run ECMAScript Module test scripts. |

> Every check in the live-site suite is strict: a failing check (e.g. reCAPTCHA v3 score below 0.9) fails the run. Nothing is ever skipped.

---

## 🏗️ Architecture Notes

### Design

- **MCP-first**: every tool is defined in `src/shared/tools.ts` and dispatched through a single `executeTool()` router.
- **Handler modules**: `src/mcp/handlers/` contains focused files — `network-recorder.ts`, `network-extractors.ts`, `vision-captcha.ts`, `vision-see-page.ts`, `media-handlers.ts` — with thin wrappers (`network.ts`, `vision.ts`, `index.ts`) for the tool-facing API.
- **Browser state**: a single global `state` object in `src/mcp/handlers/state.ts` holds the current browser/page instance and network recorder data. `requireBrowser()` / `getState()` provide typed accessors for handlers.
- **Human-like workflow**: the unified `see_page` `steps[]` workflow orchestrates the existing `click`/`type`/`scroll`/`press_key`/`wait`/`extract` handlers in a continuous sequence — no extra LLM or API key required. The AI agent (LLM client) plans the steps; `see_page` executes them without pausing.
- **No project pollution**: runtime caches (User-Agent detection, saved sessions) are written to the OS temp directory (`os.tmpdir()/real-browser-mcp`), **never** inside the project or working directory. The server does **not** create a `.cache` folder in your project tree.
- **`execute_js` caveat**: the `execute_js` tool runs arbitrary JavaScript inside the controlled browser page context (a sandboxed browser tab). Only invoke it with trusted input.

### Known Limitations

- **Single-session model**: the MCP server manages one browser instance at a time. Concurrent multi-session isolation is not supported.
- **reCAPTCHA / hCaptcha**: detected honestly but not solved automatically. Use a third-party service for these.
- **Vision tools require image-capable models**: `see_page` and `solve_captcha` return images. Non-vision models get a full text + JSON summary fallback.
- **TypeScript strict mode**: the project compiles with `strict: true` across all source files, and `noEmitOnError: true` makes a type error fail the build outright (`tsc --noEmit` passes cleanly).

---

## 🛡️ License

This project is licensed under the **ISC License**. Created and maintained by [codeiva11](https://github.com/codeiva11).
