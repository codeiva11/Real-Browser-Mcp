/**
 * Global type augmentations for browser automation.
 * 
 * These declarations extend Window and Element interfaces
 * for video players, interceptors, and other runtime globals
 * used inside page.evaluate() callbacks.
 */

// Extend Window for video players and browser automation globals
interface Window {
  // Video Players
  jwplayer: any;
  videojs: any;
  Plyr: any;
  VidStack: any;
  DooPlay: any;
  player: any;
  videoPlayer: any;
  mediaPlayer: any;
  vPlayer: any;
  hls: any;
  flv: any;

  // Browser automation hooks
  __interceptedApis: any[];
  __wsMessages: any[];
  __DATA__: any;
  __INITIAL_STATE__: any;
  __APP_DATA__: any;
  data: any;
  config: any;

  // Brave browser
  brave: any;

  // Dialog overrides
  originalConfirm: typeof window.confirm;
  originalAlert: typeof window.alert;
}

// Extend Element for common DOM properties accessed via querySelector
interface Element {
  // HTMLElement properties
  innerText: string;
  offsetParent: Element | null;
  click(): void;
  style: CSSStyleDeclaration;

  // HTMLInputElement properties
  value: string;
  type: string;
  name: string;
  placeholder: string;
  required: boolean;
  disabled: boolean;

  // HTMLAnchorElement properties
  href: string;
  target: string;

  // HTMLImageElement / HTMLMediaElement properties
  src: string;
  currentSrc: string;

  // HTMLIFrameElement
  contentFrame(): any;

  // Dataset
  dataset: DOMStringMap;

  // Custom player properties
  plyr: any;
  __plyr: any;
}
