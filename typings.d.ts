declare module "brave-real-browser-mcp-server" {
	import type { Browser, Page } from "brave-real-puppeteer-core";
	import type { GhostCursor } from "ghost-cursor";

	export function connect(options?: Options): Promise<ConnectResult>;

	interface PageWithCursor extends Page {
		realClick: GhostCursor["click"];
		realCursor: GhostCursor;
	}

	type ConnectResult = {
		browser: Browser;
		page: PageWithCursor;
		/** Blocker instance for advanced usage (null if enableBlocker is false) */
		blocker: BraveBlocker | null;
	};

	interface Options {
		args?: string[];
		headless?: boolean;
		customConfig?: import("brave-real-launcher").Options;
		proxy?: ProxyOptions;
		turnstile?: boolean;
		connectOption?: import("brave-real-puppeteer-core").ConnectOptions;
		disableXvfb?: boolean;
		plugins?: import("puppeteer-extra").PuppeteerExtraPlugin[];
		ignoreAllFlags?: boolean;
		/** Enable blocker on all pages (default: true) */
		enableBlocker?: boolean;
		/** Blocker configuration options */
		blockerOptions?: BlockerOptions;
	}

	interface ProxyOptions {
		host: string;
		port: number;
		username?: string;
		password?: string;
	}

	interface BlockerOptions {
		/** Enable standard network request blocking (Ads/Trackers) - default: true */
		enableAdBlocking?: boolean;
		/** Enable stealth evasions (Navigator, WebGL, etc.) - default: true */
		enableStealth?: boolean;
		/** Enable cosmetic filtering (Element hiding) - default: true */
		enableCosmeticFiltering?: boolean;
		/** Enable advanced redirect and popup blocking - default: true */
		enableRedirectBlocking?: boolean;
		/** Enable scriptlet injection for anti-adblock evasion - default: true */
		enableScriptlets?: boolean;
		/** Path to custom filter list file */
		customFiltersPath?: string;
		/** Enable auto-update of uBlock Origin filters - default: true */
		enableFilterAutoUpdate?: boolean;
		/** Filter updater options */
		filterUpdaterOptions?: FilterUpdaterOptions;
	}

	interface FilterUpdaterOptions {
		/** Cache duration in milliseconds - default: 24 hours */
		cacheDuration?: number;
		/** Custom filters path */
		customFiltersPath?: string;
		/** Enable verbose logging */
		verbose?: boolean;
	}

	/** BraveBlocker class for advanced ad/tracker blocking */
	interface BraveBlocker {
		/** Initialize the blocker engine */
		init(): Promise<void>;
		/** Enable blocking on a page */
		enable(page: Page): Promise<void>;
		/** Check if a URL should be blocked */
		shouldBlock(url: string): boolean;
	}
}
