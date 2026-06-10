import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { state, requireBrowser, notifyProgress, getHeadlessFromEnv, decoders, setProgressCallback, resolveWaitUntil } from './state';
import { handlers } from './index';

// Auto-generated dom handlers

export const domHandlers = {
  async click(params: any) {
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
      // NEW: Auto Video Player Detection & Control
      autoDetectPlayer = false,
      usePlayerAPI = true,
      waitForPlay = false,
      playerTimeout = 15000
    } = params;

    let selector = providedSelector;
    if (annotationId !== undefined) {
      if (state.activeAnnotations && state.activeAnnotations[annotationId]) {
        selector = state.activeAnnotations[annotationId].selector;
        notifyProgress('click', 'progress', `🎯 Using annotated selector for ID ${annotationId}: ${selector}`);
      } else {
        return { success: false, error: `Annotation ID ${annotationId} not found. Please run see_page(annotate: true) first.` };
      }
    }

    if (!selector) {
      return { success: false, error: 'You must provide either a selector or an annotationId.' };
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
      notifyProgress('click', 'progress', '🔍 Scanning all iframes for video players...');

      const frames = page.frames();

      for (let i = 0; i < frames.length; i++) {
        try {
          const frame = frames[i];
          const frameUrl = frame.url();

          // Skip blank frames
          if (frameUrl === 'about:blank' || !frameUrl) continue;

          // Detect player in this frame
          const playerInfo: any = await frame.evaluate(() => {
            const result: any = {
              hasPlayer: false,
              playerType: null,
              hasVideo: false,
              videoState: null,
              controls: [],
              downloadButton: null
            };

            // Check for video element
            const video = document.querySelector('video');
            if (video) {
              result.hasVideo = true;
              result.videoState = {
                paused: video.paused,
                currentTime: video.currentTime,
                duration: video.duration,
                readyState: video.readyState
              };
            }

            // 1. JWPlayer Detection
            if ((window as any).jwplayer && typeof (window as any).jwplayer === 'function') {
              try {
                const jw = (window as any).jwplayer();
                if (jw && jw.getState) {
                  result.hasPlayer = true;
                  result.playerType = 'jwplayer';
                  result.playerState = jw.getState();
                  result.controls.push('.jw-icon-display', '.jw-icon-playback', '[aria-label="Play"]');

                  // Find download button in JWPlayer
                  const dlBtn = document.querySelector('[aria-label="Download"], .jw-icon-download, [class*="download"]');
                  if (dlBtn) result.downloadButton = '[aria-label="Download"]';
                }
              } catch (e) { }
            }

            // 2. VideoJS Detection
            if ((window as any).videojs || document.querySelector('.video-js')) {
              result.hasPlayer = true;
              result.playerType = result.playerType || 'videojs';
              result.controls.push('.vjs-big-play-button', '.vjs-play-control');
            }

            // 3. Plyr Detection
            if ((window as any).Plyr || document.querySelector('.plyr')) {
              result.hasPlayer = true;
              result.playerType = result.playerType || 'plyr';
              result.controls.push('.plyr__control--play', '[data-plyr="play"]');
            }

            // 4. VidStack Detection
            if ((window as any).VidStack || document.querySelector('media-player')) {
              result.hasPlayer = true;
              result.playerType = result.playerType || 'vidstack';
              result.controls.push('media-play-button', '[data-media-play]');
            }

            // 5. DooPlayer Detection
            if ((window as any).DooPlay || document.querySelector('#dooplay') || document.querySelector('.dooplay')) {
              result.hasPlayer = true;
              result.playerType = result.playerType || 'dooplayer';
              result.controls.push('.play-btn', '.dooplay-play');
            }

            // 6. Generic HTML5 Video
            if (result.hasVideo && !result.hasPlayer) {
              result.hasPlayer = true;
              result.playerType = 'html5';
              result.controls.push('video');
            }

            // Find any download button
            if (!result.downloadButton) {
              const dlSelectors = [
                '[aria-label="Download"]', '[aria-label*="download"]',
                '.download-btn', '.download', '[class*="download"]',
                'a[download]', 'button[class*="download"]'
              ];
              for (const sel of dlSelectors) {
                if (document.querySelector(sel)) {
                  result.downloadButton = sel;
                  break;
                }
              }
            }

            return result;
          }).catch(() => ({ hasPlayer: false }));

          if (playerInfo.hasPlayer) {
            context = frame as any;
            frameInfo = {
              index: i,
              url: frameUrl,
              autoDetected: true
            };
            detectedPlayer = {
              type: playerInfo.playerType,
              state: playerInfo.playerState || playerInfo.videoState,
              controls: playerInfo.controls,
              downloadButton: playerInfo.downloadButton
            };

            notifyProgress('click', 'progress',
              `✅ Found ${playerInfo.playerType.toUpperCase()} in iframe ${i}: ${frameUrl.substring(0, 50)}...`);
            break;
          }
        } catch (e) {
          // Skip frames that can't be accessed
          continue;
        }
      }

      if (!detectedPlayer) {
        notifyProgress('click', 'progress', '⚠️ No video player found in any iframe, using main page');
      }
    }

    // Manual iframe selection (if not auto-detected)
    if (!autoDetectPlayer && (iframe !== undefined || iframeSelector)) {
      try {
        const frames = page.frames();

        if (iframe !== undefined && frames[iframe]) {
          context = frames[iframe] as any;
          frameInfo = { index: iframe, url: frames[iframe].url() };
          notifyProgress('click', 'progress', `Switched to iframe ${iframe}: ${frames[iframe].url().substring(0, 50)}...`);
        } else if (iframeSelector) {
          const iframeHandle = await page.$(iframeSelector);
          if (iframeHandle) {
            const frame = await iframeHandle.contentFrame();
            if (frame) {
              context = frame as any;
              frameInfo = { selector: iframeSelector, url: frame.url() };
              notifyProgress('click', 'progress', `Switched to iframe by selector: ${iframeSelector}`);
            }
          }
        }
      } catch (e: any) {
        notifyProgress('click', 'progress', `Warning: Could not switch to iframe - ${e.message}`);
      }
    }

    // Auto-close any blocking modals before clicking
    await handlers._handleBlockingModals(page);

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
              const state: any = await context.evaluate(() => {
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

              if (state.playing || state.currentTime > 0) {
                isPlaying = true;
                notifyProgress('click', 'progress', `▶️ Video is now playing (${state.currentTime?.toFixed(1) || 0}s)`);
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
            await context.waitForSelector(selector, { timeout: Math.min(timeout / retries, 10000) });
          } catch (e) {
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
              await context.hover(selector);
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
              await context.click(selector, { clickCount, delay });
            }
          } else {
            await context.click(selector, { clickCount, delay });
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

      throw lastError || new Error('Click failed after all retries');

    } finally {
      if (autoAcceptDialogs) {
        page.off('dialog', dialogHandler);
      }
    }
  },

  async type(params: any) {
    const { page } = requireBrowser();
    const {
      selector: providedSelector,
      annotationId,
      text,
      delay = 50,
      clear = false,
      // NEW: iframe support
      iframe,
      iframeSelector,
      // NEW: Additional options
      pressEnter = false,
      waitForSelector = true
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
      return { success: false, error: 'You must provide either a selector or an annotationId.' };
    }

    notifyProgress('type', 'started', `Typing ${text.length} characters into ${selector}${iframe !== undefined ? ` (iframe ${iframe})` : ''}`);

    // Get the correct context (page or iframe)
    let context = page;
    let frameInfo = null;

    if (iframe !== undefined || iframeSelector) {
      try {
        const frames = page.frames();

        if (iframe !== undefined && frames[iframe]) {
          context = frames[iframe] as any;
          frameInfo = { index: iframe, url: frames[iframe].url() };
          notifyProgress('type', 'progress', `Switched to iframe ${iframe}`);
        } else if (iframeSelector) {
          const iframeHandle = await page.$(iframeSelector);
          if (iframeHandle) {
            const frame = await iframeHandle.contentFrame();
            if (frame) {
              context = frame as any;
              frameInfo = { selector: iframeSelector, url: frame.url() };
              notifyProgress('type', 'progress', `Switched to iframe by selector`);
            }
          }
        }
      } catch (e: any) {
        notifyProgress('type', 'progress', `Warning: Could not switch to iframe - ${e.message}`);
      }
    }

    // Auto-close any blocking modals before typing
    await handlers._handleBlockingModals(page);

    // Wait for selector if enabled
    if (waitForSelector) {
      try {
        await context.waitForSelector(selector, { timeout: 10000 });
      } catch (e) {
        notifyProgress('type', 'error', `Selector not found: ${selector}`);
        return { success: false, error: `Selector not found: ${selector}` };
      }
    }

    // Clear existing text if needed
    if (clear) {
      await context.click(selector, { clickCount: 3 });
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

  async random_scroll(params: any = {}) {
    const { page } = requireBrowser();
    const { direction = 'down', amount = 0, smooth = true } = params;

    const scrollAmount = amount || Math.floor(Math.random() * 500) + 200;
    const scrollDirection = direction === 'random'
      ? (Math.random() > 0.5 ? 'down' : 'up')
      : direction;

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

  async find_element(params: any = {}) {
    const { page } = requireBrowser();
    const { selector, xpath, text, multiple = false } = params;

    notifyProgress('find_element', 'started', `Finding element: ${selector || xpath || text}`);

    let elements: any[] = [];

    if (selector) {
      if (multiple) {
        elements = await page.$$eval(selector, els => els.map(el => ({
          tag: el.tagName,
          text: el.textContent?.substring(0, 100),
          classes: el.className,
          id: el.id
        })));
      } else {
        const el = await page.$(selector);
        if (el) {
          elements = [await el.evaluate(el => ({
            tag: el.tagName,
            text: el.textContent?.substring(0, 100),
            classes: el.className,
            id: el.id
          }))];
        }
      }
    } else if (xpath) {
      const handles = await page.$$(`xpath=${xpath}`);
      elements = await Promise.all(handles.map(h => h.evaluate(el => ({
        tag: el.tagName,
        text: el.textContent?.substring(0, 100)
      }))));
    } else if (text) {
      elements = await page.$$eval('*', (els, text) =>
        els.filter(el => el.textContent?.includes(text))
          .slice(0, 10)
          .map(el => ({ tag: el.tagName, text: el.textContent?.substring(0, 100) })),
        text
      );
    }

    notifyProgress('find_element', 'completed', `Found ${elements.length} element(s)`, { found: elements.length });

    return { success: true, found: elements.length, elements };
  },

  async press_key(params: any) {
    const { page } = requireBrowser();
    const { key, modifiers = [], count = 1 } = params;

    notifyProgress('press_key', 'started', `Pressing: ${modifiers.length ? modifiers.join('+') + '+' : ''}${key} x${count}`);

    for (let i = 0; i < count; i++) {
      if (modifiers.length > 0) {
        const keyCombo = [...modifiers, key].join('+');
        await page.keyboard.press(keyCombo);
      } else {
        await page.keyboard.press(key);
      }
    }

    notifyProgress('press_key', 'completed', `Pressed ${key} ${count} time(s)`, { key, modifiers, count });

    return { success: true, key, modifiers, count };
  }
};
