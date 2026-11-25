/**
 * Photoedits API v1.0.0
 * ------------------------------------------------------------
 * 纯前端图像编辑 API。无需后端、无需构建工具。
 *
 * 用法：
 *   <script src="https://photoedits.leleleling.site/api/api.js"></script>
 *   <script>
 *     Photoedits.use('png').then(function () {
 *       return Photoedits.png.encode([rgba], w, h, 0);
 *     });
 *   </script>
 *
 * 设计约定：
 *   1. 所有异步方法均返回 Promise。
 *   2. 底层库按需加载（懒加载），加载一次后缓存复用。
 *   3. Photoedits.<module>.<method>() 会自动加载所需库，无需手动 use()。
 *   4. 原始全局对象可通过 Photoedits.raw.<name> 直接访问（加载后）。
 *
 * MIT 许可。底层库版权归各自作者所有，见 api/libs/*.LICENSE.txt。
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var DEFAULT_BASE = 'https://photoedits.leleleling.site/api/';
  var TIMEOUT = 20000;

  /* ------------------------------------------------------------------ *
   * 1. 定位 api.js 所在目录（支持任意域名 / GitHub Pages 子路径）
   * ------------------------------------------------------------------ */
  function detectBase() {
    var script = null;
    try {
      if (document.currentScript && document.currentScript.src) {
        script = document.currentScript;
      }
    } catch (e) { /* ignore */ }

    if (!script) {
      var list = document.getElementsByTagName('script');
      for (var i = list.length - 1; i >= 0; i--) {
        if (/api\.js(?:\?|$)/.test(list[i].src || '')) {
          script = list[i];
          break;
        }
      }
    }

    var src = (script && script.src) || DEFAULT_BASE;
    return src.replace(/\/api\.js(?:\?.*)?$/, '/').replace(/\/?$/, '/');
  }

  var BASE = detectBase();
  var LIBS_DIR = BASE + 'libs/';

  /* ------------------------------------------------------------------ *
   * 2. 模块注册表
   * ------------------------------------------------------------------ */
  var MODULES = {
    png: {
      files: ['UPNG.js'],
      global: 'UPNG',
      label: 'UPNG.js — PNG / APNG 编解码与压缩'
    },
    tiff: {
      files: ['UTIF.js'],
      global: 'UTIF',
      label: 'UTIF.js — TIFF / EXIF / RAW 解码'
    },
    zip: {
      files: ['UZIP.js'],
      global: 'UZIP',
      label: 'UZIP.js — ZIP 打包 / 解包'
    },
    font: {
      files: ['Typr.js', 'Typr.U.js', 'Typr.U.SVG.js'],
      global: 'Typr',
      label: 'Typr.js — TTF / OTF 字体解析与文字转路径'
    },
    nn: {
      files: ['UNN.js', 'UNN.util.js'],
      global: 'UNN',
      label: 'UNN.js — 浏览器端神经网络推理'
    }
  };

  var cache = {};      // name -> Promise<globalObject>
  var loaded = {};     // name -> boolean

  function injectScript(url) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      var settled = false;

      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        el.parentNode && el.parentNode.removeChild(el);
        reject(new Error('[Photoedits] 加载超时: ' + url + ' (' + TIMEOUT + 'ms)'));
      }, TIMEOUT);

      el.src = url;
      el.async = false;
      el.onload = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      el.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        el.parentNode && el.parentNode.removeChild(el);
        reject(new Error('[Photoedits] 加载失败: ' + url + '，请确认资源可访问且未被浏览器插件拦截。'));
      };
      (document.head || document.documentElement).appendChild(el);
    });
  }

  /**
   * 加载一个模块（幂等）。
   * @param {string} name png | tiff | zip | font | nn
   * @returns {Promise<object>} 该模块对应的原始全局对象
   */
  function use(name) {
    var spec = MODULES[name];
    if (!spec) {
      return Promise.reject(new Error('[Photoedits] 未知模块: ' + name + '。可用: ' + Object.keys(MODULES).join(', ')));
    }
    if (cache[name]) return cache[name];

    cache[name] = (function () {
      var chain = Promise.resolve();

      // UPNG 的编码路径调用 pako.deflate()。这里用已加载的 UZIP 提供
      // 的最小兼容实现（zlib 格式：2 字节头 + deflate + adler32），
      // 避免额外引入第三方依赖。
      if (name === 'png') {
        chain = chain.then(function () { return use('zip'); }).then(function () {
          if (!global.pako) {
            global.pako = {
              deflate: function (data, opts) { return global.UZIP.deflate(data, opts); },
              inflate: function (data) { return global.UZIP.inflate(data); }
            };
          }
        });
      }

      spec.files.forEach(function (file) {
        chain = chain.then(function () { return injectScript(LIBS_DIR + file); });
      });
      return chain.then(function () {
        var obj = global[spec.global];
        if (obj == null) {
          throw new Error('[Photoedits] ' + name + ' 已加载但未找到全局变量 ' + spec.global);
        }
        loaded[name] = true;
        return obj;
      });
    })().catch(function (err) {
      delete cache[name]; // 允许重试
      throw err;
    });

    return cache[name];
  }

  /**
   * 预加载全部底层库。
   * @returns {Promise<object>} 各模块原始对象的集合
   */
  function ready() {
    return Promise.all(Object.keys(MODULES).map(use)).then(function (objs) {
      var out = {};
      Object.keys(MODULES).forEach(function (name, i) { out[name] = objs[i]; });
      return out;
    });
  }

  /* ------------------------------------------------------------------ *
   * 3. 通用工具（不依赖任何底层库，立即可用）
   * ------------------------------------------------------------------ */
  function toArrayBuffer(input) {
    if (input instanceof ArrayBuffer) return Promise.resolve(input);
    if (input && input.buffer instanceof ArrayBuffer && !Array.isArray(input)) {
      return Promise.resolve(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    }
    if (input instanceof Blob || input instanceof File) {
      return input.arrayBuffer ? input.arrayBuffer() : new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
        r.readAsArrayBuffer(input);
      });
    }
    return Promise.reject(new TypeError('[Photoedits] 需要 ArrayBuffer / TypedArray / Blob'));
  }

  function arrayBufferToBlob(buffer, type) {
    return new Blob([buffer], { type: type || 'application/octet-stream' });
  }

  function blobToDataURL(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataURL) {
    var parts = String(dataURL).split(',');
    if (parts.length < 2) throw new Error('[Photoedits] 非法 dataURL');
    var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    var bin = atob(parts[1]);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return arrayBufferToBlob(bytes.buffer, mime);
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob instanceof Blob ? blob : arrayBufferToBlob(blob));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return filename;
  }

  function bytesToBase64(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var str = '';
    for (var i = 0; i < arr.length; i += 0x8000) {
      str += String.fromCharCode.apply(null, arr.subarray(i, Math.min(i + 0x8000, arr.length)));
    }
    return btoa(str);
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var utils = {
    toArrayBuffer: toArrayBuffer,
    arrayBufferToBlob: arrayBufferToBlob,
    blobToDataURL: blobToDataURL,
    dataURLToBlob: dataURLToBlob,
    download: download,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    /** 将 ArrayBuffer / Blob / dataURL 统一转成 Blob */
    toBlob: function (input, type) {
      if (input instanceof Blob) return Promise.resolve(input);
      if (typeof input === 'string' && /^data:/.test(input)) return Promise.resolve(dataURLToBlob(input));
      return toArrayBuffer(input).then(function (buf) { return arrayBufferToBlob(buf, type); });
    }
  };

  /* ------------------------------------------------------------------ *
   * 4. Canvas 工具（原生实现，无需底层库）
   * ------------------------------------------------------------------ */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function loadImage(src, crossOrigin) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (crossOrigin !== false) img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('[Photoedits] 图片加载失败: ' + src)); };
      img.src = src;
    });
  }

  function sourceToCanvas(source) {
    if (source && source.tagName === 'CANVAS') return Promise.resolve(source);
    if (typeof source === 'string') return loadImage(source).then(sourceToCanvas);
    if (source instanceof Blob || source instanceof File) return blobToDataURL(source).then(sourceToCanvas);
    if (source && source.tagName === 'IMG') {
      var c = makeCanvas(source.naturalWidth || source.width, source.naturalHeight || source.height);
      c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
      return Promise.resolve(c);
    }
    if (source && source.buffer) return sourceToCanvas(arrayBufferToBlob(source.buffer instanceof ArrayBuffer ? source.buffer : source, 'image/*'));
    return Promise.reject(new TypeError('[Photoedits] 不支持的图像源'));
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('[Photoedits] canvas.toBlob 失败'));
      }, type || 'image/png', quality);
    });
  }

  function withCanvas(source, fn) {
    return sourceToCanvas(source).then(function (canvas) { return fn(canvas); });
  }

  var canvas = {
    create: makeCanvas,
    load: loadImage,
    toCanvas: sourceToCanvas,
    toBlob: canvasToBlob,
    toDataURL: function (source, type, quality) {
      return sourceToCanvas(source).then(function (c) { return c.toDataURL(type || 'image/png', quality); });
    },
    getImageData: function (source) {
      return sourceToCanvas(source).then(function (c) {
        return c.getContext('2d').getImageData(0, 0, c.width, c.height);
      });
    },
    putImageData: function (imageData) {
      var c = makeCanvas(imageData.width, imageData.height);
      c.getContext('2d').putImageData(imageData, 0, 0);
      return c;
    },
    resize: function (source, width, height, opts) {
      opts = opts || {};
      return withCanvas(source, function (c) {
        var out = makeCanvas(width, height);
        var ctx = out.getContext('2d');
        if (opts.smooth !== false) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = opts.quality || 'high';
        } else {
          ctx.imageSmoothingEnabled = false;
        }
        ctx.drawImage(c, 0, 0, width, height);
        return out;
      });
    },
    crop: function (source, x, y, width, height) {
      return withCanvas(source, function (c) {
        var out = makeCanvas(width, height);
        out.getContext('2d').drawImage(c, x, y, width, height, 0, 0, width, height);
        return out;
      });
    },
    rotate: function (source, degrees, bg) {
      return withCanvas(source, function (c) {
        var rad = degrees * Math.PI / 180;
        var cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
        var w = Math.round(c.width * cos + c.height * sin);
        var h = Math.round(c.width * sin + c.height * cos);
        var out = makeCanvas(w, h);
        var ctx = out.getContext('2d');
        if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
        ctx.translate(w / 2, h / 2);
        ctx.rotate(rad);
        ctx.drawImage(c, -c.width / 2, -c.height / 2);
        return out;
      });
    },
    flip: function (source, direction) {
      return withCanvas(source, function (c) {
        var out = makeCanvas(c.width, c.height);
        var ctx = out.getContext('2d');
        ctx.translate(direction === 'y' || direction === 'vertical' ? 0 : c.width, direction === 'y' || direction === 'vertical' ? c.height : 0);
        ctx.scale(direction === 'y' || direction === 'vertical' ? 1 : -1, direction === 'y' || direction === 'vertical' ? -1 : 1);
        ctx.drawImage(c, 0, 0);
        return out;
      });
    },
    /** 一键滤镜: grayscale | sepia | invert | blur(Npx) | brightness(N%) | contrast(N%) | saturate(N%) | hue-rotate(Ndeg) */
    filter: function (source, cssFilter) {
      return withCanvas(source, function (c) {
        var out = makeCanvas(c.width, c.height);
        var ctx = out.getContext('2d');
        ctx.filter = cssFilter || 'none';
        ctx.drawImage(c, 0, 0);
        return out;
      });
    },
    /** 图片水印 / 叠加文字 */
    watermark: function (source, text, opts) {
      opts = opts || {};
      return withCanvas(source, function (c) {
        var out = makeCanvas(c.width, c.height);
        var ctx = out.getContext('2d');
        ctx.drawImage(c, 0, 0);
        ctx.font = opts.font || '20px sans-serif';
        ctx.fillStyle = opts.color || 'rgba(255,255,255,0.75)';
        ctx.textAlign = opts.align || 'right';
        ctx.textBaseline = opts.baseline || 'bottom';
        var x = opts.x != null ? opts.x : c.width - 12;
        var y = opts.y != null ? opts.y : c.height - 12;
        ctx.fillText(text, x, y);
        return out;
      });
    }
  };

  /* ------------------------------------------------------------------ *
   * 5. 底层模块代理（自动 use + Promise 化）
   * ------------------------------------------------------------------ */
  function proxy(name, methods) {
    var api = {};
    Object.keys(methods).forEach(function (key) {
      var realName = methods[key];
      api[key] = function () {
        var args = arguments;
        return use(name).then(function (lib) {
          var fn = lib[realName];
          if (typeof fn !== 'function') {
            throw new Error('[Photoedits] ' + name + ' 不存在方法 ' + realName);
          }
          return fn.apply(lib, args);
        });
      };
    });
    return api;
  }

  var png = proxy('png', {
    encode: 'encode',
    encodeLL: 'encodeLL',
    decode: 'decode',
    toRGBA8: 'toRGBA8',
    quantize: 'quantize'
  });

  // PNG 高层组合方法
  png.minify = function (arrayBuffer, colors, dels) {
    return utils.toArrayBuffer(arrayBuffer).then(function (buf) {
      return png.decode(buf).then(function (img) {
        var frames = png.toRGBA8(img);
        return png.encode(frames, img.width, img.height, colors == null ? 256 : colors, dels);
      });
    });
  };
  png.fromCanvas = function (source, colors, dels) {
    return canvas.getImageData(source).then(function (data) {
      return png.encode([data.data.buffer], data.width, data.height, colors == null ? 0 : colors, dels);
    });
  };
  png.toBlob = function (source, colors, dels) {
    return png.fromCanvas(source, colors, dels).then(function (buf) {
      return arrayBufferToBlob(buf, 'image/png');
    });
  };

  var tiff = proxy('tiff', {
    decode: 'decode',
    decodeImage: 'decodeImage',
    toRGBA8: 'toRGBA8',
    encodeImage: 'encodeImage',
    encode: 'encode',
    replaceIMG: 'replaceIMG',
    bufferToURI: 'bufferToURI'
  });

  tiff.toCanvas = function (arrayBuffer, index, options) {
    options = options || {};
    return utils.toArrayBuffer(arrayBuffer).then(function (buf) {
      return use('tiff').then(function (T) {
        var ifds = T.decode(buf, options.decodeOptions);
        var target = ifds[index || 0];
        if (!target) throw new Error('[Photoedits] TIFF 中没有图像 IFD');
        T.decodeImage(buf, target, ifds);
        var rgba = T.toRGBA8(target, options.scale);
        var imgData = new ImageData(new Uint8ClampedArray(rgba), target.width, target.height);
        return canvas.putImageData(imgData);
      });
    });
  };

  var zip = proxy('zip', {
    encode: 'encode',
    decode: 'parse',
    parse: 'parse',
    deflate: 'deflate',
    deflateRaw: 'deflateRaw',
    inflate: 'inflate',
    inflateRaw: 'inflateRaw'
  });

  var font = proxy('font', { parse: 'parse' });

  font.use = function () { return use('font').then(function (T) { return T.U; }); };
  font.codeToGlyph = function (f, code) { return font.use().then(function (U) { return U.codeToGlyph(f, code); }); };
  font.glyphToPath = function (f, glyph) { return font.use().then(function (U) { return U.glyphToPath(f, glyph); }); };
  font.shapeToPath = function (f, text, prm) { return font.use().then(function (U) { return U.shapeToPath(f, text, prm); }); };
  font.pathToSVG = function (path) { return font.use().then(function (U) { return U.pathToSVG(path); }); };
  font.svgToPath = function (svg) {
    return use('font').then(function (T) { return T.U.SVG.svgToPath(svg); });
  };
  /** 文件 -> 字体对象 */
  font.load = function (arrayBuffer) {
    return utils.toArrayBuffer(arrayBuffer).then(function (buf) {
      return font.parse(buf).then(function (fonts) { return fonts[0]; });
    });
  };
  /** 文本 -> SVG 路径字符串（一步到位） */
  font.textToSVG = function (arrayBuffer, text, options) {
    options = options || {};
    return font.load(arrayBuffer).then(function (f) {
      return font.shapeToPath(f, text, options.prm).then(function (path) {
        return font.pathToSVG(path);
      });
    });
  };

  var nn = proxy('nn', {
    create: 'Create',
    train: 'Train',
    clone: 'clone',
    getError: 'GetError',
    getDeltas: 'GetDeltas'
  });

  // UNN.GetOutput 要求第三个参数 Os（输出缓冲区），这里补齐默认值
  nn.run = function (net, input, output) {
    return use('nn').then(function (N) {
      return N.GetOutput(net, input, output || []);
    });
  };

  nn.util = function () { return use('nn').then(function (N) { return N.util; }); };
  nn.weightCount = function (net) { return nn.util().then(function (u) { return u.weightCount(net); }); };
  nn.fromConvNetJS = function (json) { return nn.util().then(function (u) { return u.fromCNJS(json); }); };
  nn.fromCaffe = function (prototxt, model) { return nn.util().then(function (u) { return u.fromCaffe(prototxt, model); }); };

  /* ------------------------------------------------------------------ *
   * 6. 导出
   * ------------------------------------------------------------------ */
  var Photoedits = {
    version: VERSION,
    baseUrl: BASE,
    modules: Object.keys(MODULES),
    use: use,
    ready: ready,
    isLoaded: function (name) { return !!loaded[name]; },

    utils: utils,
    canvas: canvas,
    png: png,
    tiff: tiff,
    zip: zip,
    font: font,
    nn: nn,

    /** 直接访问原始全局库（需先 use/ready） */
    raw: {
      get UPNG() { return global.UPNG; },
      get UTIF() { return global.UTIF; },
      get UZIP() { return global.UZIP; },
      get Typr() { return global.Typr; },
      get UNN() { return global.UNN; }
    },

    config: {
      baseUrl: function (url) {
        BASE = String(url).replace(/\/?$/, '/');
        LIBS_DIR = BASE + 'libs/';
        // 清空缓存以便用新地址重新加载
        cache = {};
        loaded = {};
        return Photoedits;
      },
      timeout: function (ms) { TIMEOUT = Math.max(1000, ms | 0); return Photoedits; }
    }
  };

  global.Photoedits = Photoedits;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Photoedits;
  }
})(typeof window !== 'undefined' ? window : this);
