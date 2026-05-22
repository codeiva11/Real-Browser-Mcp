# 🦁 Real Browser MCP Server

[![npm version](https://img.shields.io/npm/v/real-browser-mcp-server.svg)](https://www.npmjs.com/package/real-browser-mcp-server)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Build & Test](https://github.com/codeiva4u/Brave-Real-Browser-Mcp-Server/actions/workflows/publish.yml/badge.svg)](https://github.com/codeiva4u/Brave-Real-Browser-Mcp-Server/actions/workflows/publish.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A production-ready **Model Context Protocol (MCP)** server that equips AI agents with a fully undetected, high-stealth web browser. Built on **Patchright** (the advanced undetected Playwright fork) and integrated with **Ghostery Adblocker**, **Ghost Cursor** (human-like mouse dynamics), and an automatic **Cloudflare Turnstile bypass**.

This server is **100% compatible with all major AI IDEs** (Cursor, VS Code, Cline, Roo Code, Windsurf, PearAI, OpenCode, and Claude Desktop) using standard **STDIO** communication.

---

## ⚙️ Installation & Setup

To install and run the server locally, clone the repository, install NPM dependencies, and configure the undetected browser binary using **Patchright**:

```bash
# 1. Clone the repository
git clone https://github.com/codeiva4u/Real-Browser-Mcp-Server.git

# 2. Navigate to the project directory
cd Real-Browser-Mcp-Server

# 3. Install dependencies
npm install

# 4. Install Chromium-Driver for Patchright (Undetected Browser binary)
npx patchright install chromium
```

---

## 🚀 Key Evasion & Stealth Features

* **Undetected Browser Engine**: Powered by **Patchright Chromium**, bypassing modern fingerprinting checks (does not expose automation indicators or Webdriver/BiDi flags).
* **Integrated Ad & Tracker Blocker**: Utilizes `@ghostery/adblocker-playwright` with asynchronous pre-compiled filter caching to `adblocker.bin`, blocking ads and speed-bumps completely offline.
* **Human-like Interactions**: Integrates **ghost-cursor-patchright** (Bézier curves) to transparently simulate human mouse movements, velocity, and natural hover-before-click behaviors.
* **Turnstile Auto-Solver**: Seamlessly detects and bypasses Cloudflare Turnstile widgets.
* **Anti-Race Condition Guards**: Robust state-guards ensure popup blockers, shims, and adblockers attach exactly once per page, preventing context destruction.

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
        "c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/src/index.js"
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
   * **Command**: `node c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/src/index.js`
4. Click **Save**.

### 3. Cline / Roo Code (VS Code)
Add the server entry to your global MCP settings file (typically found at `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "command": "node",
      "args": [
        "c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/src/index.js"
      ],
      "env": {
        "HEADLESS": "false"
      },
      "disabled": false
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
        "c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/src/index.js"
      ],
      "env": {
        "HEADLESS": "false"
      }
    }
  }
}
```

### 5. PearAI
Add the configurations via **PearAI Settings** ➔ **MCP Servers** using the standard `command` configuration pointing to `node` and the path to `src/index.js`.

### 6. OpenCode AI IDE
Configure the server in your `opencode.jsonc` or standard MCP settings configuration:

```jsonc
{
  "mcpServers": {
    "real-browser-mcp-server": {
      "command": "node",
      "args": [
        "c:/Users/Admin/Desktop/Software/Real-Browser-Mcp-Server/src/index.js"
      ],
      "env": {
        "HEADLESS": "false"
      }
    }
  }
}
```

---

## 🌐 Complete MCP Tool Reference (22 Tools)

The server exposes 22 highly optimized tools categorized into functional units:

### 🌐 Browser & Session
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `browser_init` | Initialize Brave/Patchright browser with stealth, ad blocker, and turnstile bypass. | `headless` (boolean), `proxy` (object) |
| `browser_close` | Close browser with cleanup and session saving. | None |
| `cookie_manager` | Smart cookie management (get, set, delete, import, export). | `action` (string), `cookies` (array) |

### 🧭 Navigation
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `navigate` | Navigate to URL with smart retry and configurable wait strategy. | `url` (string), `waitStrategy` (string) |

### 👆 Human-like Interaction
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `click` | Human-like click using AI healing, ghost cursor, and iframe support. | `selector` (string), `hoverFirst` (boolean) |
| `type` | Type text with human speed variation, smart clearing, and iframe support. | `selector` (string), `text` (string) |
| `solve_captcha` | Auto-solve CAPTCHAs (Turnstile, reCAPTCHA, hCaptcha, OCR). | `selector` (string) |
| `random_scroll` | Simulated human scrolling with natural patterns and lazy-load triggers. | `direction` (string), `amount` (number) |
| `press_key` | Press keyboard keys with modifier key support (Ctrl/Shift/Alt). | `key` (string), `modifiers` (array) |
| `execute_js` | Run custom asynchronous/synchronous JavaScript inside a page or iframe. | `code` (string), `iframeIndex` (number) |

### 📄 Extraction & Obfuscation Decoding
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `get_content` | Retrieve page content in `html`, `text`, `markdown`, or direct `rawHttp` modes. | `format` (string) |
| `find_element` | Locate elements via CSS selectors, XPath, or exact text with selector healing. | `selector` (string), `strategy` (string) |
| `save_content_as_markdown` | Export current page content as clean, readable Markdown, stripping ads. | `filename` (string) |
| `extract_data` | Advanced 8-mode extractor (Regex, JSON, Meta tags, JS Deobfuscator, Cryptography). | `mode` (string), `target` (string) |
| `link_harvester` | Scrapes all visible, hidden, iframe-nested, or encoded links on a page. | None |
| `media_extractor` | Capture and control HLS, DASH, JWPlayer, Plyr, or dynamic streaming content. | `action` (string), `targetUrl` (string) |

### 📡 Network & Utilities
| Tool Name | Description | Parameters |
|:---|:---|:---|
| `redirect_tracer` | Trace complete redirect chains (HTTP 301/302, JS location, meta refresh). | `url` (string) |
| `network_recorder` | Capture network requests, XHR request/response bodies, or WebSockets. | `action` (string), `captureXhrBody` (boolean) |
| `file_downloader` | Secure file downloader supporting resumes, batches, and URL decoding. | `url` (string), `outputPath` (string) |
| `deep_analysis` | Detailed analysis of DOM structure, scripts, anti-bots, and stack. | None |
| `wait` | Smart delay with AI prediction or static timeout. | `duration` (number) |
| `progress_tracker` | Track running automation progress with AI-estimated remaining times. | `step` (string), `percentage` (number) |

---

## 📈 Evasion Performance & Test Coverage

Our test suites run headless/headed simulations against all major fingerprinting and bot checking platforms with a **100% Pass Rate**:

| Target Test Platform | Detection Type | Status |
|:---|:---|:---|
| **DrissionPage Detector** | Bot / Automation framework detection | ✅ Pass |
| **Sannysoft WebDriver** | WebDriver/navigator properties check | ✅ Pass |
| **Cloudflare WAF** | Web Application Firewall challenge | ✅ Pass |
| **Cloudflare Turnstile** | Advanced CAPTCHA widget solver | ✅ Pass |
| **FingerprintJS Bot Detector** | Fingerprint-based bot detection | ✅ Pass |
| **Datadome Bot Detector** | Dynamic behavioral detection | ✅ Pass |
| **reCAPTCHA v3 Score** | Google Trust Score test (Passed with > 0.9) | ✅ Pass |
| **CreepJS Fingerprinting** | Advanced trust rating and fingerprint check | ✅ Pass |
| **Pixelscan Fingerprint** | Masque & Canvas fingerprint masking check | ✅ Pass (No Masking Detected) |

### 🧪 Local Test Suite Execution Status

Both the CommonJS and ES Module test suites execute and pass successfully under Node.js:

| Test Suite / Environment | Test Case | Status |
|:---|:---|:---|
| **CommonJS (`cjs_test`)** | DrissionPage Detector | ✅ Passed |
| **CommonJS (`cjs_test`)** | Sannysoft WebDriver Detector | ✅ Passed |
| **CommonJS (`cjs_test`)** | Cloudflare WAF | ✅ Passed |
| **CommonJS (`cjs_test`)** | Cloudflare Turnstile | ✅ Passed |
| **CommonJS (`cjs_test`)** | Fingerprint JS Bot Detector | ✅ Passed |
| **CommonJS (`cjs_test`)** | Recaptcha V3 Score | ✅ Passed |
| **CommonJS (`cjs_test`)** | Pixelscan Fingerprint Check | ✅ Passed |
| **ES Module (`esm_test`)** | DrissionPage Detector | ✅ Passed |
| **ES Module (`esm_test`)** | Sannysoft WebDriver Detector | ✅ Passed |
| **ES Module (`esm_test`)** | Cloudflare WAF | ✅ Passed |
| **ES Module (`esm_test`)** | Cloudflare Turnstile | ✅ Passed |
| **ES Module (`esm_test`)** | Fingerprint JS Bot Detector | ✅ Passed |
| **ES Module (`esm_test`)** | Recaptcha V3 Score | ✅ Passed |
| **ES Module (`esm_test`)** | Pixelscan Fingerprint Check | ✅ Passed |

---

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
| `npm run list` | Clean list of all 22 tools with emojis and categories. |
| `npm run build` | Validate workspace structure and confirm library status. |
| `npm test` | Execute the full test suite (CJS & ESM). |
| `npm run cjs_test` | Run CommonJS test scripts. |
| `npm run esm_test` | Run ECMAScript Module test scripts. |

---

## 🛡️ License

This project is licensed under the **ISC License**. Created and maintained with ❤️ by [codeiva4u](https://github.com/codeiva4u).
