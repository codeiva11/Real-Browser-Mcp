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
  currentSessionName?: string;
  activeAnnotations?: Record<number, { selector: string; text?: string; type?: string }>;
  networkRecords: NetworkRecord[];
  isRecordingNetwork: boolean;
  networkRecorderBoundPage?: Page | null;
  networkRecorderListeners?: Record<string, unknown> | null;
  progressTasks: Record<string, ProgressTask>;
  progressCallback: ProgressCallback | null;
  aiHealingEnabled: boolean;
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
  contextOptions?: Record<string, unknown>;
  turnstile?: boolean;
  enableBlocker?: boolean;
  aiHealing?: boolean;
  recordVideo?: boolean;
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
  selector?: string;
  annotationId?: number;
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
  aiHeal?: boolean;
  autoDetectPlayer?: boolean;
  usePlayerAPI?: boolean;
  waitForPlay?: boolean;
  playerTimeout?: number;
}

export interface TypeParams {
  selector?: string;
  annotationId?: number;
  text: string;
  delay?: number;
  clear?: boolean;
  iframe?: number;
  iframeSelector?: string;
  pressEnter?: boolean;
  waitForSelector?: boolean;
  aiHeal?: boolean;
}

export interface ScrollParams {
  direction?: 'up' | 'down' | 'random' | 'smart';
  amount?: number;
  smooth?: boolean;
  aiDetectLazyLoad?: boolean;
}


export interface PressKeyParams {
  key: string;
  modifiers?: string[];
  count?: number;
}

export interface ExecuteJsParams {
  code: string;
  returnValue?: boolean;
  async?: boolean;
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
  action?: 'start' | 'stop' | 'get' | 'clear' | 'get_media' | 'get_navigations' | 'get_api_calls' | 'get_intercepted_apis' | 'get_websockets' | 'get_graphql' | 'export_har';
  filter?: NetworkFilter;
  captureXhrBody?: boolean;
}

export interface NetworkFilter {
  resourceType?: string;
  urlPattern?: string;
  type?: string;
  mediaOnly?: boolean;
}


export interface RedirectTracerParams {
  url: string;
  maxRedirects?: number;
  includeHeaders?: boolean;
  followJS?: boolean;
  followMeta?: boolean;
  decodeURLs?: boolean;
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

export interface DeepAnalysisParams {
  types?: string[];
  detailed?: boolean;
  aiInsights?: boolean;
  detectAntiBot?: boolean;
}

export interface ProgressTrackerParams {
  action?: 'start' | 'update' | 'complete' | 'get' | 'clear';
  taskName?: string;
  progress?: number;
  aiEstimate?: boolean;
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
// Vision / Captcha Types
// ─────────────────────────────────────────────

export interface SolveCaptchaParams {
  type?: 'turnstile' | 'text' | 'image' | 'auto';
  timeout?: number;
  captchaSelector?: string;
  inputSelector?: string;
  formSelector?: string;
  submit?: boolean;
  autoRetry?: boolean;
  maxRetries?: number;
  lang?: string;
  expectedLength?: number;
  allowedChars?: string;
  formData?: Record<string, unknown>;
  refreshSelector?: string;
  iframe?: number;
  iframeSelector?: string;
  analyzeFirst?: boolean;
  humanLike?: boolean;
  aiMatch?: boolean;
  preferTextFallback?: boolean;
}

export interface SeePageParams {
  annotate?: boolean;
  fullPage?: boolean;
  format?: 'png' | 'jpeg';
  quality?: number;
  includeElements?: boolean;
  includeDomText?: boolean;
  includePageText?: boolean;
  scanIframes?: boolean;
  maxElements?: number;
  path?: string;
  autoHover?: boolean;
  watchMutations?: boolean;
}
