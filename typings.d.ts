declare module "real-browser-mcp-server" {
	import type { Browser, Page } from "patchright";
	import type { GhostCursor } from "ghost-cursor-patchright";

	export function connect(options?: Options): Promise<ConnectResult>;

	interface PageWithCursor extends Page {
		realClick: GhostCursor["click"];
		realCursor: GhostCursor;
		realScroll: (deltaY: number, duration?: number) => Promise<void>;
	}

	type ConnectResult = {
		browser: Browser;
		page: PageWithCursor;
		/** Blocker instance for advanced usage (null if enableBlocker is false) */
		blocker: AdBlocker | null;
		/** Setup function to configure new pages with session options */
		setupPage: (page: Page) => Promise<void>;
	};

	interface Options {
		args?: string[];
		headless?: boolean;
		contextOptions?: Record<string, unknown>;
		proxy?: ProxyOptions;
		turnstile?: boolean;
		/** Path to the browser executable (defaults to bundled Chromium) */
		executablePath?: string;
		/** Enable blocker on all pages (default: true) */
		enableBlocker?: boolean;
	}

	interface ProxyOptions {
		host: string;
		port: number;
		username?: string;
		password?: string;
	}

	/** Ad/tracker blocker powered by @ghostery/adblocker-playwright */
	interface AdBlocker {
		/** Enable blocking on a page */
		enableBlockingInPage(page: Page): Promise<void>;
	}
}
