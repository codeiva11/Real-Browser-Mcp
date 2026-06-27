// Media handlers — Stream extraction, player control, media tools
import { state, requireBrowser, notifyProgress, decoders } from './state';


// ═══════════════════════════════════════════════════════════════
// Media Handlers — Stream extraction, player control, media tools
// ═══════════════════════════════════════════════════════════════

/**
 * Shared helper: Extract streams from a page/frame context.
 * Used by both stream_extractor and media_extractor to avoid duplication.
 */
async function extractStreamsFromContext(context: any, contextName = 'main') {
  return await context.evaluate(() => {
    const result: any = { video: [], audio: [], hls: [], dash: [], download: [], embedded: [] };
    const isPlayableMediaUrl = (url?: string) => {
      if (!url || !url.startsWith('http')) return false;
      const cleanUrl = url.split('?')[0].toLowerCase();
      if (/\.(jpg|jpeg|png|gif|webp|avif|svg|ico)$/i.test(cleanUrl)) return false;
      return /\.(m3u8|mpd|mp4|mkv|avi|webm|mov)$/i.test(cleanUrl) ||
        /(?:^|[?&#])(file|src|url)=https?:/i.test(url) ||
        /(hls|dash|manifest|playlist|stream|video|embed|player)/i.test(url);
    };

    // 1. Direct video/audio elements
    document.querySelectorAll('video source, video').forEach(el => {
      const src = el.src || el.getAttribute('src') || el.currentSrc;
      if (src && src.startsWith('http')) result.video.push({ src, type: el.type || 'video' });
    });

    document.querySelectorAll('audio source, audio').forEach(el => {
      const src = el.src || el.getAttribute('src');
      if (src && src.startsWith('http')) result.audio.push({ src, type: el.type || 'audio' });
    });

    // 2. Script content analysis for HLS/DASH/MP4
    const scripts = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
    const html = document.documentElement.innerHTML;
    const combined = scripts + html;

    // HLS streams
    const hlsMatches = combined.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
    result.hls = [...new Set(hlsMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'hls' }));

    // DASH streams
    const dashMatches = combined.match(/https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*/gi) || [];
    result.dash = [...new Set(dashMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'dash' }));

    // Direct MP4/video links
    const mp4Matches = combined.match(/https?:\/\/[^\s"'<>]+\.(mp4|mkv|avi|webm)[^\s"'<>]*/gi) || [];
    result.download = [...new Set(mp4Matches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'direct' }));

    // 3. Data attributes and hidden sources
    document.querySelectorAll('[data-src], [data-video], [data-url], [data-file]').forEach(el => {
      const dataSrc = el.dataset.src || el.dataset.video || el.dataset.url || el.dataset.file;
      if (isPlayableMediaUrl(dataSrc)) {
        result.video.push({ src: dataSrc, type: 'data-attribute' });
      }
    });

    // 4. Embedded player iframes (just URLs, not content)
    document.querySelectorAll('iframe[src]').forEach(el => {
      const src = el.src;
      if (src && src.startsWith('http')) {
        result.embedded.push({ src, type: 'iframe' });
      }
    });

    // 5. JWPlayer / VideoJS / Plyr sources
    if (window.jwplayer) {
      try {
        const jw = window.jwplayer();
        const playlist = jw.getPlaylist?.() || [];
        playlist.forEach((item: any) => {
          if (item.file) result.video.push({ src: item.file, type: 'jwplayer' });
          (item.sources || []).forEach((s: any) => {
            if (s.file) result.video.push({ src: s.file, type: 'jwplayer-source' });
          });
        });
      } catch (e) { }
    }

    if (window.player && window.player.src) {
      try {
        const src = typeof window.player.src === 'function' ? window.player.src() : window.player.src;
        if (src) result.video.push({ src, type: 'player-api' });
      } catch (e) { }
    }

    // 6. Look for common patterns
    const patterns = [
      /file\s*:\s*["']([^"']+)["']/gi,
      /source\s*:\s*["']([^"']+)["']/gi,
      /src\s*:\s*["']([^"']+\.(?:m3u8|mp4|mkv))["']/gi,
      /url\s*:\s*["']([^"']+\.(?:m3u8|mp4))["']/gi,
      /video_url\s*=\s*["']([^"']+)["']/gi,
      /sources\s*:\s*\[([^\]]+)\]/gi
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(combined)) !== null) {
        const url = match[1];
        if (url && url.startsWith('http') && (url.includes('.mp4') || url.includes('.m3u8'))) {
          result.download.push({ src: url, type: 'pattern-match' });
        }
      }
    });

    return result;
  }).catch(() => ({ video: [], audio: [], hls: [], dash: [], download: [], embedded: [] }));
}

/**
 * Shared helper: Detect video player in a page/frame context.
 * Used by both player_api_hook and media_extractor.
 */
export async function detectPlayerInContext(context: any, actionOrParams: any, contextName = 'main') {
  const action = typeof actionOrParams === 'string' ? actionOrParams : (actionOrParams?.action || 'info');
  const playerType = typeof actionOrParams === 'object' ? actionOrParams?.playerType : 'auto';

  return await context.evaluate(({ playerType, action }: any) => {
    const result: any = { detected: false, type: null, sources: [], info: {} };

    // 1. JWPlayer detection
    if (window.jwplayer) {
      try {
        const jw = window.jwplayer();
        if (jw) {
          result.detected = true;
          result.type = 'jwplayer';
          result.info = {
            duration: jw.getDuration?.(),
            currentTime: jw.getPosition?.(),
            volume: jw.getVolume?.(),
            state: jw.getState?.()
          };

          if (action === 'sources') {
            const playlist = jw.getPlaylist?.() || [];
            playlist.forEach((item: any) => {
              if (item.file) result.sources.push({ src: item.file, type: 'jwplayer' });
              (item.sources || []).forEach((s: any) => {
                if (s.file) result.sources.push({ src: s.file, type: 'jwplayer-source', label: s.label });
              });
            });
          }

          if (action === 'play') jw.play?.();
          if (action === 'pause') jw.pause?.();
        }
      } catch (e) { }
    }

    // 2. Video.js detection
    if (window.videojs && !result.detected) {
      try {
        const players = document.querySelectorAll('.video-js');
        if (players.length > 0) {
          const player = window.videojs(players[0].id || players[0]);
          result.detected = true;
          result.type = 'videojs';
          result.info = {
            duration: player.duration?.(),
            currentTime: player.currentTime?.(),
            volume: player.volume?.()
          };

          if (action === 'sources') {
            const src = player.currentSrc?.();
            if (src) result.sources.push({ src, type: 'videojs' });
          }

          if (action === 'play') player.play?.();
          if (action === 'pause') player.pause?.();
        }
      } catch (e) { }
    }

    // 3. Plyr detection
    if (window.Plyr && !result.detected) {
      try {
        const plyrElements = document.querySelectorAll('.plyr');
        if (plyrElements.length > 0 && plyrElements[0].plyr) {
          const player = plyrElements[0].plyr;
          result.detected = true;
          result.type = 'plyr';
          result.info = {
            duration: player.duration,
            currentTime: player.currentTime,
            volume: player.volume
          };

          if (action === 'sources') {
            const src = player.source;
            if (src) result.sources.push({ src, type: 'plyr' });
          }

          if (action === 'play') player.play?.();
          if (action === 'pause') player.pause?.();
        }
      } catch (e) { }
    }

    // 4. Generic window.player
    if ((window.player || window.videoPlayer) && !result.detected) {
      try {
        const player = window.player || window.videoPlayer;
        result.detected = true;
        result.type = 'generic';
        result.info = {
          duration: player.getDuration?.() || player.duration,
          currentTime: player.getCurrentTime?.() || player.currentTime,
          volume: player.getVolume?.() || player.volume
        };

        if (action === 'sources') {
          const sources = player.getSources?.() || player.getPlaylist?.() || [];
          sources.forEach((s: any) => {
            if (s.file || s.src) result.sources.push({ src: s.file || s.src, type: 'generic' });
          });
        }
      } catch (e) { }
    }

    // 5. HTML5 Video fallback
    if (!result.detected) {
      const video = document.querySelector('video');
      if (video) {
        result.detected = true;
        result.type = 'html5';
        result.info = {
          duration: video.duration, currentTime: video.currentTime,
          volume: video.volume, paused: video.paused, src: video.src || video.currentSrc
        };

        if (action === 'sources') {
          if (video.src) result.sources.push({ src: video.src, type: 'html5' });
          if (video.currentSrc && video.currentSrc !== video.src) {
            result.sources.push({ src: video.currentSrc, type: 'html5-current' });
          }
          video.querySelectorAll('source').forEach(s => { if (s.src) result.sources.push({ src: s.src, type: 'html5-source' }); });
        }

        if (action === 'play') video.play();
        if (action === 'pause') video.pause();
        if (action === 'seek' && typeof actionOrParams === 'object' && actionOrParams.seekTime) video.currentTime = actionOrParams.seekTime;
      }
    }

    // 6. Look for common obfuscated player variables
    const commonPlayerVars = ['player', 'videoPlayer', 'mediaPlayer', 'vPlayer', 'hls', 'flv'];
    for (const varName of commonPlayerVars) {
      if ((window as any)[varName] && !result.detected) {
        try {
          const p = (window as any)[varName];
          if (typeof p === 'object' && (p.play || p.getDuration || p.src)) {
            result.detected = true;
            result.type = `${varName}-object`;
            result.info = { raw: true };
          }
        } catch (e) { }
      }
    }

    return result;
  }, { playerType, action }).catch(() => ({ detected: false }));
}

/**
 * Shared helper: Deduplicate streams by URL
 */
function deduplicateStreams(streams: any) {
  Object.keys(streams).forEach(key => {
    if (Array.isArray(streams[key])) {
      const seen = new Set();
      streams[key] = streams[key].filter(item => {
        if (seen.has(item.src)) return false;
        seen.add(item.src);
        return true;
      });
    }
  });
  return streams;
}

export const mediaHandlers = {

  async media_extractor(params: any = {}) {
    const { page } = requireBrowser();
    const {
      action = 'extract',
      types = ['all'],
      quality = 'best',
      searchIframes = true,
      deep = true,
      selector,
      index,
      playerAction = 'info',
      encodedData,
      decoderType = 'auto',
      aesKey,
      aesIV,
      urls,
      aiOptimize = true
    } = params;

    notifyProgress('media_extractor', 'started', `Media extraction action: ${action}`);

    // Helper: Auto-detect decoder type
    const autoDetectDecoder = (data: any) => {
      if (data.includes('%')) return 'url';
      if (/^[A-Za-z0-9+/=]+$/.test(data) && data.length % 4 === 0) return 'base64';
      return 'url';
    };

    switch (action) {
      case 'extract': {
        notifyProgress('media_extractor', 'progress', 'Extracting all media...');

        // Get iframes
        const frames = page.frames();
        const iframes = frames.map((f, i) => ({ index: i, name: f.name(), url: f.url() }));

        // Extract streams from main page
        let allStreams = await extractStreamsFromContext(page, 'main');

        // Search in iframes
        if (searchIframes) {
          for (let i = 1; i < frames.length && i < 10; i++) {
            try {
              const frame = frames[i];
              const frameUrl = frame.url();
              if (frameUrl && frameUrl !== 'about:blank') {
                const frameStreams = await extractStreamsFromContext(frame, `frame-${i}`);
                Object.keys(frameStreams).forEach(key => {
                  if (Array.isArray(frameStreams[key])) {
                    frameStreams[key].forEach(stream => { stream.source = `iframe: ${frameUrl}`; });
                    allStreams[key] = [...(allStreams[key] || []), ...frameStreams[key]];
                  }
                });
              }
            } catch (e) { }
          }
        }

        // Deduplicate
        allStreams = deduplicateStreams(allStreams);

        // Detect players
        let playerInfo = await detectPlayerInContext(page, playerAction, 'main');
        if (!playerInfo.detected && searchIframes) {
          for (let i = 1; i < frames.length && i < 10; i++) {
            try {
              const frame = frames[i];
              const frameUrl = frame.url();
              if (frameUrl && frameUrl !== 'about:blank') {
                const framePlayer = await detectPlayerInContext(frame, playerAction, `frame-${i}`);
                if (framePlayer.detected) {
                  playerInfo = { ...framePlayer, frameSource: frameUrl };
                  break;
                }
              }
            } catch (e) { }
          }
        }

        const totalStreams = Object.values(allStreams as Record<string, any>).reduce((sum: number, arr: any) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        notifyProgress('media_extractor', 'completed', `Extracted ${totalStreams} streams, ${iframes.length} iframes, player: ${playerInfo.detected ? playerInfo.type : 'none'}`);

        return {
          success: true,
          action: 'extract',
          streams: allStreams,
          iframes,
          player: playerInfo,
          totalStreams,
          iframeCount: iframes.length
        };
      }

      case 'list_iframes': {
        const frames = page.frames();
        const iframes = frames.map((f, i) => ({ index: i, name: f.name(), url: f.url() }));
        notifyProgress('media_extractor', 'completed', `Found ${iframes.length} iframes`);
        return { success: true, action: 'list_iframes', count: iframes.length, iframes };
      }

      case 'switch_iframe': {
        const frames = page.frames();
        const targetFrame = selector
          ? await page.$(selector).then(el => el?.contentFrame())
          : frames[index];

        if (targetFrame) {
          notifyProgress('media_extractor', 'completed', `Switched to iframe: ${targetFrame.url()}`);
          return { success: true, action: 'switch_iframe', switched: true, url: targetFrame.url(), frameIndex: index };
        }
        notifyProgress('media_extractor', 'error', 'Iframe not found');
        return { success: false, error: 'Iframe not found' };
      }

      case 'player_control': {
        const { playerType, seekTime, volume } = params;
        notifyProgress('media_extractor', 'progress', `Player control: ${playerAction}`);

        let result = await detectPlayerInContext(page, playerAction, 'main');

        if (!result.detected && searchIframes) {
          const frames = page.frames();
          for (let i = 1; i < frames.length && i < 10; i++) {
            try {
              const frame = frames[i];
              const frameUrl = frame.url();
              if (frameUrl && frameUrl !== 'about:blank') {
                const frameResult = await detectPlayerInContext(frame, playerAction, `frame-${i}`);
                if (frameResult.detected) {
                  result = { ...frameResult, frameSource: frameUrl };
                  break;
                }
              }
            } catch (e) { }
          }
        }

        notifyProgress('media_extractor', 'completed', result.detected ? `Player ${playerAction} executed: ${result.type}` : 'No player found');
        return { success: true, action: 'player_control', playerAction, ...result };
      }

      case 'decode_url': {
        if (!encodedData) {
          return { success: false, error: 'encodedData is required for decode_url action' };
        }

        const type = decoderType === 'auto' ? autoDetectDecoder(encodedData) : decoderType;
        let decoded;

        notifyProgress('media_extractor', 'progress', `Decoding with ${type}...`);

        switch (type) {
          case 'url':
            decoded = decoders.urlDecode(encodedData);
            break;
          case 'base64':
            decoded = decoders.base64Decode(encodedData);
            break;
          case 'aes':
            if (!aesKey) {
              return { success: false, error: 'aesKey is required for AES decryption' };
            }
            decoded = decoders.decryptAES(encodedData, aesKey, aesIV);
            break;
          default:
            decoded = { success: false, error: 'Unknown decoder type' };
        }

        notifyProgress('media_extractor', 'completed', decoded.success ? 'Decoding successful' : 'Decoding failed');
        return { action: 'decode_url', decoderType: type, ...decoded };
      }

      case 'batch_extract': {
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return { success: false, error: 'urls array is required for batch_extract action' };
        }

        notifyProgress('media_extractor', 'progress', `Batch extracting from ${urls.length} URLs...`);

        const results = [];
        const errors = [];

        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          try {
            notifyProgress('media_extractor', 'progress', `Processing ${i + 1}/${urls.length}: ${url}`);

            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));

            const streams = await extractStreamsFromContext(page, 'main');
            const dedupedStreams = deduplicateStreams(streams);
            const totalCount = Object.values(dedupedStreams as Record<string, any>).reduce((sum: number, arr: any) => sum + (Array.isArray(arr) ? arr.length : 0), 0);

            const meta = await page.evaluate(() => ({
              title: document.title,
              url: window.location.href
            }));

            results.push({
              url,
              success: true,
              streams: dedupedStreams,
              totalCount,
              title: meta.title,
              finalUrl: meta.url
            });
          } catch (error: any) {
            errors.push({ url, error: error.message });
            results.push({ url, success: false, error: error.message });
          }
        }

        const successCount = results.filter(r => r.success).length;
        notifyProgress('media_extractor', 'completed', `Batch extraction complete: ${successCount}/${urls.length} successful`);

        return {
          success: true,
          action: 'batch_extract',
          totalUrls: urls.length,
          successful: successCount,
          failed: urls.length - successCount,
          results,
          errors
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}. Supported: extract, list_iframes, switch_iframe, player_control, decode_url, batch_extract` };
    }
  }
};
