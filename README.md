# 🦁 Real Browser MCP

[![npm version](https://img.shields.io/npm/v/real-browser-mcp-server.svg)](https://www.npmjs.com/package/real-browser-mcp-server)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg)](https://nodejs.org/)
[![Build & Test](https://github.com/codeiva11/Real-Browser-Mcp/actions/workflows/publish.yml/badge.svg)](https://github.com/codeiva11/Real-Browser-Mcp/actions/workflows/publish.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A production-ready **Model Context Protocol (MCP)** server that equips AI agents with a reliable, controlled, and undetectable web browser for automation, scraping, and testing. Built on **Patchright** (a stealth-hardened Playwright fork) and integrated with **Ghostery Adblocker**, **Ghost Cursor** (natural human mouse dynamics), **Web Worker Consistency**, and an advanced automated solver for **Cloudflare Turnstile & WAF Managed Challenges**.

This server is **100% compatible with all major AI IDEs and clients** (Cursor, Antigravity, Claude Desktop, VS Code, Cline, Roo Code, Windsurf, PearAI, OpenCode, and Kilo Code) using standard **STDIO** communication.

> 📋 See [POLICY.md](./POLICY.md) for acceptable use guidelines. This tool is intended for QA, testing, accessibility automation, and authorized research.

---

## ⚙️ Installation & Setup

Since this project is published on NPM as [`real-browser-mcp-server`](https://www.npmjs.com/package/real-browser-mcp-server), you can run it instantly via `npx`, install it globally via `npm`, or build from source.

### ⚡ Quick Start (Recommended via npx)

Add the following to your AI client's MCP configuration file (e.g. `claude_desktop_config.json`, `cline_mcp_settings.json`, or Cursor):

```json
{
  "mcpServers": {
    "real-browser": {
      "command": "npx",
      "args": ["-y", "real-browser-mcp-server@latest", "mcp"],
      "env": {
        "HEADLESS": "false",
        "AI_HEALING": "true",
        "TURNSTILE": "true"
      }
    }
  }
}
```

---

### 🌍 Global Installation

Install globally on your system. The hardened browser (Patchright Chromium) is **automatically downloaded** during installation:

```bash
# 1. Install globally (auto-downloads matching Patchright Chromium)
npm install -g real-browser-mcp-server

# 2. Run the MCP server
real-browser-mcp mcp

# Or check all registered tools
real-browser-mcp --list
```

> [!NOTE]
> The `postinstall` step automatically runs `patchright install chromium`, which detects your OS and CPU architecture (Windows / Linux / macOS × x64 / arm64) and fetches the correct browser binary. If auto-download is skipped (e.g., in air-gapped or CI environments), run:
> ```bash
> npx patchright install chromium
> ```
> To skip browser binary download during package builds, set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.

---

### 🛠️ Local Development & Build (From Git Source)

To clone, develop, or run locally:

```bash
# 1. Clone the repository
git clone https://github.com/codeiva11/Real-Browser-Mcp.git

# 2. Navigate to project root
cd Real-Browser-Mcp

# 3. Install dependencies (Chromium binary auto-downloads via postinstall)
npm install

# 4. Build TypeScript to dist/ and generate ESM wrappers
npm run build

# 5. Launch MCP Server
npm run mcp
```

#### Running Local Build in MCP Config:
```json
{
  "mcpServers": {
    "real-browser-local": {
      "command": "node",
      "args": [
        "<path-to-repository>/Real-Browser-Mcp/dist/src/index.js",
        "mcp"
      ],
      "env": {
        "HEADLESS": "false",
        "AI_HEALING": "true"
      }
    }
  }
}
```

---

### 🐳 Run via Docker (For Headless & Server Environments)

A production-ready Docker container is published to the GitHub Container Registry (GHCR):

```bash
# Pull the latest image
docker pull ghcr.io/codeiva11/real-browser-mcp:latest

# Run the MCP Server in interactive stdio mode
docker run -i --rm ghcr.io/codeiva11/real-browser-mcp:latest
```

---

## 🚀 Key Automation & Stealth Features

* **Undetectable Patchright Engine**: Built on hardened Patchright Chromium that strips CDP runtime evaluation markers, eliminates `navigator.webdriver`, preserves third-party storage partitioning, and normalizes Client Hints.
* **Worker & Context Consistency**: Guarantees that `navigator.languages`, user agents, and hardware concurrency align 100% between the main page window and background **Web Workers** (passing Rebrowser consistency tests without discrepancy).
* **Native Popup Blocking Emulation**: Mimics authentic Chrome popup blocking by returning `null` on untrusted script-initiated `window.open` calls while preserving real user click navigation.
* **Turnstile & WAF Managed Challenge Assistant**: Automatically detects and assists with Cloudflare Turnstile checkboxes and WAF challenges on authorized pages, tracking dimensions, debouncing clicks, and verifying navigation.
* **Ghost Cursor & Physics Scrolling**: Uses **ghost-cursor-patchright** (Bézier curves) for human-like cursor velocity, overshoot, and hover behaviors, plus 60FPS Cubic Ease-Out smooth scrolling (`page.realScroll`).
* **Integrated Ad & Tracker Blocker**: In-memory prebuilt filter lists via `@ghostery/adblocker-playwright` block advertising scripts, cookie modals, and tracking beacons without disk overhead.
* **Unified Single-Shot Vision (`see_page`)**: Returns a screenshot, parsed page text, interactive element selectors, and iframe inventory in one call. Supports multi-step action sequences (`steps[]`) to execute complex tasks continuously without LLM latency pauses.
* **Long-Running Async Jobs (`async_job`)**: Long operations (batch extraction, multi-step navigation) can run in the background with `async: true` to prevent MCP client 60s watchdog timeouts.
* **AI Healing Selectors**: Automatically detects and attempts alternative selector heuristics if dynamic CSS classes shift.
* **Clean Process & State Isolation**: State guards prevent memory leaks; caches and recordings write strictly to OS temp storage, keeping your repository clean.

---

## 🛠️ AI IDE & Client Configuration Guide

Since this server adheres strictly to the official Model Context Protocol (MCP) over **STDIO** (with all diagnostic logs routed to `stderr`), it connects smoothly to every modern AI IDE:

### 1. Claude Desktop
Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "real-browser": {
      "command": "npx",
      "args": ["-y", "real-browser-mcp-server@latest", "mcp"],
      "env": {
        "HEADLESS": "false",
        "AI_HEALING": "true",
        "TURNSTILE": "true"
      }
    }
  }
}
```

### 2. Cursor IDE
1. Open Cursor Settings ➔ **Features** ➔ **MCP Servers**.
2. Click **+ Add New MCP Server**.
3. Fill in:
   * **Name**: `real-browser`
   * **Type**: `command`
   * **Command**: `npx -y real-browser-mcp-server@latest mcp`
4. Click **Save**.

### 3. Google Antigravity / Windsurf / Cline / Roo Code
Add to your client's MCP configuration file (e.g. `mcp_config.json` or `cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "real-browser": {
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

### 4. Kilo Code (VS Code Extension)
In `~/.config/kilo/kilo.jsonc` (or project `kilo.jsonc`):

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

---

## 🌐 Complete MCP Tool Reference (19 Registered Tools)

The server exposes **19 specialized tools** across 8 functional categories:

### 🌐 1. Browser & Session Management (2 Tools)
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `browser_init` | Initialize or reconfigure a Patchright browser session with ad blocking, AI healing, fingerprint profiles, and WebRTC guards. | `headless`, `proxy`, `enableBlocker`, `aiHealing`, `widgetAssist`, `spoofFingerprint`, `blockWebRTCLeaks` |
| `browser_close` | Gracefully shut down browser session and release active system handles. | `force` |

### 🧭 2. Navigation & Tabs (1 Tool)
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `navigate` | Navigate to URL or manage tabs (`list`, `switch`, `new`, `close`). Supports auto-switch on popups and `waitForChallenge` for Cloudflare interstitial challenges. | `url`, `tabAction`, `tabIndex`, `autoSwitchNewTab`, `waitUntil`, `timeout`, `waitForChallenge`, `challengeTimeout` |

### 👆 3. Natural Human Interaction (6 Tools)
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `click` | Natural click or drag-and-drop (`dragTo`) using Bézier curve movements, hover-first, and iframe support. | `selector`, `annotationId`, `dragTo`, `humanLike`, `hoverFirst`, `iframe`, `autoDetectPlayer` |
| `type` | Natural typing with human-like keystroke intervals, smart clearing, and iframe support. | `selector`, `annotationId`, `text`, `clear`, `pressEnter`, `iframe` |
| `solve_captcha` | Form and embedded verification widget assistant for authorized page testing. | `type`, `captchaSelector`, `formData`, `submit`, `preferTextFallback` |
| `random_scroll` | Natural scrolling with lazy-load trigger detection and physics-based easing. | `direction`, `amount`, `smooth`, `aiDetectLazyLoad`, `iframe`, `iframeSelector` |
| `press_key` | Keyboard key combination press with modifiers (Control, Shift, Alt, Meta). | `key`, `modifiers`, `count` |
| `execute_js` | Execute JavaScript in page context, or execute session-replayed HTTP fetch calls. | `code`, `action`, `url`, `method`, `headers`, `body`, `async`, `iframe` |

### 📄 4. Extraction & Content (3 Tools)
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `get_content` | Retrieve page content formatted as `html`, `text`, `markdown`, `rawHttp`, or structured `elements`. | `format`, `selector`, `xpath`, `saveAs` |
| `extract_data` | Extract structured data using regular expressions, JSON extraction, meta tags, or link discovery. | `type`, `pattern`, `source`, `transformKey` |
| `media_extractor` | Detect, extract, and control video/audio playback streams (HLS, DASH, MP4). | `action`, `types`, `quality`, `playerAction` |

### 📡 5. Network & Traffic Control (2 Tools)
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `redirect_tracer` | Trace complete HTTP 301/302, JavaScript, and meta-refresh redirect chains. | `url`, `maxRedirects`, `decodeURLs` |
| `network_recorder` | Capture and inspect HTTP/WebSocket traffic, export HAR archives, block unwanted asset patterns, and mock API endpoints. | `action`, `patterns`, `mock`, `captureXhrBody` |

### 🧠 6. Deep Analysis & Storage (2 Tools)
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `deep_analysis` | Deep inspection of DOM hierarchy, scripts, technologies, SEO meta, web vitals, and console error logs. | `types`, `detailed`, `detectAccessControls`, `includeWebPerf`, `includeConsole` |
| `storage_inspector` | Inspect and manage cookies, localStorage, sessionStorage, IndexedDB, and encrypted state files. | `action`, `sessionPath`, `passphrase`, `enabled` |

### 👁️ 7. AI Vision & Multi-Step Task Runner (1 Tool)
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `see_page` | **Single-Shot Visual & Task Engine**: Captures full-page/viewport screenshot + page text + element selectors in one call. Execute an entire sequence of actions continuously via `steps[]` (`click`, `type`, `hover`, `scroll`, `wait`, `extract`) without repetitive roundtrips. | `fullPage`, `annotate`, `includePageText`, `scanIframes`, `steps[]`, `captureBefore`, `captureAfter`, `stopOnError` |

### 🛠️ 8. Utilities & Background Processing (2 Tools)
| Tool Name | Description | Key Parameters |
|:---|:---|:---|
| `wait` | Smart wait for selectors, navigation lifecycle events, or fixed duration timers. | `type`, `value`, `timeout` |
| `async_job` | Poll status or cancel background jobs dispatched with `async: true` (budget up to 10 minutes without MCP timeouts). | `action`, `jobId` |

---

## ⚙️ Environment Variables

Configure default behavior globally from your MCP client's `env` block:

| Variable | Values | Default | Description |
|:---|:---|:---|:---|
| `HEADLESS` | `true` / `false` | `false` (desktop) / `true` (CI) | Run browser in headless mode or visible window |
| `AI_HEALING` | `true` / `false` | `true` | Auto-repair broken CSS selectors in `click`/`type` |
| `ENABLE_BLOCKER` | `true` / `false` | `true` | Block ads, tracking trackers, and cookie notices |
| `TURNSTILE` | `true` / `false` | `false` | Auto-assist with Cloudflare Turnstile & WAF challenges |
| `REAL_BROWSER_ALLOW_PRIVATE_NETWORK` | `true` / `false` | `false` | Allow targeting localhost and private intranet IPs (SSRF protection) |
| `REAL_BROWSER_TOOL_TIMEOUT_MS` | milliseconds | `120000` | Hard watchdog budget per tool execution |
| `REAL_BROWSER_JOB_TIMEOUT_MS` | milliseconds | `600000` | Budget for background `async_job` executions (10 minutes) |
| `INSPECT_DELAY_MS` | milliseconds | `0` (smart auto) | Hold delay for visual inspection during test suite runs |
| `REAL_BROWSER_LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` | Logging verbosity on `stderr` |

---

## 🛡️ Anti-Bot Detection Verification Matrix

Real-Browser-MCP is rigorously tested against industry-standard detection test suites:

| Target Detector | Signal Evaluated | Status |
|:---|:---|:---|
| **Rebrowser Bot Detector** | CDP leak, runtime evaluate, worker consistency & popup blocking | 🟢 100% Passed (All Green) |
| **Sannysoft WebDriver** | `navigator.webdriver`, chrome runtime, permissions, plugins | 🟢 100% Passed |
| **Cloudflare WAF** | Managed Challenge & interactive human verification | 🟢 100% Passed (Redirects in 13–22s) |
| **Cloudflare Turnstile** | Embedded Turnstile iframe resolution & token delivery | 🟢 100% Passed |
| **reCAPTCHA v3 Score** | Behavioral score evaluation | 🟢 100% Passed (Score ≥ 0.9) |
| **Pixelscan Fingerprint** | Canvas/WebGL consistency & font coherence | 🟢 100% Passed (No Masking Detected) |
| **Pixelscan Bot Check** | Automation framework detection heuristics | 🟢 100% Passed |

---

## 💻 Programmatic Usage (Node.js SDK)

You can also import and use the real browser engine directly in your JavaScript / TypeScript projects:

### CommonJS (CJS)
```javascript
const { connect } = require('real-browser-mcp-server');

(async () => {
  const { browser, page } = await connect({
    headless: false,
    turnstile: true
  });

  await page.goto('https://example.com');
  await page.realClick('#my-button');
  await page.realScroll(500); // 60FPS physics smooth scroll

  await browser.close();
})();
```

### ECMAScript Modules (ESM)
```javascript
import { connect } from 'real-browser-mcp-server';

const { browser, page } = await connect({
  headless: false,
  turnstile: true
});

await page.goto('https://example.com');
await page.realClick('#my-button');
await browser.close();
```

---

## ⌨️ NPM Script Commands

| Command | Purpose |
|:---|:---|
| `npm start` | Launch the MCP server over standard STDIO transport. |
| `npm run mcp` | Launch the MCP server. |
| `npm run mcp:verbose` | Launch the MCP server with verbose tool catalog output on `stderr`. |
| `npm run list` | Print all 19 registered MCP tools with categories. |
| `npm run build` | Compile TypeScript (`tsc`) and generate CJS & ESM distributions. |
| `npm test` | Run the full test suite across both CJS and ESM (14 tests total). |
| `npm run cjs_test` | Run CommonJS test suite with smart adaptive inspection delay. |
| `npm run esm_test` | Run ESM test suite with smart adaptive inspection delay. |

---

## 🛡️ License

This project is licensed under the **ISC License**. Developed and maintained by [codeiva11](https://github.com/codeiva11).
