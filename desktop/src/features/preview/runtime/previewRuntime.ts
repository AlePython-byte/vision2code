/**
 * Isolated browser runtime for the sandboxed preview iframe.
 * Implements a lightweight virtual DOM to real DOM reconciler compatible with
 * the deterministic React TSX output of Vision2Code.
 *
 * Guaranteed Security Profile:
 * - Zero network access (no fetch, XMLHttpRequest, WebSocket)
 * - Zero Tauri API exposure (no __TAURI__, invoke)
 * - Zero remote URLs (no http://, https://)
 * - Confined strictly to the iframe execution context
 */

export const PREVIEW_RUNTIME_SOURCE = `
(function() {
  'use strict';

  var Fragment = Symbol.for('react.fragment');

  function createDOMNode(vnode) {
    if (vnode === null || vnode === undefined || typeof vnode === 'boolean') {
      return document.createTextNode('');
    }
    if (typeof vnode === 'string' || typeof vnode === 'number') {
      return document.createTextNode(String(vnode));
    }
    if (Array.isArray(vnode)) {
      var fragment = document.createDocumentFragment();
      for (var i = 0; i < vnode.length; i++) {
        fragment.appendChild(createDOMNode(vnode[i]));
      }
      return fragment;
    }
    if (typeof vnode === 'object' && vnode.type) {
      if (typeof vnode.type === 'function') {
        var props = vnode.props || {};
        var rendered = vnode.type(props);
        return createDOMNode(rendered);
      }
      if (vnode.type === Fragment || vnode.type === '') {
        var frag = document.createDocumentFragment();
        var children = (vnode.props && vnode.props.children) || [];
        var childArray = Array.isArray(children) ? children : [children];
        for (var j = 0; j < childArray.length; j++) {
          frag.appendChild(createDOMNode(childArray[j]));
        }
        return frag;
      }

      var el = document.createElement(vnode.type);
      var p = vnode.props || {};
      for (var key in p) {
        if (!Object.prototype.hasOwnProperty.call(p, key)) continue;
        if (key === 'children' || p[key] === undefined || p[key] === null) continue;
        var val = p[key];
        if (key === 'className') {
          el.className = String(val);
        } else if (key === 'style' && typeof val === 'object') {
          for (var s in val) {
            if (Object.prototype.hasOwnProperty.call(val, s)) {
              el.style[s] = val[s];
            }
          }
        } else if (key === 'value' && (vnode.type === 'input' || vnode.type === 'textarea')) {
          el.value = String(val);
        } else if (key === 'checked' && vnode.type === 'input') {
          el.checked = Boolean(val);
        } else if (key.indexOf('on') === 0 && typeof val === 'function') {
          el.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (key === 'readOnly') {
          if (val) el.setAttribute('readonly', '');
        } else if (key === 'disabled') {
          if (val) el.setAttribute('disabled', '');
        } else {
          el.setAttribute(key, String(val));
        }
      }

      if (p.children !== undefined && p.children !== null) {
        var kids = Array.isArray(p.children) ? p.children : [p.children];
        for (var k = 0; k < kids.length; k++) {
          el.appendChild(createDOMNode(kids[k]));
        }
      }
      return el;
    }
    return document.createTextNode('');
  }

  var React = {
    createElement: function(type, props) {
      var children = [];
      for (var i = 2; i < arguments.length; i++) {
        children.push(arguments[i]);
      }
      var flat = children.length === 1 ? children[0] : (children.length === 0 ? undefined : children);
      var finalProps = {};
      if (props) {
        for (var k in props) {
          if (Object.prototype.hasOwnProperty.call(props, k)) finalProps[k] = props[k];
        }
      }
      if (flat !== undefined && finalProps.children === undefined) {
        finalProps.children = flat;
      }
      return { type: type, props: finalProps };
    },
    Fragment: Fragment,
    useState: function(init) {
      var state = typeof init === 'function' ? init() : init;
      return [state, function() {}];
    },
    useEffect: function(fn) {
      try { fn(); } catch (err) { console.error('Preview effect error:', err); }
    },
    useMemo: function(fn) { return fn(); },
    useCallback: function(fn) { return fn; },
    useRef: function(initial) { return { current: initial }; }
  };

  var ReactDOM = {
    createRoot: function(container) {
      return {
        render: function(vnode) {
          container.innerHTML = '';
          container.appendChild(createDOMNode(vnode));
        },
        unmount: function() {
          container.innerHTML = '';
        }
      };
    }
  };

  window.React = React;
  window.ReactDOM = ReactDOM;

  // Sandboxed module system
  var registry = {};

  function normalizePath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return '';
    var p = rawPath.split(String.fromCharCode(92)).join('/');
    var parts = p.split('/');
    var stack = [];
    for (var i = 0; i < parts.length; i++) {
      var segment = parts[i];
      if (segment === '' || segment === '.') continue;
      if (segment === '..') {
        if (stack.length === 0) {
          throw new Error('Path traversal outside project root: ' + rawPath);
        }
        stack.pop();
      } else {
        stack.push(segment);
      }
    }
    return stack.join('/');
  }

  function resolveRelativeSpecifier(callerPath, specifier) {
    var spec = (specifier || '').split(String.fromCharCode(92)).join('/');
    var isRelative =
      spec.indexOf('./') === 0 ||
      spec.indexOf('../') === 0 ||
      spec === '.' ||
      spec === '..';

    var dirStack = [];
    if (isRelative) {
      var callerNormalized = normalizePath(callerPath);
      var callerParts = callerNormalized.split('/');
      if (callerParts.length > 1) {
        dirStack = callerParts.slice(0, -1);
      }
    }

    var specParts = spec.split('/');
    for (var i = 0; i < specParts.length; i++) {
      var seg = specParts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (dirStack.length === 0) {
          throw new Error('Path traversal outside project root: ' + specifier);
        }
        dirStack.pop();
      } else {
        dirStack.push(seg);
      }
    }
    return dirStack.join('/');
  }

  function resolveModule(callerPath, target) {
    if (target === 'react') return { id: 'react', exports: React };
    if (target === 'react-dom' || target === 'react-dom/client') return { id: 'react-dom', exports: ReactDOM };

    var resolvedPath = resolveRelativeSpecifier(callerPath, target);
    var candidates = [
      resolvedPath,
      resolvedPath + '.ts',
      resolvedPath + '.tsx',
      resolvedPath + '.js',
      resolvedPath + '.jsx',
      resolvedPath + '/index.ts',
      resolvedPath + '/index.tsx',
      resolvedPath + '/index.js',
      resolvedPath + '/index.jsx'
    ];

    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (registry[candidate]) {
        return registry[candidate];
      }
    }
    throw new Error('Module not found: ' + target);
  }

  window.__defineModule__ = function(id, factory) {
    var canonicalId = normalizePath(id);
    registry[canonicalId] = { id: canonicalId, factory: factory, exports: null };
  };

  window.__requireModule__ = function(callerPath, target) {
    var mod = resolveModule(callerPath, target);
    if (!mod.exports) {
      mod.exports = {};
      mod.factory(mod.exports, function(dep) {
        return window.__requireModule__(mod.id, dep);
      });
    }
    return mod.exports;
  };

  window.__resolveModule__ = resolveModule;
  window.__registry__ = registry;

  function initFitToViewport() {
    var stageEl = document.getElementById('preview-stage');
    var shellEl = document.getElementById('preview-viewport-shell');
    var canvasEl = document.getElementById('preview-scaled-canvas');
    var rootEl = document.getElementById('root');
    if (!stageEl || !shellEl || !canvasEl || !rootEl) return;

    function updateFit() {
      var targetEl = rootEl.firstElementChild || rootEl;
      if (!targetEl) return;

      var targetStyle = (typeof window.getComputedStyle === 'function') ? window.getComputedStyle(targetEl) : null;
      var maxW = targetStyle ? parseFloat(targetStyle.maxWidth) : 0;
      var minH = targetStyle ? parseFloat(targetStyle.minHeight) : 0;

      // Natural width determination:
      var contentWidth = (maxW && maxW > 0) ? maxW : Math.max(targetEl.scrollWidth || 0, targetEl.offsetWidth || 0, 1440);
      canvasEl.style.width = contentWidth + 'px';

      // Natural height determination:
      var contentHeight = Math.max(
        targetEl.scrollHeight || 0,
        targetEl.offsetHeight || 0,
        minH || 0,
        1024
      );
      canvasEl.style.height = contentHeight + 'px';

      // Available viewport dimensions:
      var stageWidth = stageEl.clientWidth || stageEl.offsetWidth || (typeof window.innerWidth === 'number' ? window.innerWidth : 800);
      var stageHeight = stageEl.clientHeight || stageEl.offsetHeight || (typeof window.innerHeight === 'number' ? window.innerHeight : 600);

      var padding = 16;
      var effectiveWidth = stageWidth > padding * 2 ? stageWidth - padding * 2 : stageWidth * 0.9;
      var effectiveHeight = stageHeight > padding * 2 ? stageHeight - padding * 2 : stageHeight * 0.9;

      // Fit scale calculation:
      var scaleX = effectiveWidth / contentWidth;
      var scaleY = effectiveHeight / contentHeight;
      var rawScale = Math.min(scaleX, scaleY);

      // Never enlarge in FIT mode, keep aspect ratio strictly preserved
      var scale = Math.max(0.01, Math.min(rawScale, 1));

      var scaledWidth = Math.round(contentWidth * scale * 100) / 100;
      var scaledHeight = Math.round(contentHeight * scale * 100) / 100;

      shellEl.style.width = scaledWidth + 'px';
      shellEl.style.height = scaledHeight + 'px';
      canvasEl.style.transform = 'scale(' + scale + ')';

      window.__currentFitScale__ = scale;
      window.__contentDimensions__ = { width: contentWidth, height: contentHeight };
      window.__scaledDimensions__ = { width: scaledWidth, height: scaledHeight };
    }

    updateFit();

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function() {
        updateFit();
      });
      ro.observe(stageEl);
      if (rootEl.firstElementChild) {
        ro.observe(rootEl.firstElementChild);
      }
    } else if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', updateFit);
    }

    window.__updateFit__ = updateFit;
  }

  window.__mountApp__ = function(entryPath) {
    try {
      var canonicalEntry = normalizePath(entryPath);
      var appModule = window.__requireModule__('', canonicalEntry);
      var App = appModule.default || appModule;
      var rootEl = document.getElementById('root');
      if (!rootEl) throw new Error('Missing root container in preview document');
      ReactDOM.createRoot(rootEl).render(React.createElement(App, null));
      initFitToViewport();
    } catch (err) {
      var container = document.getElementById('root');
      if (container) {
        container.innerHTML = '<div style="padding:24px;font-family:sans-serif;color:#ef4444;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;margin:16px;">' +
          '<h3 style="margin:0 0 8px;font-size:14px;font-weight:600;">Error de ejecución</h3>' +
          '<p style="margin:0;font-size:12px;line-height:1.5;">' + (err && err.message ? String(err.message).replace(/[<>]/g, '') : 'Fallo de ejecución') + '</p>' +
          '</div>';
      }
    }
  };
})();
`;

