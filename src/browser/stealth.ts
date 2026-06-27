import type { IPage } from '../interfaces/browser.js';

export function getStealthScripts(): string[] {
  return [
    // 1. navigator.webdriver
    `(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    })();`,

    // 2. navigator.plugins / mimeTypes
    `(() => {
      const makePlugin = (name, filename, description, version) => ({
        name, filename, description, version,
        length: 1,
        item: () => null,
        namedItem: () => null,
      });
      const plugins = [
        makePlugin('Chrome PDF Plugin', 'internal-pdf-viewer', 'Portable Document Format', 'undefined'),
        makePlugin('Native Client', 'internal-nacl-plugin', 'Native Client module', 'undefined'),
        makePlugin('Widevine Content Decryption Module', 'widevinecdmadapter.dll', 'Widevine Content Decryption Module', 'undefined'),
      ];
      Object.setPrototypeOf(plugins, PluginArray.prototype);
      Object.defineProperty(navigator, 'plugins', {
        get: () => plugins,
        configurable: true,
      });
      const mimeTypes = [
        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: plugins[0] },
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: plugins[0] },
      ];
      Object.setPrototypeOf(mimeTypes, MimeTypeArray.prototype);
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => mimeTypes,
        configurable: true,
      });
    })();`,

    // 3. window.chrome
    `(() => {
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {};
      window.chrome.app = window.chrome.app || {};
    })();`,

    // 4. Permissions.query
    `(() => {
      const originalQuery = window.Permissions.prototype.query;
      window.Permissions.prototype.query = async function (parameters) {
        const name = parameters?.name;
        if (name === 'notifications' || name === 'clipboard-read' || name === 'clipboard-write') {
          return { state: 'prompt', onchange: null };
        }
        return originalQuery.call(this, parameters);
      };
    })();`,

    // 5. Canvas / WebGL noise
    `(() => {
      const noise = () => Math.floor(Math.random() * 2);
      const patchCanvas = (proto, method, noiseFn) => {
        const original = proto[method];
        if (!original) return;
        proto[method] = function (...args) {
          const result = original.apply(this, args);
          if (result && typeof result === 'object' && result.data) {
            for (let i = 0; i < result.data.length; i += 4) {
              result.data[i] = Math.max(0, Math.min(255, result.data[i] + noiseFn()));
            }
          }
          return result;
        };
      };
      patchCanvas(HTMLCanvasElement.prototype, 'getImageData', noise);
      patchCanvas(CanvasRenderingContext2D.prototype, 'getImageData', noise);
      patchCanvas(WebGLRenderingContext.prototype, 'readPixels', () => 0);

      const getParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (pname) {
        if (pname === 37445) return 'Intel Inc.';
        if (pname === 37446) return 'Intel Iris OpenGL Engine';
        return getParam.call(this, pname);
      };
    })();`,
  ];
}

export async function applyStealthToPage(page: IPage): Promise<void> {
  for (const script of getStealthScripts()) {
    await page.evaluate(() => {
      eval(script);
    });
  }
}
