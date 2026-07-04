# 🦁 Real Browser MCP Server

[![npm version](https://img.shields.io/npm/v/real-browser-mcp-server.svg)](https://www.npmjs.com/package/real-browser-mcp-server)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Build & Test](https://github.com/codeiva4u/Brave-Real-Browser-Mcp-Server/actions/workflows/publish.yml/badge.svg)](https://github.com/codeiva4u/Brave-Real-Browser-Mcp-Server/actions/workflows/publish.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A production-ready **Model Context Protocol (MCP)** server that equips AI agents with a fully undetected, high-stealth web browser. Built on **Patchright** (the advanced undetected Playwright fork) and integrated with **Ghostery Adblocker**, **Ghost Cursor** (human-like mouse dynamics), and an automatic **Cloudflare Turnstile bypass**.

This server is **100% compatible with all major AI IDEs** (Cursor, VS Code, Cline, Roo Code, Windsurf, PearAI, OpenCode, and Claude Desktop) using standard **STDIO** communication.

---

## ⚙️ Installation & Setup
Since this project is published on NPM, the easiest way to use it is via `npx` (which handles downloading and executing automatically).

### ⚡ Quick Start (Using npx)

Add the following to your MCP Configuration file (e.g. `cline_mcp_settings.json` or `claude_desktop_config.json`):

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

### 🌍 Global Installation

You can also install it globally on your system:

```bash
npm install -g real-browser-mcp-server

# Run the MCP server
real-browser-mcp mcp
```

### 🛠️ Local Development & Build (Git Clone)

If you want to clone the repository and run it locally, follow these exact steps:

```bash
# 1. Clone the repository
git clone https://github.com/codeiva4u/Real-Browser-Mcp-Server.git

# 2. Navigate to the project directory
cd Real-Browser-Mcp-Server

# 3. Install dependencies
npm install

# 4. IMPORTANT: Install Chromium-Driver for Patchright (Undetected Browser binary)
npx patchright install chromium

# 5. Build the TypeScript files
npm run build

# 6. Start the MCP server
npm run mcp
```

> [!NOTE]
> *Why does `npm run build` not build the entire project alone?* 
> `npm run build` only compiles the TypeScript code into JavaScript (`dist/`). However, the undetected browser engine (`patchright`) requires you to explicitly download its browser binaries using `npx patchright install chromium`. Without this step, the server will crash trying to find Chromium.

### 🐳 Run via Docker (Recommended for Servers)

We automatically build and publish a production-ready Docker image to GitHub Container Registry (GHCR).

```bash
# Pull the latest image
docker pull ghcr.io/codeiva4u/real-browser-mcp-server:latest

# Run the MCP Server (Interactive stdio mode for AI IDEs)
docker run -i --rm ghcr.io/codeiva4u/real-browser-mcp-server:latest
```

*(Note: When running via Docker, it automatically runs in headless mode.)*

---

## 🚀 Key Evasion & Stealth Features

* **Undetected Browser Engine**: Powered by **Patchright Chromium**, bypassing modern fingerprinting checks (does not expose automation indicators or Webdriver/BiDi flags).
* **Integrated Ad & Tracker Blocker**: Utilizes `@ghostery/adblocker-playwright` with asynchronous pre-compiled filter caching to `adblocker.bin`, blocking ads and speed-bumps completely offline.
* **Human-like Interactions**: Integrates **ghost-cursor-patchright** (Bézier curves) to transparently simulate human mouse movements, velocity, and natural hover-before-click behaviors. Features **Physics-based Smooth Scrolling** (`page.realScroll`) utilizing real mouse-wheel events and Cubic Ease-Out deceleration to perfectly mimic manual trackpad/mouse flicks, bypassing advanced behavioral detectors.
* **Turnstile Auto-Solver**: Seamlessly detects and bypasses Cloudflare Turnstile widgets.
* **Anti-Race Condition Guards**: Robust state-guards ensure popup blockers, shims, and adblockers attach exactly once per page, preventing context destruction.
* **TypeScript**: Entire codebase is written in TypeScript for type safety and maintainability.


---

## 🛠️ AI IDE Compatibility & Configuration Guide

Since this server adheres strictly to the official Model Context Protocol (MCP) specification over **STDIO** (with all informational logging directed safely to `stderr` to avoid JSON-RPC corruption), it is fully compatible with every modern AI editor.

### 1. Claude Desktop
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "command": "node",
      "args": [
        "c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/dist/src/index.js"
      ],
      "env": {
        "HEADLESS": "false"
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
   * **Command**: `node c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/dist/src/index.js`
4. Click **Save**.

### 3. Cline / Roo Code (VS Code)
Add the server entry to your global MCP settings file (typically found at `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "type": "stdio",
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/dist/src/index.js"
      ],
      "env": {
        "HEADLESS": "false"
      },
      "disabled": false,
      "autoApprove": [],
      "timeout": 120
    }
  }
}
```

### 4. Windsurf IDE
Configure the server in your `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "command": "node",
      "args": [
        "c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/dist/src/index.js"
      ],
      "env": {
        "HEADLESS": "false"
      }
    }
  }
}
```

### 5. PearAI
Add the configuration via **PearAI Settings** ➔ **MCP Servers** using the standard `command` setup pointing to `node` and the built entrypoint at `dist/src/index.js`.

### 6. OpenCode AI IDE
Configure the server in your `opencode.jsonc` or standard MCP settings configuration:

```jsonc
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "command": "node",
      "args": [
        "c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/dist/src/index.js"
      ],
      "env": {
        "HEADLESS": "false"
      }
    }
  }
}
```

---

## 🌐 Complete MCP Tool Reference (21 Tools)

The server exposes 21 tools categorized into functional units:

### 🌐 Browser & Session
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `browser_init` | Initialize Brave/Patchright browser with stealth, ad blocker, and turnstile bypass. | `headless` (boolean), `proxy` (object) |
| `browser_close` | Close browser with cleanup and session saving. | `force` (boolean), `saveSession` (boolean) |

### 🧭 Navigation
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `navigate` | Navigate to URL with smart retry and configurable wait strategy. | `url` (string), `waitUntil` (string), `timeout` (number), `retries` (number) |

### 👆 Human-like Interaction
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `click` | Human-like click using ghost cursor and iframe support. | `selector` (string), `hoverFirst` (boolean) |
| `type` | Type text with human speed variation, smart clearing, and iframe support. | `selector` (string), `text` (string) |
| `solve_captcha` | Solves Turnstile directly and returns OCR/vision guidance for image CAPTCHAs. reCAPTCHA/hCaptcha are detected honestly but not solved automatically. | `type` (string), `captchaSelector` (string) |
| `random_scroll` | Simulated human scrolling with natural patterns and lazy-load triggers. | `direction` (string), `amount` (number), `smooth` (boolean) |
| `press_key` | Press keyboard keys with modifier key support (Ctrl/Shift/Alt). | `key` (string), `modifiers` (array) |
| `execute_js` | Run custom asynchronous/synchronous JavaScript inside a page or iframe. | `code` (string), `iframeIndex` (number) |

### 📄 Extraction & Obfuscation Decoding
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `get_content` | Retrieve page content in `html`, `text`, `markdown`, or direct `rawHttp` modes. | `format` (string) |
| `extract_data` | Advanced extractor for regex, JSON, metadata, structured data, deobfuscation, API discovery, and decrypt flows. | `type` (string), `source` (string) |
| `media_extractor` | Capture and control HLS, DASH, JWPlayer, Plyr, or dynamic streaming content. | `action` (string), `types` (array), `quality` (string) |

### 📡 Network & Utilities
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `redirect_tracer` | Trace complete redirect chains (HTTP 301/302, JS location, meta refresh). | `url` (string) |
| `network_recorder` | Capture requests, responses, intercepted APIs, GraphQL payloads, WebSockets, and media URLs. | `action` (string), `captureXhrBody` (boolean) |
| `deep_analysis` | Detailed analysis of DOM structure, scripts, anti-bots, stack, and page signals. | `types` (array) |
| `wait` | Smart delay for selectors, navigation, or fixed timeout. | `type` (string), `value` (string) |
| `progress_tracker` | Track running automation progress with AI-estimated remaining times. | `taskName` (string), `progress` (number) |
| `storage_inspector` | Inspect IndexedDB and Service Workers natively via JS. | None |
| `replay_request` | Replay a captured API request directly in the browser context (bypasses CORS). | `url` (string), `method` (string) |
| `api_analyzer` | Generate schemas, diff JSONs, and create SDK boilerplates (Python/TypeScript). | `action` (string), `data` (string) |

### 👁️ AI Vision (Eyes)
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `see_page` | Lets the AI **visually SEE** the page like human eyes: returns a screenshot image plus a text JSON summary and a visual map of visible interactive elements. | `fullPage` (boolean), `format` (png/jpeg) |

If the current model cannot consume images, `see_page` still returns a text summary, and `solve_captcha` can return text-only fallback guidance when called with `preferTextFallback: true`.

---

## 📈 Evasion Performance & Test Coverage

Our test suites cover several real-world bot and fingerprinting pages, plus a fast MCP smoke test. Results still depend on IP reputation, third-party site changes, and network conditions.

| Target Test Platform | Detection Type | Status |
|:---|:---|:---|
| **Sannysoft WebDriver** | WebDriver/navigator properties check | ✅ Pass |
| **Cloudflare WAF** | Web Application Firewall challenge | ✅ Pass |
| **Cloudflare Turnstile** | Advanced CAPTCHA widget solver | ✅ Pass |
| **FingerprintJS Bot Detector** | Fingerprint-based bot detection | ✅ Pass |
| **reCAPTCHA v3 Score** | Google Trust Score test (target: not obviously bot-like) | ✅ Environment-dependent |
| **Pixelscan Fingerprint** | Masque & Canvas fingerprint masking check | ✅ Pass (No Masking Detected) |

### 🧪 Local Test Suite Execution Status

Both the CommonJS and ES Module test suites execute and pass successfully under Node.js:

| Test Suite / Environment | Test Case | Status |
|:---|:---|:---|
| **CommonJS (`cjs_test`)** | Sannysoft WebDriver Detector | ✅ Passed |
| **CommonJS (`cjs_test`)** | Cloudflare WAF | ✅ Passed |
| **CommonJS (`cjs_test`)** | Cloudflare Turnstile | ✅ Passed |
| **CommonJS (`cjs_test`)** | Fingerprint JS Bot Detector | ✅ Passed |
| **CommonJS (`cjs_test`)** | Recaptcha V3 Score | ✅ Passed |
| **CommonJS (`cjs_test`)** | Pixelscan Fingerprint Check | ✅ Passed |
| **ES Module (`esm_test`)** | Sannysoft WebDriver Detector | ✅ Passed |
| **ES Module (`esm_test`)** | Cloudflare WAF | ✅ Passed |
| **ES Module (`esm_test`)** | Cloudflare Turnstile | ✅ Passed |
| **ES Module (`esm_test`)** | Fingerprint JS Bot Detector | ✅ Passed |
| **ES Module (`esm_test`)** | Recaptcha V3 Score | ✅ Passed |
| **ES Module (`esm_test`)** | Pixelscan Fingerprint Check | ✅ Passed |
| **MCP Smoke (`mcp_test`)** | Tool Registry Check | ✅ Passed |
| **MCP Smoke (`mcp_test`)** | JSON-RPC Initialize Handshake | ✅ Passed |

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
  
  // Real mouse movement and click
  await page.realClick('#my-button');
  
  // Real human-like smooth scrolling (60FPS Cubic Ease-Out physics)
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

// Real human-like smooth scrolling (60FPS Cubic Ease-Out physics)
await page.realScroll(400); // scrolls down 400px smoothly

await browser.close();
```

---

## ⌨️ NPM Script Commands

Run these scripts from the project root directory:

| Command | Description |
|:---|:---|
| `npm start` | Start the MCP server using standard STDIO transport. |
| `npm run dev` | Alias to start the MCP server. |
| `npm run mcp` | Start the MCP server. |
| `npm run mcp:verbose` | Start the MCP server with verbose logging on `stderr`. |
| `npm run list` | List all registered MCP tools with categories. |
| `npm run build` | Compile TypeScript into the `dist/` folder. |
| `npm test` | Execute the full test suite (CJS & ESM). |
| `npm run cjs_test` | Run CommonJS test scripts. |
| `npm run esm_test` | Run ECMAScript Module test scripts. |
| `npm run mcp_test` | Fast, network-independent MCP smoke test (handshake + tool registry validation). |

---

## 🏗️ Architecture Notes

### Design

- **MCP-first**: every tool is defined in `src/shared/tools.ts` and dispatched through a single `executeTool()` router.
- **Handler modules**: `src/mcp/handlers/` contains focused helper files (`network-recorder.ts`, `network-extractors.ts`, `vision-captcha.ts`, `vision-see-page.ts`) with thin wrapper files (`network.ts`, `vision.ts`) for the tool-facing API.
- **Browser state**: a single global `state` object in `src/mcp/handlers/state.ts` holds the current browser/page instance and network recorder data. `createSessionContext()` provides a typed accessor pattern for handlers.
- **Persistent activity log**: `src/shared/activity-logger.ts` survives server restarts via a JSON file on disk.

### Known Limitations

- **Single-session model**: the MCP server manages one browser instance at a time. Concurrent multi-session isolation is not supported.
- **reCAPTCHA / hCaptcha**: detected honestly but not solved automatically. Use a third-party service for these.
- **Vision tools require image-capable models**: `see_page` and `solve_captcha` return images. Non-vision models get a text JSON summary fallback, but image reading itself requires a multimodal client.
- **TypeScript strict mode**: the project compiles with `strict: true`, though some legacy bridge files still use `@ts-nocheck`.

---

## 🛡️ License

This project is licensed under the **MIT License**. Created and maintained by [codeiva4u](https://github.com/codeiva4u).
