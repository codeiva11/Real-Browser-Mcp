
import { state, requireBrowser, notifyProgress } from './state';
import { helpersHandlers } from './helpers';
import { resolveIframe } from './handler-utils';
import type { ClickParams, TypeParams, ScrollParams, PressKeyParams } from '../../types';

// Auto-generated dom handlers

export const domHandlers = {
  async click(params: ClickParams) {
    const { page } = requireBrowser();
    const {
      selector: providedSelector,
      annotationId,
      humanLike = true,
      clickCount = 1,
      delay = 0,
      autoAcceptDialogs = true,
      retries = 3,
      timeout = 60000,
      // Hover support for video player dynamic controls
      hoverFirst = false,
      hoverOnly = false,
      hoverDuration = 500,
      // iframe support
      iframe,
      iframeSelector,
      // Additional options
      scrollIntoView = true,
      forceClick = false,
      aiHeal = state.aiHealingEnabled,  // respect global aiHealing setting
      // NEW: Auto Video Player Detection & Control
      autoDetectPlayer = false,
      usePlayerAPI = true,
      waitForPlay = false,
      playerTimeout = 15000
    } = params;

    let selector: string | undefined = providedSelector;
    if (annotationId !== undefined) {
      if (state.activeAnnotations && state.activeAnnotations[annotationId]) {
        selector = state.activeAnnotations[annotationId].selector;
        notifyProgress('click', 'progress', `🎯 Using annotated selector for ID ${annotationId}: ${selector}`);
      } else {
        return { success: false, error: `Annotation ID ${annotationId} not found. Please run see_page(annotate: true) first.` };
      }
    }

    if (!selector) {
      return { success: false, error: 'You must provide either a selector or an annotationId. 💡 AI HINT: Use see_page(annotate: true) to get an annotationId.' };
    }

    notifyProgress('click', 'started', `${hoverOnly ? 'Hovering' : 'Clicking'}: ${selector}${iframe !== undefined ? ` (iframe ${iframe})` : ''}${autoDetectPlayer ? ' (auto-detect player)' : ''}`);

    // Get the correct context (page or iframe)
    let context = page;
    let frameInfo = null;
    let detectedPlayer = null;

    // ═══════════════════════════════════════════════════════════════
    // AUTO DETECT VIDEO PLAYER - Scan all iframes for video players
    // Supports: JWPlayer, VideoJS, Plyr, VidStack, DooPlayer, HTML5
    // ═══════════════════════════════════════════════════════════════
    if (autoDetectPlayer) {
      notifyProgress('click', 'progress', '🔍 Scanning for video players...');
      const { detectPlayerInContext } = require('./media-handlers');
      
      let playerInfo = await detectPlayerInContext(page, 'info', 'main');
      if (playerInfo.detected) {
         context = page;
         detectedPlayer = playerInfo;
         notifyProgress('click', 'progress', `✅ Found ${playerInfo.type.toUpperCase()} in main page`);
      } else {
        const frames = page.frames();
        for (let i = 1; i < frames.length; i++) {
          try {
            const frame = frames[i];
            const frameUrl = frame.url();
            if (!frameUrl || frameUrl === 'about:blank') continue;
            
            playerInfo = await detectPlayerInContext(frame, 'info', `frame-${i}`);
            if (playerInfo.detected) {
              context = frame as any;
              frameInfo = { index: i, url: frameUrl, autoDetected: true };
              detectedPlayer = playerInfo;
              notifyProgress('click', 'progress', `✅ Found ${playerInfo.type.toUpperCase()} in iframe ${i}: ${frameUrl.substring(0, 50)}...`);
              break;
            }
          } catch(e) {}
        }
      }

      if (!detectedPlayer) {
        notifyProgress('click', 'progress', '⚠️ No video player found, using main page');
      }
    }

    // Manual iframe selection (if not auto-detected)
    if (!autoDetectPlayer && (iframe !== undefined || iframeSelector)) {
      const resolved = await resolveIframe(page, iframe, iframeSelector, 'click');
      context = resolved.context;
      frameInfo = resolved.frameInfo;
    }

    // Auto-close any blocking modals before clicking
    await helpersHandlers._handleBlockingModals(page);

    // Auto-handle dialogs
    let dialogHandled = false;
    const dialogHandler = async (dialog: any) => {
      dialogHandled = true;
      const type = dialog.type();
      const message = dialog.message();
      notifyProgress('click', 'progress', `🔔 Auto-accepting ${type}: ${message.substring(0, 50)}...`);
      try {
        await dialog.accept();
      } catch (e) { }
    };

    if (autoAcceptDialogs) {
      page.on('dialog', dialogHandler);
    }

    let lastError = null;
    let playerResult: any = null;

    try {
      // ═══════════════════════════════════════════════════════════════
      // USE PLAYER API - More reliable than DOM click for video players
      // ═══════════════════════════════════════════════════════════════
      if (usePlayerAPI && detectedPlayer && (selector === 'video' || selector.includes('play') || selector.includes('Play'))) {
        notifyProgress('click', 'progress', `🎬 Using ${detectedPlayer.type} API for playback...`);

        playerResult = await context.evaluate((playerType: any) => {
          const result: any = { success: false, method: null, state: null };

          try {
            if (playerType === 'jwplayer' && (window as any).jwplayer) {
              const jw = (window as any).jwplayer();
              const stateBefore = jw.getState();
              jw.play();
              result.success = true;
              result.method = 'jwplayer.play()';
              result.stateBefore = stateBefore;
              result.stateAfter = jw.getState();
            } else if (playerType === 'videojs' && (window as any).videojs) {
              const player = (window as any).videojs.getPlayers()[Object.keys((window as any).videojs.getPlayers())[0]];
              if (player) {
                player.play();
                result.success = true;
                result.method = 'videojs.play()';
              }
            } else if (playerType === 'plyr' && window.Plyr) {
              const plyr = document.querySelector('.plyr')?.__plyr;
              if (plyr) {
                plyr.play();
                result.success = true;
                result.method = 'plyr.play()';
              }
            } else {
              // Fallback to HTML5 video
              const video = document.querySelector('video');
              if (video) {
                video.play();
                result.success = true;
                result.method = 'video.play()';
              }
            }
          } catch (e: any) {
            result.error = e.message;
          }

          return result;
        }, detectedPlayer.type).catch(e => ({ success: false, error: e.message }));

        if (playerResult.success) {
          notifyProgress('click', 'progress', `✅ ${playerResult.method} executed`);

          // Wait for play if requested
          if (waitForPlay) {
            notifyProgress('click', 'progress', '⏳ Waiting for video to start playing...');

            const startTime = Date.now();
            let isPlaying = false;

            while (Date.now() - startTime < playerTimeout) {
              const videoState: any = await context.evaluate(() => {
                const video = document.querySelector('video');
                if (video) {
                  return {
                    paused: video.paused,
                    currentTime: video.currentTime,
                    playing: !video.paused && video.currentTime > 0
                  };
                }
                if (window.jwplayer) {
                  const jw = window.jwplayer();
                  return { playing: jw.getState() === 'playing', jwState: jw.getState() };
                }
                return { playing: false };
              }).catch(() => ({ playing: false }));

              if (videoState.playing || videoState.currentTime > 0) {
                isPlaying = true;
                notifyProgress('click', 'progress', `▶️ Video is now playing (${videoState.currentTime?.toFixed(1) || 0}s)`);
                break;
              }

              await new Promise(r => setTimeout(r, 500));
            }

            if (!isPlaying) {
              notifyProgress('click', 'progress', '⚠️ Video may still be buffering');
            }
          }

          notifyProgress('click', 'completed', `Video playback started via ${playerResult.method}`, {
            selector,
            clicked: true,
            playerAPI: true,
            detectedPlayer,
            iframe: frameInfo,
            playerResult
          });

          return {
            success: true,
            selector,
            clicked: true,
            playerAPI: true,
            detectedPlayer,
            iframe: frameInfo,
            playerResult,
            dialogHandled
          };
        }
      }

      // Retry loop for regular click
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          // Wait for selector with timeout
          try {
            await context.waitForSelector(selector!, { timeout: Math.min(timeout / retries, 10000) });
          } catch (e) {
            if (aiHeal && attempt === 1) {
              const healed: string | null = await page.evaluate((sel: string) => {
                const parts = sel.replace(/[#.[\]]/g, ' ').trim().split(/\s+/).filter(Boolean);
                const candidates = document.querySelectorAll('a, button, input, [role="button"], [onclick]');
                for (const el of candidates) {
                  const text = (el.textContent || '').toLowerCase();
                  const id = (el.id || '').toLowerCase();
                  const cls = (el.className || '').toLowerCase();
                  for (const part of parts) {
                    if (text.includes(part.toLowerCase()) || id.includes(part.toLowerCase()) || cls.includes(part.toLowerCase())) {
                      if (el.id) return `#${el.id}`;
                      if (el.className) return `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}`;
                    }
                  }
                }
                return null;
              }, selector).catch(() => null);

              if (healed) {
                notifyProgress('click', 'progress', `🔧 AI Healed: ${selector} → ${healed}`);
                selector = healed;
                try {
                  await context.waitForSelector(selector!, { timeout: 5000 });
                } catch {
                  // healed selector also not found
                }
              }
            }
            if (attempt < retries) {
              notifyProgress('click', 'progress', `Selector not found, retry ${attempt}/${retries}...`);
              await new Promise(r => setTimeout(r, 1000));
              continue;
            }
            throw new Error(`Selector not found: ${selector}`);
          }

          // Scroll into view if needed
          if (scrollIntoView) {
            await context.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, selector);
            await new Promise(r => setTimeout(r, 300));
          }

          // HOVER functionality (for video player dynamic controls)
          if (hoverFirst || hoverOnly) {
            notifyProgress('click', 'progress', `Hovering over ${selector}...`);

            try {
              await context.hover(selector!);
              notifyProgress('click', 'progress', `Hover successful, waiting ${hoverDuration}ms for controls...`);
              await new Promise(r => setTimeout(r, hoverDuration));
            } catch (hoverErr) {
              notifyProgress('click', 'progress', `Standard hover failed, trying mouse movement...`);
              const element = await context.$(selector);
              if (element) {
                const box = await element.boundingBox();
                if (box) {
                  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                  await new Promise(r => setTimeout(r, hoverDuration));
                }
              }
            }

            if (hoverOnly) {
              notifyProgress('click', 'completed', `Hover completed: ${selector}`, { selector, hovered: true, iframe: frameInfo });
              return { success: true, selector, hovered: true, clicked: false, iframe: frameInfo, detectedPlayer };
            }
          }

          // CLICK functionality
          if (forceClick) {
            await context.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) el.click();
            }, selector);
            notifyProgress('click', 'progress', 'Used force click (JS)');
          } else if (humanLike) {
            try {
              const { createCursor } = require('ghost-cursor-patchright');
              const cursor = createCursor(page);

              if (context !== page) {
                const element = await context.$(selector);
                if (element) {
                  const box = await element.boundingBox();
                  if (box) {
                    await cursor.moveTo({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount, delay });
                  }
                }
              } else {
                await cursor.click(selector);
              }
              notifyProgress('click', 'progress', 'Used human-like cursor movement');
            } catch (e) {
              await context.click(selector!, { clickCount, delay });
            }
          } else {
            await context.click(selector!, { clickCount, delay });
          }

          await new Promise(r => setTimeout(r, 300));

          notifyProgress('click', 'completed',
            `${hoverFirst ? 'Hovered+' : ''}Clicked: ${selector}${dialogHandled ? ' (dialog auto-accepted)' : ''}`,
            { selector, humanLike, dialogHandled, iframe: frameInfo, detectedPlayer, attempts: attempt }
          );

          return {
            success: true,
            selector,
            clicked: true,
            dialogHandled,
            iframe: frameInfo,
            detectedPlayer,
            attempts: attempt
          };

        } catch (attemptError: any) {
          lastError = attemptError;
          if (attempt < retries) {
            notifyProgress('click', 'progress', `Attempt ${attempt} failed: ${attemptError.message}, retrying...`);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      throw lastError || new Error('Click failed after all retries. 💡 AI HINT: The DOM might have changed or the selector is invalid. Run see_page(annotate: true) to get an updated view and use annotationId instead.');

    } finally {
      if (autoAcceptDialogs) {
        page.off('dialog', dialogHandler);
      }
    }
  },

  async type(params: TypeParams) {
    const { page } = requireBrowser();
    const {
      selector: providedSelector,
      annotationId,
      text,
      delay = 50,
      clear = true,
      // iframe support
      iframe,
      iframeSelector,
      // Additional options
      pressEnter = false,
      waitForSelector = true,
      aiHeal = state.aiHealingEnabled,  // respect global aiHealing setting
    } = params;

    let selector = providedSelector;
    if (annotationId !== undefined) {
      if (state.activeAnnotations && state.activeAnnotations[annotationId]) {
        selector = state.activeAnnotations[annotationId].selector;
        notifyProgress('type', 'progress', `🎯 Using annotated selector for ID ${annotationId}: ${selector}`);
      } else {
        return { success: false, error: `Annotation ID ${annotationId} not found. Please run see_page(annotate: true) first.` };
      }
    }

    if (!selector) {
      return { success: false, error: 'You must provide either a selector or an annotationId. 💡 AI HINT: Use see_page(annotate: true) to get an annotationId.' };
    }

    notifyProgress('type', 'started', `Typing ${text.length} characters into ${selector}${iframe !== undefined ? ` (iframe ${iframe})` : ''}`);

    // Get the correct context (page or iframe)
    let context = page;
    let frameInfo = null;

    if (iframe !== undefined || iframeSelector) {
      const resolved = await resolveIframe(page, iframe, iframeSelector, 'type');
      context = resolved.context;
      frameInfo = resolved.frameInfo;
    }

    // Auto-close any blocking modals before typing
    await helpersHandlers._handleBlockingModals(page);

    // Wait for selector if enabled
    if (waitForSelector) {
      try {
        await context.waitForSelector(selector!, { timeout: 10000 });
      } catch (e) {
        if (aiHeal) {
          const healed = await page.evaluate((sel: string) => {
            const parts = sel.replace(/[#.[\]]/g, ' ').trim().split(/\s+/).filter(Boolean);
            const candidates = document.querySelectorAll('input, textarea, select');
            for (const el of candidates) {
              const name = (el.getAttribute('name') || '').toLowerCase();
              const id = (el.id || '').toLowerCase();
              const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
              for (const part of parts) {
                const p = part.toLowerCase();
                if (name.includes(p) || id.includes(p) || placeholder.includes(p)) {
                  if (el.id) return `#${el.id}`;
                  if (el.getAttribute('name')) return `[name="${el.getAttribute('name')}"]`;
                }
              }
            }
            return null;
          }, selector).catch(() => null);

          if (healed) {
            notifyProgress('type', 'progress', `🔧 AI Healed: ${selector} → ${healed}`);
            selector = healed;
          }
        }
        notifyProgress('type', 'error', `Selector not found: ${selector}`);
        return { success: false, error: `Selector not found: ${selector}. 💡 AI HINT: The element might be hidden, inside an iframe, or the selector is wrong. Run see_page(annotate: true) to verify and get an annotationId.` };
      }
    }

    // Clear existing text if needed
    if (clear) {
      await context.click(selector!, { clickCount: 3 });
      await context.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLInputElement;
        if (el) el.value = '';
      }, selector);
      notifyProgress('type', 'progress', 'Cleared existing text');
    }

    // Type text with human-like delays
    await context.type(selector, text, { delay });

    // Press Enter if requested
    if (pressEnter) {
      await context.keyboard.press('Enter');
      notifyProgress('type', 'progress', 'Pressed Enter');
    }

    notifyProgress('type', 'completed', `Typed ${text.length} characters`, { selector, textLength: text.length, iframe: frameInfo });

    return { success: true, selector, textLength: text.length, iframe: frameInfo };
  },

  async random_scroll(params: ScrollParams = {}) {
    const { page } = requireBrowser();
    const { direction = 'down', amount = 0, smooth = true, aiDetectLazyLoad = true } = params;

    let scrollAmount = amount || Math.floor(Math.random() * 500) + 200;

    if (aiDetectLazyLoad) {
      const lazyInfo = await page.evaluate(() => {
        const lazyImages = document.querySelectorAll('img[loading="lazy"], img[data-src], [data-lazy]');
        const infiniteScroll = !!document.querySelector('[class*="infinite"], [class*="load-more"]');
        return { lazyImages: lazyImages.length, infiniteScroll };
      }).catch(() => ({ lazyImages: 0, infiniteScroll: false }));

      if (lazyInfo.lazyImages > 0) {
        scrollAmount = Math.min(scrollAmount, 300);
      }
    }

    let scrollDirection: string;
    if (direction === 'random') {
      scrollDirection = Math.random() > 0.5 ? 'down' : 'up';
    } else if (direction === 'smart') {
      const scrollInfo = await page.evaluate(() => ({
        scrollY: window.scrollY,
        scrollHeight: document.body.scrollHeight,
        innerHeight: window.innerHeight
      }));
      const atBottom = scrollInfo.scrollY + scrollInfo.innerHeight >= scrollInfo.scrollHeight - 100;
      const atTop = scrollInfo.scrollY <= 10;
      scrollDirection = atBottom ? 'up' : atTop ? 'down' : (Math.random() > 0.5 ? 'down' : 'up');
    } else {
      scrollDirection = direction;
    }

    notifyProgress('random_scroll', 'started', `Scrolling ${scrollDirection} ${scrollAmount}px`);

    const y = scrollDirection === 'down' ? scrollAmount : -scrollAmount;
    if (smooth && (page as any).realScroll) {
      await (page as any).realScroll(y, 600);
    } else {
      await page.evaluate(({ y, smooth }: any) => {
        window.scrollBy({ top: y, behavior: smooth ? 'smooth' : 'auto' });
      }, { y, smooth });
    }

    notifyProgress('random_scroll', 'completed', `Scrolled ${scrollDirection} ${scrollAmount}px`, { direction: scrollDirection, amount: scrollAmount });

    return { success: true, direction: scrollDirection, amount: scrollAmount };
  },

  async press_key(params: PressKeyParams) {
    const { page } = requireBrowser();
    const { key, modifiers = [], count = 1, humanDelay = true } = params as PressKeyParams & { humanDelay?: boolean };

    notifyProgress('press_key', 'started', `Pressing: ${modifiers.length ? modifiers.join('+') + '+' : ''}${key} x${count}`);

    for (let i = 0; i < count; i++) {
      if (modifiers.length > 0) {
        const keyCombo = [...modifiers, key].join('+');
        await page.keyboard.press(keyCombo);
      } else {
        await page.keyboard.press(key);
      }
      // humanDelay: natural random pause between key presses
      if (humanDelay && count > 1 && i < count - 1) {
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      }
    }

    notifyProgress('press_key', 'completed', `Pressed ${key} ${count} time(s)`, { key, modifiers, count });

    return { success: true, key, modifiers, count };
  }
};
