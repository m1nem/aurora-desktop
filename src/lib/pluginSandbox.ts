// AURORA_PATCH: sandboxed community plugin frame v2
//
// Community plugins never execute in the main WebView document and never in
// the Rust process. Each plugin runs inside an iframe with
// `sandbox="allow-scripts"`, which gives it a unique opaque origin. The frame
// has a Content-Security-Policy that blocks every network request. Only a
// small postMessage host bridge is exposed.

export const PLUGIN_STORAGE_PREFIX = 'aurora-plugin:';

export const MAX_PLUGIN_STORAGE_KEY_LENGTH = 200;
export const MAX_PLUGIN_STORAGE_VALUE_LENGTH = 100_000;

const SHADOWED_GLOBALS = [
  'window',
  'self',
  'globalThis',
  'global',
  'document',
  'top',
  'parent',
  'frames',
  'opener',
  'location',
  'navigator',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'importScripts',
  'caches',
  'Function',
  'require',
  'process',
  'alert',
  'confirm',
  'prompt',
  'open',
  'postMessage',
] as const;

export function safePluginStorageKey(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  const value = key.trim();
  if (!value || value.length > MAX_PLUGIN_STORAGE_KEY_LENGTH) return null;
  return value;
}

export function pluginStoragePrefix(pluginId: string): string {
  return `${PLUGIN_STORAGE_PREFIX}${pluginId}:`;
}

function escapeForScript(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * The iframe bootstrap. The plugin source is delivered over postMessage and
 * compiled with the same `init(hostAPI)` contract as the original app.
 */
export function createPluginFrameDocument(pluginId: string): string {
  const id = escapeForScript(pluginId);
  const args = SHADOWED_GLOBALS.map((name) => `'${name}'`).join(',');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
</head>
<body>
<script>
(function () {
  'use strict';
  var CHANNEL = 'aurora-plugin';
  var PLUGIN_ID = '${id}';
  var state = { track: null, storage: {} };
  var started = false;
  var dispose = null;

  function post(type, payload) {
    var message = { channel: CHANNEL, pluginId: PLUGIN_ID, type: type };
    if (payload) {
      for (var key in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) message[key] = payload[key];
      }
    }
    try { window.parent.postMessage(message, '*'); } catch (error) {}
  }

  function safeKey(key) {
    if (typeof key !== 'string') return null;
    var value = key.trim();
    if (!value || value.length > 200) return null;
    return value;
  }

  function boot(source) {
    if (started) return;
    started = true;

    var hostAPI = Object.freeze({
      player: Object.freeze({
        play: function () { post('player.play'); },
        pause: function () { post('player.pause'); },
        next: function () { post('player.next'); },
        getCurrentTrack: function () { return state.track; }
      }),
      ui: Object.freeze({
        showToast: function (message) {
          var text = typeof message === 'string' ? message.trim().slice(0, 500) : '';
          if (text) post('ui.showToast', { message: text });
        }
      }),
      storage: Object.freeze({
        getItem: function (key) {
          var safe = safeKey(key);
          if (!safe) return null;
          return Object.prototype.hasOwnProperty.call(state.storage, safe)
            ? state.storage[safe]
            : null;
        },
        setItem: function (key, value) {
          var safe = safeKey(key);
          if (!safe) return;
          var text = typeof value === 'string' ? value : String(value == null ? '' : value);
          if (text.length > 100000) return;
          state.storage[safe] = text;
          post('storage.set', { key: safe, value: text });
        }
      })
    });

    try {
      var factory = new Function(
        'hostAPI',
        ${args},
        '"use strict";\\n' +
          'const module = { exports: {} };\\n' +
          'const exports = module.exports;\\n' +
          source +
          '\\nlet __auroraPluginInit = null;\\n' +
          'if (typeof init === "function") { __auroraPluginInit = init; }\\n' +
          'else if (typeof module.exports === "function") { __auroraPluginInit = module.exports; }\\n' +
          'else if (module.exports && typeof module.exports.init === "function") { __auroraPluginInit = module.exports.init; }\\n' +
          'if (typeof __auroraPluginInit !== "function") { throw new Error("Plugin must define init(hostAPI) or export it through module.exports.init."); }\\n' +
          'return __auroraPluginInit(hostAPI);'
      );

      var result = factory.apply(
        null,
        [hostAPI].concat(new Array(${SHADOWED_GLOBALS.length}))
      );

      if (typeof result === 'function') {
        dispose = result;
      } else if (result && typeof result.dispose === 'function') {
        dispose = function () { result.dispose(); };
      } else if (result && typeof result.destroy === 'function') {
        dispose = function () { result.destroy(); };
      }

      Promise.resolve(result).then(function () {
        post('ready');
      }, function (error) {
        post('error', { message: String((error && error.message) || error) });
      });
    } catch (error) {
      post('error', { message: String((error && error.message) || error) });
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.channel !== CHANNEL || message.pluginId !== PLUGIN_ID) return;

    if (message.type === 'load') {
      state.track = message.track || null;
      state.storage = message.storage && typeof message.storage === 'object'
        ? message.storage
        : {};
      boot(String(message.source || ''));
    } else if (message.type === 'track') {
      state.track = message.track || null;
    } else if (message.type === 'shutdown') {
      try {
        if (dispose) dispose();
      } catch (error) {}
      post('disposed');
    }
  });

  post('frame-ready');
})();
</script>
</body>
</html>`;
}
