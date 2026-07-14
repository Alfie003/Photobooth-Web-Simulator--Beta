/* ============================================================
   filters.js  —  WebGL Aesthetic Filter Engine
   ============================================================
   Architecture:
   - One WebGL context on #glCanvas renders the live preview
     at ~60fps by uploading each video frame as a texture.
   - A single GLSL fragment shader implements every effect:
     color matrix, lifted blacks, bloom, film grain, vignette,
     tint overlays, and curve-style tone mapping.
   - Each filter is a plain JS object (AESTHETIC_FILTERS) whose
     properties are passed as WebGL uniforms — no shader recompile
     needed when switching filters.
   - captureFilteredFrame() reads pixels back from the WebGL canvas
     (preserveDrawingBuffer:true) so capture is zero-cost.
   ============================================================ */

'use strict';

// ── Aesthetic Filter Definitions ─────────────────────────────
//
// Each entry maps 1:1 to uniforms in the GLSL shader below.
// Tweak these values to adjust looks without touching GLSL.
//
// brightness   -1.0 → 1.0   (0 = unchanged)
// contrast     0.5 → 2.0    (1 = unchanged)
// saturation   0.0 → 2.0    (1 = unchanged)
// tintRGB      [r,g,b]  0–1  color tint (mixed at tintStrength)
// tintStrength 0.0 → 0.3    how much tint overlays the image
// liftRGB      [r,g,b]  shadow color lift (Korean-style)
// liftAmount   0.0 → 0.25   how much blacks are raised
// vignetteStr  0.0 → 1.5    vignette darkness
// grainAmount  0.0 → 0.12   film grain intensity
// bloomStr     0.0 → 1.0    bloom / soft-glow strength
// fadeAmount   0.0 → 0.4    fades blacks toward grey (matte finish)
// warmth       -0.15 → 0.15 warm (+) or cool (-) color shift
// overexpose   0.0 → 0.4    Y2K overexposure flash boost

const AESTHETIC_FILTERS = [
  {
    id: 'none',
    label: 'None',
    icon: '',
    brightness: 0, contrast: 1, saturation: 1,
    tintRGB: [1,1,1], tintStrength: 0,
    liftRGB: [0,0,0], liftAmount: 0,
    vignetteStr: 0, grainAmount: 0, bloomStr: 0,
    fadeAmount: 0, warmth: 0, overexpose: 0,
  },
  {
    id: 'korean',
    label: 'Korean Studio',
    icon: '',
    // Bright whites, soft skin, slight pink tint, reduced contrast
    brightness: 0.12, contrast: 0.82, saturation: 0.85,
    tintRGB: [1.0, 0.88, 0.92], tintStrength: 0.10,
    liftRGB: [0.94, 0.90, 0.95], liftAmount: 0.18,
    vignetteStr: 0.25, grainAmount: 0.01, bloomStr: 0.45,
    fadeAmount: 0.08, warmth: 0.02, overexpose: 0,
  },
  {
    id: 'dreamy',
    label: 'Dreamy Pastel',
    icon: '',
    // Lower contrast, lifted shadows, soft pink-blue
    brightness: 0.08, contrast: 0.78, saturation: 0.75,
    tintRGB: [0.95, 0.88, 1.0], tintStrength: 0.12,
    liftRGB: [0.90, 0.88, 0.98], liftAmount: 0.20,
    vignetteStr: 0.15, grainAmount: 0.008, bloomStr: 0.60,
    fadeAmount: 0.14, warmth: -0.03, overexpose: 0,
  },
  {
    id: 'y2k',
    label: 'Y2K Flash',
    icon: '',
    // Flash effect, cool whites, slight overexposure
    brightness: 0.18, contrast: 1.05, saturation: 1.1,
    tintRGB: [0.90, 0.94, 1.0], tintStrength: 0.08,
    liftRGB: [0.85, 0.88, 0.96], liftAmount: 0.08,
    vignetteStr: 0.10, grainAmount: 0.025, bloomStr: 0.30,
    fadeAmount: 0.04, warmth: -0.10, overexpose: 0.22,
  },
  {
    id: 'vintage',
    label: 'Vintage Film',
    icon: '',
    // Grain, warm highlights, faded blacks
    brightness: -0.04, contrast: 0.92, saturation: 0.80,
    tintRGB: [1.0, 0.95, 0.80], tintStrength: 0.12,
    liftRGB: [0.18, 0.12, 0.06], liftAmount: 0.14,
    vignetteStr: 0.70, grainAmount: 0.09, bloomStr: 0.10,
    fadeAmount: 0.16, warmth: 0.10, overexpose: 0,
  },
  {
    id: 'coquette',
    label: 'Coquette',
    icon: '',
    // Pink highlights, soft glow, desaturated shadows
    brightness: 0.06, contrast: 0.88, saturation: 0.78,
    tintRGB: [1.0, 0.82, 0.88], tintStrength: 0.14,
    liftRGB: [0.30, 0.20, 0.25], liftAmount: 0.06,
    vignetteStr: 0.35, grainAmount: 0.012, bloomStr: 0.55,
    fadeAmount: 0.10, warmth: 0.05, overexpose: 0,
  },
  {
    id: 'cloudcore',
    label: 'Cloudcore',
    icon: '',
    // Muted colors, soft contrast, matte finish
    brightness: 0.05, contrast: 0.80, saturation: 0.60,
    tintRGB: [0.92, 0.94, 1.0], tintStrength: 0.09,
    liftRGB: [0.50, 0.52, 0.56], liftAmount: 0.16,
    vignetteStr: 0.20, grainAmount: 0.018, bloomStr: 0.20,
    fadeAmount: 0.22, warmth: -0.04, overexpose: 0,
  },
  {
    id: 'milktea',
    label: 'Milk Tea',
    icon: '',
    // Warm beige tones, lifted blacks, creamy feel
    brightness: 0.06, contrast: 0.88, saturation: 0.72,
    tintRGB: [1.0, 0.93, 0.82], tintStrength: 0.13,
    liftRGB: [0.20, 0.16, 0.10], liftAmount: 0.17,
    vignetteStr: 0.40, grainAmount: 0.03, bloomStr: 0.20,
    fadeAmount: 0.18, warmth: 0.12, overexpose: 0,
  },
  {
    id: 'cherry',
    label: 'Cherry Blossom',
    icon: '',
    // Warm pink, high brightness, soft pastels
    brightness: 0.14, contrast: 0.84, saturation: 0.90,
    tintRGB: [1.0, 0.85, 0.90], tintStrength: 0.16,
    liftRGB: [0.95, 0.88, 0.90], liftAmount: 0.14,
    vignetteStr: 0.18, grainAmount: 0.006, bloomStr: 0.50,
    fadeAmount: 0.10, warmth: 0.06, overexpose: 0,
  },
  {
    id: 'tokyo_night',
    label: 'Tokyo Night',
    icon: '',
    // Deep contrast, cool purple shadows, neon tint
    brightness: -0.08, contrast: 1.15, saturation: 1.20,
    tintRGB: [0.80, 0.75, 1.0], tintStrength: 0.12,
    liftRGB: [0.05, 0.03, 0.15], liftAmount: 0.05,
    vignetteStr: 0.90, grainAmount: 0.022, bloomStr: 0.35,
    fadeAmount: 0.02, warmth: -0.08, overexpose: 0,
  },
  {
    id: 'warm_summer',
    label: 'Warm Summer',
    icon: '',
    // Golden hour, warm saturated, slight haze
    brightness: 0.10, contrast: 1.02, saturation: 1.15,
    tintRGB: [1.0, 0.92, 0.70], tintStrength: 0.11,
    liftRGB: [0.12, 0.08, 0.02], liftAmount: 0.09,
    vignetteStr: 0.45, grainAmount: 0.02, bloomStr: 0.25,
    fadeAmount: 0.06, warmth: 0.14, overexpose: 0.05,
  },
  {
    id: 'mocha',
    label: 'Mocha',
    icon: '',
    // Deep warm browns, lifted shadows, matte
    brightness: -0.02, contrast: 0.90, saturation: 0.70,
    tintRGB: [1.0, 0.88, 0.72], tintStrength: 0.14,
    liftRGB: [0.22, 0.14, 0.08], liftAmount: 0.14,
    vignetteStr: 0.60, grainAmount: 0.04, bloomStr: 0.08,
    fadeAmount: 0.20, warmth: 0.13, overexpose: 0,
  },
  {
    id: 'soft_pink',
    label: 'Soft Pink',
    icon: '',
    // Very soft, high-key, pink everything
    brightness: 0.16, contrast: 0.76, saturation: 0.68,
    tintRGB: [1.0, 0.84, 0.88], tintStrength: 0.18,
    liftRGB: [0.96, 0.88, 0.90], liftAmount: 0.22,
    vignetteStr: 0.10, grainAmount: 0.004, bloomStr: 0.65,
    fadeAmount: 0.16, warmth: 0.04, overexpose: 0,
  },
  {
    id: 'film2000',
    label: 'Film 2000',
    icon: '',
    // Disposable camera: grain, slight red push, faded
    brightness: 0.04, contrast: 0.94, saturation: 0.92,
    tintRGB: [1.0, 0.94, 0.86], tintStrength: 0.09,
    liftRGB: [0.14, 0.10, 0.06], liftAmount: 0.12,
    vignetteStr: 0.55, grainAmount: 0.10, bloomStr: 0.05,
    fadeAmount: 0.14, warmth: 0.08, overexpose: 0.06,
  },
  {
    id: 'tokyo_cafe',
    label: 'Tokyo Cafe',
    icon: '',
    // Muted greens, low saturation, airy and clean
    brightness: 0.08, contrast: 0.86, saturation: 0.65,
    tintRGB: [0.90, 0.96, 0.88], tintStrength: 0.10,
    liftRGB: [0.40, 0.44, 0.38], liftAmount: 0.13,
    vignetteStr: 0.30, grainAmount: 0.015, bloomStr: 0.22,
    fadeAmount: 0.20, warmth: -0.02, overexpose: 0,
  },

  // ── B&W Variants ────────────────────────────────────────────

  {
    id: 'bw_classic',
    label: 'B&W Classic',
    icon: '⬛',
    // Pure desaturated, balanced contrast — clean timeless black & white
    brightness: 0.0, contrast: 1.05, saturation: 0.0,
    tintRGB: [1.0, 1.0, 1.0], tintStrength: 0.0,
    liftRGB: [0.0, 0.0, 0.0], liftAmount: 0.0,
    vignetteStr: 0.30, grainAmount: 0.0, bloomStr: 0.0,
    fadeAmount: 0.0, warmth: 0.0, overexpose: 0,
  },
  {
    id: 'bw_noir',
    label: 'B&W Noir',
    icon: '🖤',
    // High contrast, deep blacks, bright whites — dramatic film noir look
    brightness: -0.05, contrast: 1.35, saturation: 0.0,
    tintRGB: [1.0, 1.0, 1.0], tintStrength: 0.0,
    liftRGB: [0.0, 0.0, 0.0], liftAmount: 0.0,
    vignetteStr: 1.10, grainAmount: 0.018, bloomStr: 0.0,
    fadeAmount: 0.0, warmth: 0.0, overexpose: 0,
  },
  {
    id: 'bw_soft',
    label: 'B&W Soft',
    icon: '🤍',
    // Lifted blacks, reduced contrast, matte grey tones — airy editorial feel
    brightness: 0.06, contrast: 0.82, saturation: 0.0,
    tintRGB: [1.0, 1.0, 1.0], tintStrength: 0.0,
    liftRGB: [0.18, 0.18, 0.18], liftAmount: 0.16,
    vignetteStr: 0.10, grainAmount: 0.006, bloomStr: 0.25,
    fadeAmount: 0.18, warmth: 0.0, overexpose: 0,
  },
  {
    id: 'bw_silver',
    label: 'B&W Silver',
    icon: '🪨',
    // Film grain, deep vignette, faded blacks — vintage silver gelatin print look
    brightness: 0.02, contrast: 1.08, saturation: 0.0,
    tintRGB: [1.0, 1.0, 1.0], tintStrength: 0.0,
    liftRGB: [0.08, 0.08, 0.08], liftAmount: 0.10,
    vignetteStr: 0.80, grainAmount: 0.08, bloomStr: 0.05,
    fadeAmount: 0.10, warmth: 0.0, overexpose: 0,
  },
];

// ── GLSL Shaders ─────────────────────────────────────────────

const VERT_SRC = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    // Flip X so the preview is mirrored (selfie-style)
    v_uv = vec2(1.0 - (a_position.x * 0.5 + 0.5), 1.0 - (a_position.y * 0.5 + 0.5));
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAG_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_tex;
  uniform float u_time;

  // ── filter uniforms ──
  uniform float u_brightness;
  uniform float u_contrast;
  uniform float u_saturation;
  uniform vec3  u_tintRGB;
  uniform float u_tintStrength;
  uniform vec3  u_liftRGB;
  uniform float u_liftAmount;
  uniform float u_vignetteStr;
  uniform float u_grainAmount;
  uniform float u_bloomStr;
  uniform float u_fadeAmount;
  uniform float u_warmth;
  uniform float u_overexpose;

  // Simple pseudo-random for grain
  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453 + u_time * 0.1);
  }

  // Luminance
  float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  // Soft-light blend (for bloom/glow overlay)
  vec3 softLight(vec3 base, vec3 blend) {
    return mix(
      2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
      sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
      step(0.5, blend)
    );
  }

  void main() {
    vec4 src = texture2D(u_tex, v_uv);
    vec3 c = src.rgb;

    // 1. Warmth — shift red/blue channels
    c.r = clamp(c.r + u_warmth, 0.0, 1.0);
    c.b = clamp(c.b - u_warmth, 0.0, 1.0);

    // 2. Overexpose (Y2K flash boost on highlights)
    if (u_overexpose > 0.0) {
      float lum = luma(c);
      c = c + u_overexpose * smoothstep(0.45, 1.0, lum) * (1.0 - c);
    }

    // 3. Brightness
    c += u_brightness;

    // 4. Contrast (pivoted at 0.5)
    c = (c - 0.5) * u_contrast + 0.5;

    // 5. Saturation
    float gray = luma(c);
    c = mix(vec3(gray), c, u_saturation);

    // 6. Tint overlay (multiply in, like a color wash)
    c = mix(c, c * u_tintRGB, u_tintStrength);

    // 7. Shadow lift (raised blacks → matte / Korean style)
    c = mix(u_liftRGB, c, 1.0 - u_liftAmount);

    // 8. Fade blacks toward grey (matte finish)
    c = mix(c, vec3(0.5), u_fadeAmount * (1.0 - luma(c)));

    // 9. Bloom — cheap box-sample blur blended as soft light
    if (u_bloomStr > 0.0) {
      vec2 px = vec2(3.0) / vec2(1280.0, 960.0);
      vec3 blur =
        texture2D(u_tex, v_uv + vec2(-px.x, -px.y)).rgb * 0.25 +
        texture2D(u_tex, v_uv + vec2( px.x, -px.y)).rgb * 0.25 +
        texture2D(u_tex, v_uv + vec2(-px.x,  px.y)).rgb * 0.25 +
        texture2D(u_tex, v_uv + vec2( px.x,  px.y)).rgb * 0.25;
      // Boost bright areas
      float bloomMask = smoothstep(0.55, 1.0, luma(blur));
      vec3 bloomColor = mix(c, softLight(c, blur + 0.1), bloomMask);
      c = mix(c, bloomColor, u_bloomStr);
    }

    // 10. Film grain (time-varying)
    if (u_grainAmount > 0.0) {
      float grain = (rand(v_uv) - 0.5) * 2.0;
      c += grain * u_grainAmount;
    }

    // 11. Vignette
    if (u_vignetteStr > 0.0) {
      vec2 uv2 = v_uv * (1.0 - v_uv.yx);
      float vig = uv2.x * uv2.y * 15.0;
      vig = pow(vig, 0.35 * u_vignetteStr);
      c *= clamp(vig, 0.0, 1.0);
    }

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
  }
`;

// ── WebGL Engine ─────────────────────────────────────────────

class PhotoboothGL {
  constructor(glCanvas, video) {
    this.canvas  = glCanvas;
    this.video   = video;
    this.running = false;
    this.time    = 0;
    this.currentFilter = AESTHETIC_FILTERS[0];

    const gl = glCanvas.getContext('webgl', {
      preserveDrawingBuffer: true,  // allows readPixels / toDataURL after draw
      antialias: false,
      alpha: false,
    });

    if (!gl) {
      console.warn('WebGL not available — falling back to CSS filters');
      this.gl = null;
      return;
    }

    this.gl = gl;
    this._initGL();
  }

  _initGL() {
    const gl = this.gl;

    // Compile shaders
    const vert = this._compile(gl.VERTEX_SHADER,   VERT_SRC);
    const frag = this._compile(gl.FRAGMENT_SHADER, FRAG_SRC);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vert);
    gl.attachShader(this.program, frag);
    gl.linkProgram(this.program);
    gl.useProgram(this.program);

    // Full-screen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1,  1,-1,  -1,1,
       1,-1,  1, 1,  -1,1,
    ]), gl.STATIC_DRAW);

    const loc = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // Video texture
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Cache uniform locations
    this.u = {};
    [
      'u_tex','u_time','u_brightness','u_contrast','u_saturation',
      'u_tintRGB','u_tintStrength','u_liftRGB','u_liftAmount',
      'u_vignetteStr','u_grainAmount','u_bloomStr',
      'u_fadeAmount','u_warmth','u_overexpose',
    ].forEach(name => {
      this.u[name] = gl.getUniformLocation(this.program, name);
    });

    gl.uniform1i(this.u.u_tex, 0);
  }

  _compile(type, src) {
    const gl     = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  setFilter(filter) {
    this.currentFilter = filter;
  }

  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
    if (this.gl) this.gl.viewport(0, 0, w, h);
  }

  start() {
    if (this.running || !this.gl) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
  }

  _loop() {
    if (!this.running) return;
    this._drawFrame();
    requestAnimationFrame(() => this._loop());
  }

  _drawFrame() {
    const gl = this.gl;
    const f  = this.currentFilter;
    this.time += 0.016;

    // Upload video frame as texture
    if (this.video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    }

    // Upload uniforms
    gl.uniform1f(this.u.u_time,        this.time);
    gl.uniform1f(this.u.u_brightness,  f.brightness);
    gl.uniform1f(this.u.u_contrast,    f.contrast);
    gl.uniform1f(this.u.u_saturation,  f.saturation);
    gl.uniform3fv(this.u.u_tintRGB,    f.tintRGB);
    gl.uniform1f(this.u.u_tintStrength,f.tintStrength);
    gl.uniform3fv(this.u.u_liftRGB,    f.liftRGB);
    gl.uniform1f(this.u.u_liftAmount,  f.liftAmount);
    gl.uniform1f(this.u.u_vignetteStr, f.vignetteStr);
    gl.uniform1f(this.u.u_grainAmount, f.grainAmount);
    gl.uniform1f(this.u.u_bloomStr,    f.bloomStr);
    gl.uniform1f(this.u.u_fadeAmount,  f.fadeAmount);
    gl.uniform1f(this.u.u_warmth,      f.warmth);
    gl.uniform1f(this.u.u_overexpose,  f.overexpose);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /*
   * captureFrame()
   * Draws one final frame (so it's fully up-to-date) then reads
   * pixels from the WebGL canvas via toDataURL.
   * preserveDrawingBuffer:true means the framebuffer isn't cleared
   * between frames, so this is safe to call at any point.
   * PNG is used instead of JPEG — lossless, no compression artifacts.
   */
  captureFrame() {
    this._drawFrame();
    return this.canvas.toDataURL('image/png');
  }
}

// Exported as a global — script.js constructs it after DOM ready
window.PhotoboothGL    = PhotoboothGL;
window.AESTHETIC_FILTERS = AESTHETIC_FILTERS;