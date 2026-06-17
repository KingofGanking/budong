(() => {
  const canvas = document.querySelector("#smokey-cursor-canvas");
  const incenseEmber = document.querySelector(".incense-nav-ember");
  if (!canvas || !incenseEmber || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const config = {
    SIM_RESOLUTION: 96,
    DYE_RESOLUTION: 720,
    DENSITY_DISSIPATION: 3.8,
    VELOCITY_DISSIPATION: 2.2,
    PRESSURE: 0.1,
    PRESSURE_ITERATIONS: 14,
    CURL: 4,
    SPLAT_RADIUS: 0.18,
    SPLAT_FORCE: 4200,
    SHADING: true,
  };

  const pointer = {
    texcoordX: 0,
    texcoordY: 0,
    prevTexcoordX: 0,
    prevTexcoordY: 0,
    deltaX: 0,
    deltaY: 0,
    moved: false,
    color: { r: 0.18, g: 0.2, b: 0.16 },
  };
  const emitter = {
    texcoordX: 0,
    texcoordY: 0,
    prevTexcoordX: 0,
    prevTexcoordY: 0,
    initialized: false,
    timer: 0,
    hue: Math.random(),
    wind: 0,
  };

  const params = {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  };
  const gl = canvas.getContext("webgl2", params) || canvas.getContext("webgl", params);
  if (!gl) return;

  const isWebGL2 = "drawBuffers" in gl;
  let supportLinearFiltering = false;
  let halfFloat = null;
  if (isWebGL2) {
    gl.getExtension("EXT_color_buffer_float");
    supportLinearFiltering = !!gl.getExtension("OES_texture_float_linear");
  } else {
    halfFloat = gl.getExtension("OES_texture_half_float");
    supportLinearFiltering = !!gl.getExtension("OES_texture_half_float_linear");
  }

  const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat && halfFloat.HALF_FLOAT_OES;
  if (!halfFloatTexType) return;

  const supportRenderTextureFormat = (internalFormat, format, type) => {
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) return false;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  };

  const getSupportedFormat = (internalFormat, format, type) => {
    if (supportRenderTextureFormat(internalFormat, format, type)) return { internalFormat, format };
    if (!isWebGL2) return null;
    if (internalFormat === gl.R16F) return getSupportedFormat(gl.RG16F, gl.RG, type);
    if (internalFormat === gl.RG16F) return getSupportedFormat(gl.RGBA16F, gl.RGBA, type);
    return null;
  };

  const ext = {
    formatRGBA: isWebGL2
      ? getSupportedFormat(gl.RGBA16F, gl.RGBA, halfFloatTexType)
      : getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType),
    formatRG: isWebGL2
      ? getSupportedFormat(gl.RG16F, gl.RG, halfFloatTexType)
      : getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType),
    formatR: isWebGL2
      ? getSupportedFormat(gl.R16F, gl.RED, halfFloatTexType)
      : getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType),
    halfFloatTexType,
    supportLinearFiltering,
  };
  if (!ext.formatRGBA || !ext.formatRG || !ext.formatR) return;
  if (!supportLinearFiltering) {
    config.DYE_RESOLUTION = 256;
    config.SHADING = false;
  }

  const compileShader = (type, source, keywords = []) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    const prefix = keywords.map((keyword) => `#define ${keyword}\n`).join("");
    gl.shaderSource(shader, prefix + source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader));
    }
    return shader;
  };

  const createProgram = (vertexShader, fragmentShader) => {
    const program = gl.createProgram();
    if (!program || !vertexShader || !fragmentShader) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(program));
    }
    return program;
  };

  const getUniforms = (program) => {
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return uniforms;
  };

  class Program {
    constructor(vertexShader, fragmentShader) {
      this.program = createProgram(vertexShader, fragmentShader);
      this.uniforms = this.program ? getUniforms(this.program) : {};
    }
    bind() {
      if (this.program) gl.useProgram(this.program);
    }
  }

  const baseVertexShader = compileShader(
    gl.VERTEX_SHADER,
    `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
    `,
  );

  const copyProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      void main () { gl_FragColor = texture2D(uTexture, vUv); }
      `,
    ),
  );

  const clearProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
      `,
    ),
  );

  const displayProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      uniform vec2 texelSize;

      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        #ifdef SHADING
          vec3 lc = texture2D(uTexture, vL).rgb;
          vec3 rc = texture2D(uTexture, vR).rgb;
          vec3 tc = texture2D(uTexture, vT).rgb;
          vec3 bc = texture2D(uTexture, vB).rgb;
          float dx = length(rc) - length(lc);
          float dy = length(tc) - length(bc);
          vec3 n = normalize(vec3(dx, dy, length(texelSize)));
          c *= clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.72, 0.72, 1.0);
        #endif
        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a * 0.82);
      }
      `,
      config.SHADING ? ["SHADING"] : [],
    ),
  );

  const splatProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
      `,
    ),
  );

  const advectionProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform vec2 dyeTexelSize;
      uniform float dt;
      uniform float dissipation;

      vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;
        vec2 iuv = floor(st);
        vec2 fuv = fract(st);
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
      }

      void main () {
        #ifdef MANUAL_FILTERING
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          vec4 result = texture2D(uSource, coord);
        #endif
        gl_FragColor = result / (1.0 + dissipation * dt);
      }
      `,
      ext.supportLinearFiltering ? [] : ["MANUAL_FILTERING"],
    ),
  );

  const divergenceProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x;
        if (vR.x > 1.0) R = -C.x;
        if (vT.y > 1.0) T = -C.y;
        if (vB.y < 0.0) B = -C.y;
        gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
      }
      `,
    ),
  );

  const curlProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
      }
      `,
    ),
  );

  const vorticityProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;
      void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 velocity = texture2D(uVelocity, vUv).xy + force * dt;
        gl_FragColor = vec4(clamp(velocity, -1000.0, 1000.0), 0.0, 1.0);
      }
      `,
    ),
  );

  const pressureProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float divergence = texture2D(uDivergence, vUv).x;
        gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
      }
      `,
    ),
  );

  const gradientSubtractProgram = new Program(
    baseVertexShader,
    compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
      `,
    ),
  );

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  const elemBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elemBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  const blit = (target, clear = false) => {
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    if (clear) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };

  const createFBO = (w, h, internalFormat, format, type, param) => {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  };

  const createDoubleFBO = (w, h, internalFormat, format, type, param) => {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w,
      height: h,
      texelSizeX: fbo1.texelSizeX,
      texelSizeY: fbo1.texelSizeY,
      get read() {
        return fbo1;
      },
      set read(value) {
        fbo1 = value;
      },
      get write() {
        return fbo2;
      },
      set write(value) {
        fbo2 = value;
      },
      swap() {
        const temp = fbo1;
        fbo1 = fbo2;
        fbo2 = temp;
      },
    };
  };

  const getResolution = (resolution) => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const aspect = Math.max(w / h, h / w);
    const min = Math.round(resolution);
    const max = Math.round(resolution * aspect);
    return w > h ? { width: max, height: min } : { width: min, height: max };
  };

  let dye;
  let velocity;
  let divergence;
  let curlFBO;
  let pressure;
  let lastTime = Date.now();
  let rafId = null;

  const resizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(canvas.clientWidth * dpr);
    const height = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    return true;
  };

  const initFramebuffers = () => {
    const simRes = getResolution(config.SIM_RESOLUTION);
    const dyeRes = getResolution(config.DYE_RESOLUTION);
    const texType = ext.halfFloatTexType;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    dye = createDoubleFBO(dyeRes.width, dyeRes.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, texType, filtering);
    velocity = createDoubleFBO(simRes.width, simRes.height, ext.formatRG.internalFormat, ext.formatRG.format, texType, filtering);
    divergence = createFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, texType, gl.NEAREST);
    curlFBO = createFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, texType, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, texType, gl.NEAREST);
  };

  const correctRadius = (radius) => {
    const aspectRatio = canvas.width / canvas.height;
    return aspectRatio > 1 ? radius * aspectRatio : radius;
  };

  const splat = (x, y, dx, dy, color) => {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  };

  const random = (min, max) => min + Math.random() * (max - min);

  const HSVtoRGB = (h, s, v) => {
    let r = 0;
    let g = 0;
    let b = 0;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return { r, g, b };
  };

  const updateEmitterFromEmber = () => {
    const rect = incenseEmber.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const x = (rect.left + rect.width * 0.5) * dpr;
    const y = (rect.top + rect.height * 0.5) * dpr;

    emitter.prevTexcoordX = emitter.initialized ? emitter.texcoordX : x / canvas.width;
    emitter.prevTexcoordY = emitter.initialized ? emitter.texcoordY : 1 - y / canvas.height;
    emitter.texcoordX = x / canvas.width;
    emitter.texcoordY = 1 - y / canvas.height;
    emitter.initialized = true;
  };

  const incenseColor = () => {
    emitter.hue = (emitter.hue + random(0.004, 0.012)) % 1;
    const c = HSVtoRGB((emitter.hue + random(-0.02, 0.02) + 1) % 1, 0.92, 1);
    return {
      r: c.r * 0.16,
      g: c.g * 0.16,
      b: c.b * 0.16,
    };
  };

  const emitFromIncense = (dt) => {
    updateEmitterFromEmber();
    emitter.wind = Math.max(0, emitter.wind - dt * 0.9);
    emitter.timer += dt;

    const movedX = emitter.texcoordX - emitter.prevTexcoordX;
    const movedY = emitter.texcoordY - emitter.prevTexcoordY;
    const moved = Math.hypot(movedX, movedY);
    if (moved > 0.00005) {
      emitter.wind = Math.min(1, emitter.wind + moved * 72);
    }

    const interval = emitter.wind > 0.05 ? 0.045 : 0.09;
    if (emitter.timer < interval) return;
    emitter.timer = 0;

    const driftX = -random(0.008, 0.026) * config.SPLAT_FORCE * (0.45 + emitter.wind);
    const riseY = random(0.01, 0.025) * config.SPLAT_FORCE;
    const motionX = movedX * config.SPLAT_FORCE * 1.8;
    const motionY = movedY * config.SPLAT_FORCE * 1.8;

    splat(
      emitter.texcoordX + random(-0.0012, 0.0012),
      emitter.texcoordY + random(-0.001, 0.001),
      driftX + motionX,
      riseY + motionY + random(-18, 18),
      incenseColor(),
    );
  };

  const updatePointerMoveData = (x, y) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const posX = x * dpr;
    const posY = y * dpr;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1 - posY / canvas.height;
    pointer.deltaX = pointer.texcoordX - pointer.prevTexcoordX;
    pointer.deltaY = pointer.texcoordY - pointer.prevTexcoordY;
    if (canvas.width / canvas.height < 1) pointer.deltaX *= canvas.width / canvas.height;
    if (canvas.width / canvas.height > 1) pointer.deltaY /= canvas.width / canvas.height;
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
    pointer.color = { r: 0.16, g: 0.18, b: 0.145 };
  };

  const step = (dt) => {
    gl.disable(gl.BLEND);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curlFBO);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressure.write);
    pressure.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i += 1) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    gradientSubtractProgram.bind();
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    const velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    if (!ext.supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
  };

  const drawDisplay = () => {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    displayProgram.bind();
    if (config.SHADING) gl.uniform2f(displayProgram.uniforms.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
    blit(null, true);
  };

  const tick = () => {
    const now = Date.now();
    const dt = Math.min((now - lastTime) / 1000, 0.016666);
    lastTime = now;
    if (resizeCanvas()) initFramebuffers();
    emitFromIncense(dt);
    step(dt);
    drawDisplay();
    rafId = requestAnimationFrame(tick);
  };

  const start = () => {
    if (rafId) return;
    lastTime = Date.now();
    tick();
  };

  resizeCanvas();
  initFramebuffers();
  updateEmitterFromEmber();
  start();

  window.addEventListener("resize", () => {
    resizeCanvas();
    initFramebuffers();
    updateEmitterFromEmber();
  });
})();
