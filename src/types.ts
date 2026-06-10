/**
 * Real Browser MCP Server — Master Type Definitions
 *
 * All shared TypeScript types and interfaces used across the project.
 * Import from here instead of defining ad-hoc `any` types.
 */

// ─────────────────────────────────────────────
// Browser & Page Types (from patchright)
// ─────────────────────────────────────────────

/** Re-export Playwright/Patchright core types */
import type { Browser, Page, Frame, BrowserContext, ElementHandle } from 'patchright';
export type { Browser, Page, Frame, BrowserContext, ElementHandle };

/** Blocker from @ghostery/adblocker-playwright */
export interface PlaywrightBlocker {
  enableBlockingInPage(page: Page): Promise<void>;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────
// Browser State
// ─────────────────────────────────────────────

export interface BrowserState {
  browserInstance: Browser | null;
  pageInstance: Page | null;
  blockerInstance: PlaywrightBlocker | null;
  setupPageFn: ((page: Page) => Promise<void>) | null;
  networkRecords: NetworkRecord[];
  isRecordingNetwork: boolean;
  progressTasks: Record<string, ProgressTask>;
  progressCallback: ProgressCallback | null;
}

// ─────────────────────────────────────────────
// Network Types
// ─────────────────────────────────────────────

export interface NetworkRecord {
  type: 'request' | 'response' | 'navigation';
  url: string;
  method?: string;
  status?: number;
  contentType?: string;
  isMedia?: boolean;
  isApiCall?: boolean;
  resourceType?: string;
  headers?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  responseJson?: unknown;
  mediaType?: string;
  timestamp: number;
}

// ─────────────────────────────────────────────
// Progress Tracking
// ─────────────────────────────────────────────

export interface ProgressTask {
  progress: number;
  startTime: number;
  endTime?: number;
}

export type ProgressStatus = 'started' | 'progress' | 'completed' | 'error' | 'warn' | 'in_progress';

export interface ProgressNotification {
  tool: string;
  status: ProgressStatus;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

export type ProgressCallback = (notification: ProgressNotification) => void;

// ─────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────

export type ToolCategory =
  | 'browser'
  | 'navigation'
  | 'interaction'
  | 'extraction'
  | 'network'
  | 'analysis'
  | 'vision'
  | 'utility';

export interface ToolDefinition {
  name: string;
  emoji: string;
  description: string;
  descriptionHindi: string;
  category: ToolCategory;
  requiresBrowser: boolean;
  requiresPage: boolean;
  inputSchema: JSONSchema;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

// ─────────────────────────────────────────────
// Handler Types
// ─────────────────────────────────────────────

export interface HandlerResult {
  success: boolean;
  error?: string;
  mcpContent?: MCPContent[];
  [key: string]: unknown;
}

export interface MCPContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

export type HandlerFunction = (params: Record<string, unknown>) => Promise<HandlerResult>;

export type HandlerMap = Record<string, HandlerFunction>;

// ─────────────────────────────────────────────
// Handler Parameter Types
// ─────────────────────────────────────────────

export interface BrowserInitParams {
  headless?: boolean;
  proxy?: ProxyConfig;
  turnstile?: boolean;
  enableBlocker?: boolean;
  aiHealing?: boolean;
}

export interface ProxyConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface NavigateParams {
  url: string;
  waitUntil?: WaitUntilState;
  timeout?: number;
  retries?: number;
  smartWait?: boolean;
}

export type WaitUntilState = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export interface WaitParams {
  type?: 'selector' | 'navigation' | 'networkidle' | 'timeout';
  value?: string;
  timeout?: number;
}

export interface ClickParams {
  selector: string;
  humanLike?: boolean;
  clickCount?: number;
  delay?: number;
  autoAcceptDialogs?: boolean;
  retries?: number;
  timeout?: number;
  hoverFirst?: boolean;
  hoverOnly?: boolean;
  hoverDuration?: number;
  iframe?: number;
  iframeSelector?: string;
  scrollIntoView?: boolean;
  forceClick?: boolean;
  autoDetectPlayer?: boolean;
  usePlayerAPI?: boolean;
  waitForPlay?: boolean;
  playerTimeout?: number;
}

export interface TypeParams {
  selector: string;
  text: string;
  delay?: number;
  clear?: boolean;
  iframe?: number;
  iframeSelector?: string;
  pressEnter?: boolean;
  waitForSelector?: boolean;
}

export interface ScrollParams {
  direction?: 'up' | 'down' | 'random';
  amount?: number;
  smooth?: boolean;
}

export interface FindElementParams {
  selector?: string;
  xpath?: string;
  text?: string;
  multiple?: boolean;
}

export interface PressKeyParams {
  key: string;
  modifiers?: string[];
  count?: number;
}

export interface ExecuteJsParams {
  code: string;
  returnValue?: boolean;
  iframe?: number;
  iframeSelector?: string;
  waitForIframe?: boolean;
  timeout?: number;
}

export interface ExtractDataParams {
  type?: 'auto' | 'regex' | 'json' | 'meta' | 'structured' | 'deobfuscate';
  pattern?: string;
  selector?: string;
  jsonPath?: string;
  source?: string;
  autoDecode?: boolean;
  flags?: string;
  types?: string[];
  includeTitle?: boolean;
  includeCanonical?: boolean;
  maxMatches?: number;
  maxJsonObjects?: number;
  waitForSelector?: boolean;
  selectorTimeout?: number;
}

export interface NetworkRecorderParams {
  action?: 'start' | 'stop' | 'get' | 'clear' | 'get_media' | 'get_navigations' | 'get_api_calls' | 'get_intercepted_apis' | 'get_websockets';
  filter?: NetworkFilter;
  captureResponses?: boolean;
}

export interface NetworkFilter {
  resourceType?: string;
  urlPattern?: string;
  type?: string;
  mediaOnly?: boolean;
}

export interface CookieManagerParams {
  action?: 'get' | 'set' | 'delete' | 'clear';
  name?: string;
  value?: string;
  domain?: string;
  expires?: number;
}

export interface RedirectTracerParams {
  url: string;
  maxRedirects?: number;
  includeHeaders?: boolean;
  followJS?: boolean;
  timeout?: number;
}

export interface MediaExtractorParams {
  action?: 'extract' | 'list_iframes' | 'switch_iframe' | 'player_control' | 'decode_url' | 'batch_extract';
  types?: string[];
  quality?: string;
  searchIframes?: boolean;
  deep?: boolean;
  selector?: string;
  index?: number;
  playerAction?: string;
  encodedData?: string;
  decoderType?: string;
  aesKey?: string;
  aesIV?: string;
  urls?: string[];
  aiOptimize?: boolean;
  seekTime?: number;
  playerType?: string;
  volume?: number;
}

export interface StreamExtractorParams {
  types?: string[];
  quality?: string;
  searchIframes?: boolean;
  deep?: boolean;
}

export interface FormAutomatorParams {
  selector?: string;
  data?: Record<string, unknown>;
  submit?: boolean;
  humanLike?: boolean;
  captcha?: boolean;
  aiMatch?: boolean;
}

export interface DeepAnalysisParams {
  types?: string[];
  detailed?: boolean;
}

export interface FileDownloaderParams {
  url: string;
  filename?: string;
  directory?: string;
}

export interface IframeHandlerParams {
  action?: 'list' | 'switch' | 'content' | 'exit';
  selector?: string;
  index?: number;
}

export interface PlayerApiHookParams {
  playerType?: string;
  action?: string;
  searchIframes?: boolean;
}

export interface ProgressTrackerParams {
  action?: 'start' | 'update' | 'complete' | 'get';
  taskName?: string;
  progress?: number;
}

export interface SearchRegexParams {
  pattern: string;
  flags?: string;
  source?: string;
}

// ─────────────────────────────────────────────
// Decoder Types
// ─────────────────────────────────────────────

export interface DecodeResult {
  success: boolean;
  decoded?: string;
  error?: string;
  original: string;
  iterations?: number;
  approaches?: Array<{ method: string; decoded: string }>;
}

export interface AESDecryptResult {
  success: boolean;
  decrypted?: string;
  error?: string;
  algorithm: string;
}

// ─────────────────────────────────────────────
// Stream / Media Types
// ─────────────────────────────────────────────

export interface StreamSource {
  src: string;
  type: string;
  label?: string;
  source?: string;
}

export interface StreamCollection {
  video: StreamSource[];
  audio: StreamSource[];
  hls: StreamSource[];
  dash: StreamSource[];
  download: StreamSource[];
  embedded: StreamSource[];
}

// ─────────────────────────────────────────────
// Vision / Captcha Types
// ─────────────────────────────────────────────

export interface SolveCaptchaParams {
  captchaSelector?: string;
  inputSelector?: string;
  formSelector?: string;
  submitAfterSolve?: boolean;
  autoRetry?: boolean;
  maxRetries?: number;
  langHint?: string;
  expectedLength?: number;
  allowedChars?: string;
  formData?: Record<string, unknown>;
}

export interface SeePageParams {
  action?: 'screenshot' | 'analyze' | 'forms' | 'full';
  selector?: string;
  fullPage?: boolean;
  quality?: number;
}

// ─────────────────────────────────────────────
// AI Core Types
// ─────────────────────────────────────────────

export interface AICoreConfig {
  defaultConfidence: number;
  maxCacheAge: number;
  enableAutoHeal: boolean;
  enableSmartFind: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  cacheFile: string;
}

export interface SmartFindResult {
  found: boolean;
  selector: string;
  confidence: number;
  method: string;
  element?: ElementHandle;
  alternatives?: Array<{ selector: string; confidence: number }>;
}

export interface HealResult {
  healed: boolean;
  oldSelector: string;
  newSelector: string;
  confidence: number;
}

// ─────────────────────────────────────────────
// Connect/Library Types
// ─────────────────────────────────────────────

export interface ConnectOptions {
  args?: string[];
  headless?: boolean;
  proxy?: ProxyConfig;
  turnstile?: boolean;
  executablePath?: string;
  enableBlocker?: boolean;
}

export interface ConnectResult {
  browser: Browser;
  page: Page;
  blocker: PlaywrightBlocker | null;
  setupPage: ((page: Page) => Promise<void>) | null;
}
