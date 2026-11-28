/*
MIT License

Copyright (c) 2017 Pavel Dobryakov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

'use strict';

// Simulation section

const canvas = document.getElementsByTagName('canvas')[0];
resizeCanvas();

let config = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 1024,
    CAPTURE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 3.4,
    VELOCITY_DISSIPATION: 1.16,
    PRESSURE: 0.31,
    PRESSURE_ITERATIONS: 20,
    CURL: 26,
    SPLAT_RADIUS: 0.32,
    SPLAT_FORCE: 6000,
    SHADING: true,
    COLORFUL: true,
    COLOR_UPDATE_SPEED: 10,
    PAUSED: false,
    BACK_COLOR: { r: 0, g: 0, b: 0 },
    TRANSPARENT: false,
    BLOOM: false,
    BLOOM_ITERATIONS: 8,
    BLOOM_RESOLUTION: 256,
    BLOOM_INTENSITY: 0.31,
    BLOOM_THRESHOLD: 0.38,
    BLOOM_SOFT_KNEE: 0.7,
    SUNRAYS: false,
    SUNRAYS_RESOLUTION: 196,
    SUNRAYS_WEIGHT: 0.4,
    MATERIAL: 'DEFAULT',      // how the dye is shaded: 'DEFAULT' | 'CHROME' | 'OIL' (see SURFACES)
    MATERIAL_RELIEF: 5,       // CHROME / OIL: how strongly density tilts the surface
    MATERIAL_TINT: 0.4,       // CHROME / OIL: how much of the dye colour the surface keeps
}

function pointerPrototype () {
    this.id = -1;
    this.texcoordX = 0;
    this.texcoordY = 0;
    this.prevTexcoordX = 0;
    this.prevTexcoordY = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.down = false;
    this.moved = false;
    this.color = [30, 0, 300];
}

let pointers = [];
let splatStack = [];
pointers.push(new pointerPrototype());

const { gl, ext } = getWebGLContext(canvas);

if (isMobile()) {
    config.DYE_RESOLUTION = 512;
}
if (!ext.supportLinearFiltering) {
    config.DYE_RESOLUTION = 512;
    config.SHADING = false;
    config.BLOOM = false;
    config.SUNRAYS = false;
}

function getWebGLContext (canvas) {
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };

    let gl = canvas.getContext('webgl2', params);
    const isWebGL2 = !!gl;
    if (!isWebGL2)
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);

    let halfFloat;
    let supportLinearFiltering;
    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
    let formatRGBA;
    let formatRG;
    let formatR;

    if (isWebGL2)
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    }
    else
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    }

    return {
        gl,
        ext: {
            formatRGBA,
            formatRG,
            formatR,
            halfFloatTexType,
            supportLinearFiltering
        }
    };
}

function getSupportedFormat (gl, internalFormat, format, type)
{
    if (!supportRenderTextureFormat(gl, internalFormat, format, type))
    {
        switch (internalFormat)
        {
            case gl.R16F:
                return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
            case gl.RG16F:
                return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
            default:
                return null;
        }
    }

    return {
        internalFormat,
        format
    }
}

function supportRenderTextureFormat (gl, internalFormat, format, type) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    return status == gl.FRAMEBUFFER_COMPLETE;
}

function isMobile () {
    return /Mobi|Android/i.test(navigator.userAgent) || isIOS();
}

// iOS / iPadOS Safari requires a user gesture to show the getUserMedia prompt
// and to resume an AudioContext, so any auto-start of the mic at page load
// fails silently. iPad on iPadOS 13+ reports a Mac userAgent — detect it via
// the touch-point trick.
function isIOS () {
    const ua = navigator.userAgent;
    if (/iPhone|iPod|iPad/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

// Desktop Safari ALSO blocks getUserMedia outside a user gesture, and it has
// no Permissions API 'microphone' query to tell "needs a tap" apart from
// "denied" — so treat every Safari like iOS: never auto-start the mic,
// always start from the user's tap. (Chrome on iOS reports CriOS, Edge EdgiOS
// — they inherit WebKit's rules anyway via isIOS.)
function isSafari () {
    const ua = navigator.userAgent;
    return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/i.test(ua);
}

// macOS (not iOS). Display-capture audio rules differ per OS: on a Mac no
// browser can capture whole-screen/window audio — only Chrome/Edge TAB
// shares carry audio — while on Windows "entire screen + share audio" works.
function isMacPlatform () {
    return /Mac/i.test(navigator.platform) && !isIOS();
}

function captureScreenshot () {
    let res = getResolution(config.CAPTURE_RESOLUTION);
    let target = createFBO(res.width, res.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, ext.halfFloatTexType, gl.NEAREST);
    render(target);

    let texture = framebufferToTexture(target);
    texture = normalizeTexture(texture, target.width, target.height);

    let captureCanvas = textureToCanvas(texture, target.width, target.height);
    let datauri = captureCanvas.toDataURL();
    downloadURI('fluid.png', datauri);
    URL.revokeObjectURL(datauri);
}

function framebufferToTexture (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    let length = target.width * target.height * 4;
    let texture = new Float32Array(length);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, texture);
    return texture;
}

function normalizeTexture (texture, width, height) {
    let result = new Uint8Array(texture.length);
    let id = 0;
    for (let i = height - 1; i >= 0; i--) {
        for (let j = 0; j < width; j++) {
            let nid = i * width * 4 + j * 4;
            result[nid + 0] = clamp01(texture[id + 0]) * 255;
            result[nid + 1] = clamp01(texture[id + 1]) * 255;
            result[nid + 2] = clamp01(texture[id + 2]) * 255;
            result[nid + 3] = clamp01(texture[id + 3]) * 255;
            id += 4;
        }
    }
    return result;
}

function clamp01 (input) {
    return Math.min(Math.max(input, 0), 1);
}

function textureToCanvas (texture, width, height) {
    let captureCanvas = document.createElement('canvas');
    let ctx = captureCanvas.getContext('2d');
    captureCanvas.width = width;
    captureCanvas.height = height;

    let imageData = ctx.createImageData(width, height);
    imageData.data.set(texture);
    ctx.putImageData(imageData, 0, 0);

    return captureCanvas;
}

function downloadURI (filename, uri) {
    let link = document.createElement('a');
    link.download = filename;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

class Material {
    constructor (vertexShader, fragmentShaderSource) {
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = [];
        this.activeProgram = null;
        this.uniforms = [];
    }

    setKeywords (keywords) {
        let hash = 0;
        for (let i = 0; i < keywords.length; i++)
            hash += hashCode(keywords[i]);

        let program = this.programs[hash];
        if (program == null)
        {
            let fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
            program = createProgram(this.vertexShader, fragmentShader);
            this.programs[hash] = program;
        }

        if (program == this.activeProgram) return;

        this.uniforms = getUniforms(program);
        this.activeProgram = program;
    }

    bind () {
        gl.useProgram(this.activeProgram);
    }
}

class Program {
    constructor (vertexShader, fragmentShader) {
        this.uniforms = {};
        this.program = createProgram(vertexShader, fragmentShader);
        this.uniforms = getUniforms(this.program);
    }

    bind () {
        gl.useProgram(this.program);
    }
}

function createProgram (vertexShader, fragmentShader) {
    let program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        console.trace(gl.getProgramInfoLog(program));

    return program;
}

function getUniforms (program) {
    let uniforms = [];
    let uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
        let uniformName = gl.getActiveUniform(program, i).name;
        uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
    }
    return uniforms;
}

function compileShader (type, source, keywords) {
    source = addKeywords(source, keywords);

    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        console.trace(gl.getShaderInfoLog(shader));

    return shader;
};

function addKeywords (source, keywords) {
    if (keywords == null) return source;
    let keywordsString = '';
    keywords.forEach(keyword => {
        keywordsString += '#define ' + keyword + '\n';
    });
    return keywordsString + source;
}

const baseVertexShader = compileShader(gl.VERTEX_SHADER, `
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
`);

const blurVertexShader = compileShader(gl.VERTEX_SHADER, `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`);

const blurShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
        sum += texture2D(uTexture, vL) * 0.35294117;
        sum += texture2D(uTexture, vR) * 0.35294117;
        gl_FragColor = sum;
    }
`);

const copyShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`);

const clearShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
    }
`);

const colorShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    uniform vec4 color;

    void main () {
        gl_FragColor = color;
    }
`);

const checkerboardShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float aspectRatio;

    #define SCALE 25.0

    void main () {
        vec2 uv = floor(vUv * SCALE * vec2(aspectRatio, 1.0));
        float v = mod(uv.x + uv.y, 2.0);
        v = v * 0.1 + 0.8;
        gl_FragColor = vec4(vec3(v), 1.0);
    }
`);

const displayShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform sampler2D uSunrays;
    uniform sampler2D uDithering;
    uniform vec2 ditherScale;
    uniform vec2 texelSize;

    vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0));
        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
    }

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
        vec3 l = vec3(0.0, 0.0, 1.0);

        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
    #endif

    #ifdef BLOOM
        vec3 bloom = texture2D(uBloom, vUv).rgb;
    #endif

    #ifdef SUNRAYS
        float sunrays = texture2D(uSunrays, vUv).r;
        c *= sunrays;
    #ifdef BLOOM
        bloom *= sunrays;
    #endif
    #endif

    #ifdef BLOOM
        float noise = texture2D(uDithering, vUv * ditherScale).r;
        noise = noise * 2.0 - 1.0;
        bloom += noise / 255.0;
        bloom = linearToGamma(bloom);
        c += bloom;
    #endif

        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
    }
`;

// ============================================================
// SURFACE MATERIALS (config.MATERIAL → SURFACES)
// Alternative display shader: instead of glowing pigment, the dye is read as
// the thickness of a liquid film. Screen-space normals come from the density
// gradient and the surface mirrors a small procedural studio (graded sky, an
// overhead softbox, a warm and a cool side strip).
//   CHROME — high Fresnel reflectance, no body colour: liquid metal
//   OIL    — low reflectance, body lit through a thin-film interference
//            palette that cycles with film thickness and viewing angle
// Output is premultiplied (rgb * mask, mask), so it blends over the
// background colour exactly like the default display pass.
// ============================================================
const surfaceShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform float aspectRatio;
    uniform float relief;
    uniform float tint;
    uniform vec4 surface;   // x: Fresnel F0, y: body gain, z: thin-film amount, w: environment gain

    float thickness (vec3 c) {
        return max(c.r, max(c.g, c.b));
    }

    vec3 sky (vec3 r) {
        return mix(vec3(0.02, 0.022, 0.03), vec3(0.42, 0.47, 0.58), smoothstep(-0.4, 1.0, r.y * 0.6 + r.z * 0.5));
    }

    vec3 studio (vec3 r) {
        vec3 c = sky(r);
        c += vec3(2.8, 2.7, 2.6) * smoothstep(0.26, 0.40, r.y) * (1.0 - smoothstep(0.62, 0.78, r.y)) * (1.0 - smoothstep(0.5, 0.9, abs(r.x)));
        c += vec3(1.7, 0.95, 0.5) * smoothstep(0.42, 0.60, r.x) * (1.0 - smoothstep(0.8, 0.96, r.x)) * (1.0 - smoothstep(0.1, 0.6, abs(r.y)));
        c += vec3(0.3, 0.65, 1.5) * (1.0 - smoothstep(-0.68, -0.48, r.x)) * (1.0 - smoothstep(0.0, 0.5, abs(r.y + 0.1)));
        return c;
    }

    void main () {
        vec3 dye = texture2D(uTexture, vUv).rgb;
        float d = thickness(dye);

        // Sobel gradient over the 8 neighbours: a plain 4-tap difference turns
        // fine turbulence into crinkled foil instead of a liquid surface.
        vec2 e = vec2(vR.x - vUv.x, vT.y - vUv.y);
        float tl = thickness(texture2D(uTexture, vUv + vec2(-e.x, e.y)).rgb);
        float tc = thickness(texture2D(uTexture, vT).rgb);
        float tr = thickness(texture2D(uTexture, vUv + e).rgb);
        float ml = thickness(texture2D(uTexture, vL).rgb);
        float mr = thickness(texture2D(uTexture, vR).rgb);
        float bl = thickness(texture2D(uTexture, vUv - e).rgb);
        float bc = thickness(texture2D(uTexture, vB).rgb);
        float br = thickness(texture2D(uTexture, vUv + vec2(e.x, -e.y)).rgb);
        float dx = ((tl + 2.0 * ml + bl) - (tr + 2.0 * mr + br)) * 0.25;
        float dy = ((bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)) * 0.25;
        vec3 n = normalize(vec3(dx * relief, dy * relief, 1.0));

        // Slightly off-axis camera, so flat areas still pick up a gradient across the screen.
        vec2 p = (vUv - 0.5) * vec2(aspectRatio, 1.0);
        vec3 v = normalize(vec3(-p * 0.55, 1.0));
        vec3 r = reflect(-v, n);
        float ndv = clamp(dot(n, v), 0.0, 1.0);
        float fresnel = surface.x + (1.0 - surface.x) * pow(1.0 - ndv, 5.0);

        vec3 film = 0.5 + 0.5 * cos(6.2831853 * (d * 1.1 + 0.2 + (1.0 - ndv) * 1.4 + vec3(0.0, 0.33, 0.67)));
        film = mix(vec3(dot(film, vec3(0.333))), film, 0.85);
        float light = 0.25 + 1.5 * dot(sky(r), vec3(0.333));
        vec3 body = mix(vec3(1.0), film, surface.z) * light * surface.y;

        vec3 c = body + studio(r) * fresnel * surface.w;
        c *= mix(vec3(1.0), dye / max(d, 0.001), tint);
        c = 1.0 - exp(-c);

        float mask = smoothstep(0.012, 0.07, d);
        gl_FragColor = vec4(c * mask, mask);
    }
`;

const SURFACES = {
    CHROME: { fresnel: 0.90, body: 0.0, film: 0.0, env: 1.0 },
    OIL:    { fresnel: 0.06, body: 1.0, film: 1.0, env: 1.6 },
};

// ============================================================
// SHADER FILTERS (filterState.name → SHADER_FILTERS)
// Post-process passes that have to re-sample the finished picture, which the
// CSS / SVG filters cannot do. render() draws the scene into an off-screen
// target first, then one of these variants draws it onto the canvas:
//   FLUTED   — fluted (reeded) glass: periodic cylindrical ribs act as lenses,
//              R/G/B refract by different amounts, every rib catches a highlight
//   HALFTONE — print screen: a rotated dot grid whose dot SIZE follows brightness
//   ASCII    — monospace glyph grid, each cell picks a glyph from a density ramp
//   DITHER   — 1-bit ordered (Bayer 8×8) dithering in chunky pixels
// amount = filter intensity (1.0 at the default 50), cell = feature size in px.
// ============================================================
const filterShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uScene;
    uniform sampler2D uGlyphs;
    uniform vec2 resolution;
    uniform float amount;
    uniform float cell;
    uniform float glyphCount;

    const vec3 CREAM = vec3(0.992, 0.988, 0.988);   // --canvas
    const vec3 INK = vec3(0.125, 0.114, 0.114);     // --ink

    float brightness (vec3 c) {
        return max(c.r, max(c.g, c.b));
    }

    #ifdef DITHER
    float bayer2 (vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
    float bayer4 (vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8 (vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
    #endif

    void main () {
    #ifdef FLUTED
        float f = fract(vUv.x * resolution.x / cell) - 0.5;         // -0.5 .. 0.5 across one rib
        float slope = sin(f * 3.14159265);                           // surface slope of a convex rib
        vec2 bend = vec2(slope * 0.55 * amount * cell / resolution.x, 0.0);
        vec3 c = vec3(0.0);
        for (int i = 0; i < 3; i++) {                                // 3 taps per channel: dispersion + a little blur
            float k = 0.85 + 0.15 * float(i);
            c.r += texture2D(uScene, vUv + bend * k * 0.82).r;
            c.g += texture2D(uScene, vUv + bend * k).g;
            c.b += texture2D(uScene, vUv + bend * k * 1.18).b;
        }
        c /= 3.0;
        float glass = min(amount, 1.2);
        vec3 n = normalize(vec3(slope * 1.3, 0.0, 1.0));
        float spec = pow(max(dot(n, normalize(vec3(-0.55, 0.25, 0.8))), 0.0), 60.0);
        c += 0.9 * glass * spec * (0.25 + 0.75 * brightness(c));     // highlight line on every rib
        c *= 1.0 - 0.28 * glass * smoothstep(0.36, 0.5, abs(f));     // grooves between ribs
        gl_FragColor = vec4(c, 1.0);
    #endif

    #ifdef HALFTONE
        const float CA = 0.8660254;                                  // 30° screen angle
        const float SA = 0.5;
        vec2 frag = vUv * resolution;
        vec2 g = vec2(CA * frag.x + SA * frag.y, CA * frag.y - SA * frag.x) / cell;
        vec2 f = fract(g) - 0.5;
        vec2 centre = (floor(g) + 0.5) * cell;
        vec3 c = texture2D(uScene, vec2(CA * centre.x - SA * centre.y, SA * centre.x + CA * centre.y) / resolution).rgb;
        float v = brightness(c);
        float radius = sqrt(v) * (0.30 + 0.32 * amount);              // dot size follows brightness
        float edge = 0.9 / cell;
        float disc = (1.0 - smoothstep(radius - edge, radius + edge, length(f))) * smoothstep(0.0, 0.03, v);
        vec3 ink = mix(c / max(v, 0.0001), vec3(1.0), 0.12) * (0.75 + 0.35 * v);
        gl_FragColor = vec4(ink * disc, 1.0);
    #endif

    #ifdef ASCII
        vec2 size = vec2(cell * 0.5, cell);                          // monospace cell, 1 : 2
        vec2 frag = vUv * resolution;
        vec2 id = floor(frag / size);
        vec2 cuv = fract(frag / size);
        vec2 centre = (id + 0.5) * size / resolution;
        vec2 q = 0.25 * size / resolution;
        vec3 c = 0.25 * (texture2D(uScene, centre + q).rgb + texture2D(uScene, centre - q).rgb
                       + texture2D(uScene, centre + vec2(q.x, -q.y)).rgb + texture2D(uScene, centre + vec2(-q.x, q.y)).rgb);
        float v = brightness(c);
        // a dark cell stays blank, so the ground stays black; the rest climb the ramp from the lightest glyph
        float t = clamp((v - 0.07) / 0.93, 0.0, 0.999);
        float index = v < 0.07 ? 0.0 : 1.0 + floor(pow(t, 1.6) * (glyphCount - 1.0));
        float glyph = texture2D(uGlyphs, vec2((index + cuv.x) / glyphCount, cuv.y)).r;
        // the glyph takes the colour of its cell at full saturation, lifted so that dim cells still show their hue;
        // the intensity knob fades it towards cream below the default (50 = all colour, 0 = cream on black)
        vec3 tinted = c / max(v, 0.0001) * (0.6 + 0.5 * v);
        gl_FragColor = vec4(mix(CREAM, tinted, clamp(amount, 0.0, 1.0)) * glyph, 1.0);
    #endif

    #ifdef DITHER
        vec2 id = floor(vUv * resolution / cell);
        vec3 c = texture2D(uScene, (id + 0.5) * cell / resolution).rgb;
        float v = brightness(c);
        float on = step(bayer8(id) + 0.0078125, v);
        vec3 lit = mix(CREAM, mix(CREAM, c / max(v, 0.0001), 0.85), clamp(amount * 0.5, 0.0, 1.0));
        gl_FragColor = vec4(mix(INK, lit, on), 1.0);
    #endif
    }
`;

// keyword: variant of filterShaderSource. Feature size in CSS px = size + filterState.scale × step.
const SHADER_FILTERS = {
    REEDED:   { keyword: 'FLUTED',   size: 12, step: 0.52 },   // flute width  12..64, 38 at the default scale
    HALFTONE: { keyword: 'HALFTONE', size: 4,  step: 0.10 },   // dot pitch     4..14,  9
    ASCII:    { keyword: 'ASCII',    size: 8,  step: 0.24 },   // glyph height  8..32, 20
    DITHER:   { keyword: 'DITHER',   size: 1,  step: 0.04 },   // pixel size    1..5,   3
};

const bloomPrefilterShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 0.0);
    }
`);

const bloomBlurShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum;
    }
`);

const bloomFinalShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform float intensity;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum * intensity;
    }
`);

const sunraysMaskShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        vec4 c = texture2D(uTexture, vUv);
        float br = max(c.r, max(c.g, c.b));
        c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
        gl_FragColor = c;
    }
`);

const sunraysShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float weight;

    #define ITERATIONS 16

    void main () {
        float Density = 0.3;
        float Decay = 0.95;
        float Exposure = 0.7;

        vec2 coord = vUv;
        vec2 dir = vUv - 0.5;

        dir *= 1.0 / float(ITERATIONS) * Density;
        float illuminationDecay = 1.0;

        float color = texture2D(uTexture, vUv).a;

        for (int i = 0; i < ITERATIONS; i++)
        {
            coord -= dir;
            float col = texture2D(uTexture, coord).a;
            color += col * illuminationDecay * weight;
            illuminationDecay *= Decay;
        }

        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
    }
`);

const splatShader = compileShader(gl.FRAGMENT_SHADER, `
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
`);

// Draws a whole raindrop-ripple ring in ONE pass: a gaussian annulus of dye,
// or (velocityPass=1) a radial outward push along that annulus. Replaces the
// 20–48 individual splats (40–96 fullscreen blits) a JS-loop ring needed.
// Distances are measured in aspect-corrected space (p.x *= aspectRatio), so
// the ring is a true circle on screen for any canvas shape; the velocity
// x-component is divided back so the push is even in every direction.
const ringSplatShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;       // ring radius, in height-fraction units
    uniform float thickness;    // gaussian variance of the annulus cross-section
    uniform float velocityPass; // 1.0 = write radial push, 0.0 = write dye color
    uniform float force;

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        float d = length(p);
        float band = d - radius;
        float ring = exp(-band * band / thickness);
        vec2 dir = p / max(d, 0.0001);
        vec3 radial = vec3(dir.x / aspectRatio, dir.y, 0.0) * force;
        vec3 add = mix(color, radial, velocityPass) * ring;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + add, 1.0);
    }
`);

// Many shapes of dye in one pass. The choreographed modes (see RIGS) draw dozens of shapes a
// frame — a travelling ripple is drawn again on every frame of its life — and a blit for each
// would copy the whole dye buffer every time. The same source is compiled once per kind of shape:
//   DOT   a soft round spot                      shape = x, y, variance
//   RING  a ripple and the lobes trailing it     shape = x, y, radius, reach   tint.a = variance      extra = gap, three lobe weights
//   BELL  a jellyfish, seen from the side        shape = x, y, radius          tint.a = contraction   extra = up.x, up.y, tentacle sway
// The bell is the upper half of a ring (the dome) with a faint glow inside, a soft line closing
// it underneath (the rim) and two tentacle roots below that; contracted, it is narrower and taller.
// A pixel a shape does not reach skips it, so a frame full of small shapes stays cheap.
const STAMP_BATCH = Math.max(1, Math.min(8, Math.floor((gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) - 8) / 3)));
const stampSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform int count;
    uniform vec4 shape[${STAMP_BATCH}];
    uniform vec4 tint[${STAMP_BATCH}];
    uniform vec4 extra[${STAMP_BATCH}];

    void main () {
        vec3 sum = vec3(0.0);
        for (int i = 0; i < ${STAMP_BATCH}; i++) {
            if (i >= count) break;
            vec4 s = shape[i];
            vec2 p = vUv - s.xy;
            p.x *= aspectRatio;
        #ifdef DOT
            float d2 = dot(p, p);
            if (d2 > 12.0 * s.z) continue;
            sum += tint[i].rgb * exp(-d2 / s.z);
        #else
        #ifdef RING
            vec4 e = extra[i];
            float v = tint[i].a;
            float b0 = length(p) - s.z;
            if (b0 > s.w + max(0.0, -3.0 * e.x) || b0 < -3.0 * max(0.0, e.x) - s.w) continue;     // a ring that shrinks trails outside
            float b1 = b0 + e.x, b2 = b1 + e.x, b3 = b2 + e.x;
            sum += tint[i].rgb * (exp(-b0 * b0 / v) + e.y * exp(-b1 * b1 / v) + e.z * exp(-b2 * b2 / v) + e.w * exp(-b3 * b3 / v));
        #else
            vec4 e = extra[i];
            float squeeze = tint[i].a;
            vec2 q = vec2(p.x * e.y - p.y * e.x, p.x * e.x + p.y * e.y) / s.z;         // across, along, in bell radii
            if (dot(q, q) > 7.0) continue;
            vec2 root = vec2(abs(q.x - e.z) - 0.5, q.y + 0.45);
            q /= vec2(1.0 - 0.3 * squeeze, 1.0 + 0.3 * squeeze);
            float d = length(q);
            float dome = smoothstep(-0.35, 0.1, q.y);
            float edge = exp(-(d - 1.0) * (d - 1.0) / 0.03);
            float body = 0.3 * exp(-d * d / 0.55);
            float rim = 0.5 * exp(-(q.y + 0.1) * (q.y + 0.1) / 0.02) * (1.0 - smoothstep(0.6, 1.15, abs(q.x)));
            sum += tint[i].rgb * ((edge + body) * dome + rim + 0.5 * exp(-dot(root, root) / 0.05));
        #endif
        #endif
        }
        gl_FragColor = vec4(texture2D(uTarget, vUv).rgb + sum, 1.0);
    }
`;
const STAMP_DOT = 0, STAMP_RING = 1, STAMP_BELL = 2;
const stampShaders = ['DOT', 'RING', 'BELL'].map(kind => compileShader(gl.FRAGMENT_SHADER, stampSource, [kind]));

const advectionShader = compileShader(gl.FRAGMENT_SHADER, `
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
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
    }`,
    ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']
);

const divergenceShader = compileShader(gl.FRAGMENT_SHADER, `
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
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }

        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`);

const curlShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
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
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`);

const vorticityShader = compileShader(gl.FRAGMENT_SHADER, `
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

        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`);

const pressureShader = compileShader(gl.FRAGMENT_SHADER, `
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
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`);

const gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `
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
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`);

const blit = (() => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    return (target, clear = false) => {
        if (target == null)
        {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        else
        {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        if (clear)
        {
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        // CHECK_FRAMEBUFFER_STATUS();
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
})();

function CHECK_FRAMEBUFFER_STATUS () {
    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE)
        console.trace("Framebuffer error: " + status);
}

let dye;
let velocity;
let divergence;
let curl;
let pressure;
let bloom;
let bloomFramebuffers = [];
let sunrays;
let sunraysTemp;

let ditheringTexture = createTextureAsync('LDR_LLL1_0.png');

const blurProgram            = new Program(blurVertexShader, blurShader);
const copyProgram            = new Program(baseVertexShader, copyShader);
const clearProgram           = new Program(baseVertexShader, clearShader);
const colorProgram           = new Program(baseVertexShader, colorShader);
const checkerboardProgram    = new Program(baseVertexShader, checkerboardShader);
const bloomPrefilterProgram  = new Program(baseVertexShader, bloomPrefilterShader);
const bloomBlurProgram       = new Program(baseVertexShader, bloomBlurShader);
const bloomFinalProgram      = new Program(baseVertexShader, bloomFinalShader);
const sunraysMaskProgram     = new Program(baseVertexShader, sunraysMaskShader);
const sunraysProgram         = new Program(baseVertexShader, sunraysShader);
const splatProgram           = new Program(baseVertexShader, splatShader);
const ringProgram            = new Program(baseVertexShader, ringSplatShader);
const stampPrograms          = stampShaders.map(shader => new Program(baseVertexShader, shader));
const stampsLinked           = stampPrograms.every(p => gl.getProgramParameter(p.program, gl.LINK_STATUS));
const advectionProgram       = new Program(baseVertexShader, advectionShader);
const divergenceProgram      = new Program(baseVertexShader, divergenceShader);
const curlProgram            = new Program(baseVertexShader, curlShader);
const vorticityProgram       = new Program(baseVertexShader, vorticityShader);
const pressureProgram        = new Program(baseVertexShader, pressureShader);
const gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);

const displayMaterial = new Material(baseVertexShader, displayShaderSource);
const surfaceMaterial = new Material(baseVertexShader, surfaceShaderSource);   // compiled on first use
const filterMaterial  = new Material(baseVertexShader, filterShaderSource);    // one variant per shader filter

let shaderFilter = null;   // active SHADER_FILTERS entry — kept in sync by applyFilter()
let sceneTarget = null;    // off-screen copy of the picture, exists only while a shader filter is on
let glyphAtlas = null;     // ASCII glyph ramp texture, built on first use
const linkStatus = new Map();       // WebGLProgram → did it link (see useVariant)
// glyphs of the ASCII filter: every printable character of a keyboard, put in order of how much ink
// each one has in the UI font when the atlas is drawn (see getGlyphAtlas)
const ASCII_RAMP = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

function initFramebuffers () {
    let simRes = getResolution(config.SIM_RESOLUTION);
    let dyeRes = getResolution(config.DYE_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const rgba    = ext.formatRGBA;
    const rg      = ext.formatRG;
    const r       = ext.formatR;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);

    if (dye == null)
        dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    else
        dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

    if (velocity == null)
        velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    else
        velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

    divergence = createFBO      (simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl       = createFBO      (simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure   = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

    initBloomFramebuffers();
    initSunraysFramebuffers();
}

function initBloomFramebuffers () {
    let res = getResolution(config.BLOOM_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const rgba = ext.formatRGBA;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    bloom = createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);

    bloomFramebuffers.length = 0;
    for (let i = 0; i < config.BLOOM_ITERATIONS; i++)
    {
        let width = res.width >> (i + 1);
        let height = res.height >> (i + 1);

        if (width < 2 || height < 2) break;

        let fbo = createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering);
        bloomFramebuffers.push(fbo);
    }
}

function initSunraysFramebuffers () {
    let res = getResolution(config.SUNRAYS_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const r = ext.formatR;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    sunrays     = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
    sunraysTemp = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
}

function createFBO (w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let texelSizeX = 1.0 / w;
    let texelSizeY = 1.0 / h;

    return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX,
        texelSizeY,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };
}

function createDoubleFBO (w, h, internalFormat, format, type, param) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = createFBO(w, h, internalFormat, format, type, param);

    return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read () {
            return fbo1;
        },
        set read (value) {
            fbo1 = value;
        },
        get write () {
            return fbo2;
        },
        set write (value) {
            fbo2 = value;
        },
        swap () {
            let temp = fbo1;
            fbo1 = fbo2;
            fbo2 = temp;
        }
    }
}

function resizeFBO (target, w, h, internalFormat, format, type, param) {
    let newFBO = createFBO(w, h, internalFormat, format, type, param);
    copyProgram.bind();
    gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
    blit(newFBO);
    return newFBO;
}

function resizeDoubleFBO (target, w, h, internalFormat, format, type, param) {
    if (target.width == w && target.height == h)
        return target;
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
    target.write = createFBO(w, h, internalFormat, format, type, param);
    target.width = w;
    target.height = h;
    target.texelSizeX = 1.0 / w;
    target.texelSizeY = 1.0 / h;
    return target;
}

function createTextureAsync (url) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));

    let obj = {
        texture,
        width: 1,
        height: 1,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };

    let image = new Image();
    image.onload = () => {
        obj.width = image.width;
        obj.height = image.height;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    };
    image.src = url;

    return obj;
}

function updateKeywords () {
    let displayKeywords = [];
    if (config.SHADING) displayKeywords.push("SHADING");
    if (config.BLOOM) displayKeywords.push("BLOOM");
    if (config.SUNRAYS) displayKeywords.push("SUNRAYS");
    displayMaterial.setKeywords(displayKeywords);
}

updateKeywords();
initFramebuffers();
multipleSplats(parseInt(Math.random() * 20) + 5);

let lastUpdateTime = Date.now();
let colorUpdateTimer = 0.0;
let rigCurl = 0;            // extra vorticity a choreographed mode asks for this frame (see RIGS); read by step()
let lastStepDt = 0;         // the time step the dye last faded by, 0 while paused: lets a rig take back what it drew a frame ago
update();

function update () {
    const dt = calcDeltaTime();
    if (resizeCanvas())
        initFramebuffers();
    applyInputs();
    if (!config.PAUSED)
        step(dt);
    lastStepDt = config.PAUSED ? 0 : dt;
    render(null);
    requestAnimationFrame(update);
}

function calcDeltaTime () {
    let now = Date.now();
    let dt = (now - lastUpdateTime) / 1000;
    dt = Math.min(dt, 0.016666);
    lastUpdateTime = now;
    return dt;
}

function resizeCanvas () {
    let width = scaleByPixelRatio(canvas.clientWidth);
    let height = scaleByPixelRatio(canvas.clientHeight);
    if (canvas.width != width || canvas.height != height) {
        canvas.width = width;
        canvas.height = height;
        return true;
    }
    return false;
}

function applyInputs () {
    if (splatStack.length > 0)
        multipleSplats(splatStack.pop());

    if (window.__audio && window.__audio.ready) {
        applyAudioInputs(window.__audio);
    }
}

function step (dt) {
    gl.disable(gl.BLEND);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL + rigCurl);
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
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write);
        pressure.swap();
    }

    gradienSubtractProgram.bind();
    gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    let velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
}

function render (target) {
    // A shader filter re-samples the finished picture, so the scene is drawn
    // off-screen first and the filter pass puts it on the canvas.
    if (target == null && shaderFilter && useVariant(filterMaterial, [shaderFilter.keyword])) {
        renderScene(getSceneTarget());
        drawFilter(shaderFilter);
        return;
    }
    if (target == null)
        releaseSceneTarget();
    renderScene(target);
}

function renderScene (target) {
    // CHROME / OIL replace the pigment pass; they take no bloom / sunrays input.
    let surface = SURFACES[config.MATERIAL];
    if (surface && !useVariant(surfaceMaterial, []))
        surface = null;

    if (!surface) {
        if (config.BLOOM)
            applyBloom(dye.read, bloom);
        if (config.SUNRAYS) {
            applySunrays(dye.read, dye.write, sunrays);
            blur(sunrays, sunraysTemp, 1);
        }
    }

    if (target == null || !config.TRANSPARENT) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
    }
    else {
        gl.disable(gl.BLEND);
    }

    if (!config.TRANSPARENT)
        drawColor(target, normalizeColor(config.BACK_COLOR));
    if (target == null && config.TRANSPARENT)
        drawCheckerboard(target);
    if (surface)
        drawSurface(target, surface);
    else
        drawDisplay(target);
}

// Select (and on first use compile) a Material variant. Returns false if it
// failed to link on this GPU, so the caller can fall back to the plain picture
// instead of drawing a black frame.
function useVariant (material, keywords) {
    material.setKeywords(keywords);
    const program = material.activeProgram;
    if (!linkStatus.has(program))
        linkStatus.set(program, !!gl.getProgramParameter(program, gl.LINK_STATUS));
    return linkStatus.get(program);
}

function getSceneTarget () {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (sceneTarget == null || sceneTarget.width != width || sceneTarget.height != height) {
        releaseSceneTarget();
        sceneTarget = createFBO(width, height, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    }
    return sceneTarget;
}

function releaseSceneTarget () {
    if (sceneTarget == null) return;
    gl.deleteTexture(sceneTarget.texture);
    gl.deleteFramebuffer(sceneTarget.fbo);
    sceneTarget = null;
}

function drawSurface (target, surface) {
    let width = target == null ? gl.drawingBufferWidth : target.width;
    let height = target == null ? gl.drawingBufferHeight : target.height;

    // The normal comes from the 8 neighbours of each pixel. They sit ~0.4% of
    // the short side apart, but never closer than 1.25 dye texels (below that
    // the bilinear-filtered gradient turns into facets); relief is rescaled so
    // the look does not change with the dye resolution.
    const basePx = 0.0039 * Math.min(width, height);
    const tapPx = Math.max(basePx, 1.25 * width / dye.width);

    surfaceMaterial.bind();
    const uniforms = surfaceMaterial.uniforms;
    gl.uniform2f(uniforms.texelSize, tapPx / width, tapPx / height);
    gl.uniform1f(uniforms.aspectRatio, width / height);
    gl.uniform1f(uniforms.relief, config.MATERIAL_RELIEF * basePx / tapPx);
    gl.uniform1f(uniforms.tint, config.MATERIAL_TINT);
    gl.uniform4f(uniforms.surface, surface.fresnel, surface.body, surface.film, surface.env);
    gl.uniform1i(uniforms.uTexture, dye.read.attach(0));
    blit(target);
}

function drawFilter (filter) {
    const pixelRatio = window.devicePixelRatio || 1;
    const cell = Math.max(1, Math.round((filter.size + filterState.scale * filter.step) * pixelRatio));

    gl.disable(gl.BLEND);
    filterMaterial.bind();
    const uniforms = filterMaterial.uniforms;
    gl.uniform2f(uniforms.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(uniforms.amount, filterState.intensity / 50);
    gl.uniform1f(uniforms.cell, cell);
    gl.uniform1i(uniforms.uScene, sceneTarget.attach(0));
    if (filter.keyword === 'ASCII') {
        const atlas = getGlyphAtlas();
        gl.uniform1i(uniforms.uGlyphs, atlas.attach(1));
        gl.uniform1f(uniforms.glyphCount, atlas.count);
    }
    blit(null);
}

// The ASCII filter's glyph ramp, drawn once into a texture: one 20×40 cell per
// glyph in a single row (1900 px, inside the 2048 every GPU allows), white on
// black, sorted from the least ink to the most.
function getGlyphAtlas () {
    if (glyphAtlas) return glyphAtlas;

    const texture = gl.createTexture();
    const font = '700 32px ' + getComputedStyle(document.body).fontFamily;
    const paint = () => {
        const cellWidth = 20, cellHeight = 40;
        const sheet = document.createElement('canvas');
        sheet.width = cellWidth * ASCII_RAMP.length;
        sheet.height = cellHeight;
        const ctx = sheet.getContext('2d', { willReadFrequently: true });
        const draw = glyphs => {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, sheet.width, sheet.height);
            ctx.fillStyle = '#fff';
            ctx.font = font;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < glyphs.length; i++)
                ctx.fillText(glyphs[i], i * cellWidth + cellWidth / 2, cellHeight / 2 + 1);
        };
        // measure the ink of every glyph in this font, then draw them again from the lightest to the darkest
        draw(ASCII_RAMP);
        const px = ctx.getImageData(0, 0, sheet.width, sheet.height).data, ink = new Array(ASCII_RAMP.length).fill(0);
        for (let y = 0; y < cellHeight; y++)
            for (let x = 0; x < sheet.width; x++) ink[Math.floor(x / cellWidth)] += px[(y * sheet.width + x) * 4];
        draw([...ASCII_RAMP].map((g, i) => [g, ink[i]]).sort((a, b) => a[1] - b[1]).map(e => e[0]));

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    paint();
    // The UI webfont may still be loading — repaint with the real face once it arrives.
    if (document.fonts && document.fonts.load)
        document.fonts.load(font).then(paint, () => {});

    glyphAtlas = {
        texture,
        count: ASCII_RAMP.length,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };
    return glyphAtlas;
}

function drawColor (target, color) {
    colorProgram.bind();
    gl.uniform4f(colorProgram.uniforms.color, color.r, color.g, color.b, 1);
    blit(target);
}

function drawCheckerboard (target) {
    checkerboardProgram.bind();
    gl.uniform1f(checkerboardProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    blit(target);
}

function drawDisplay (target) {
    let width = target == null ? gl.drawingBufferWidth : target.width;
    let height = target == null ? gl.drawingBufferHeight : target.height;

    displayMaterial.bind();
    if (config.SHADING)
        gl.uniform2f(displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);
    gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
    if (config.BLOOM) {
        gl.uniform1i(displayMaterial.uniforms.uBloom, bloom.attach(1));
        gl.uniform1i(displayMaterial.uniforms.uDithering, ditheringTexture.attach(2));
        let scale = getTextureScale(ditheringTexture, width, height);
        gl.uniform2f(displayMaterial.uniforms.ditherScale, scale.x, scale.y);
    }
    if (config.SUNRAYS)
        gl.uniform1i(displayMaterial.uniforms.uSunrays, sunrays.attach(3));
    blit(target);
}

function applyBloom (source, destination) {
    if (bloomFramebuffers.length < 2)
        return;

    let last = destination;

    gl.disable(gl.BLEND);
    bloomPrefilterProgram.bind();
    let knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001;
    let curve0 = config.BLOOM_THRESHOLD - knee;
    let curve1 = knee * 2;
    let curve2 = 0.25 / knee;
    gl.uniform3f(bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2);
    gl.uniform1f(bloomPrefilterProgram.uniforms.threshold, config.BLOOM_THRESHOLD);
    gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0));
    blit(last);

    bloomBlurProgram.bind();
    for (let i = 0; i < bloomFramebuffers.length; i++) {
        let dest = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        blit(dest);
        last = dest;
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);

    for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
        let baseTex = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        gl.viewport(0, 0, baseTex.width, baseTex.height);
        blit(baseTex);
        last = baseTex;
    }

    gl.disable(gl.BLEND);
    bloomFinalProgram.bind();
    gl.uniform2f(bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
    gl.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0));
    gl.uniform1f(bloomFinalProgram.uniforms.intensity, config.BLOOM_INTENSITY);
    blit(destination);
}

function applySunrays (source, mask, destination) {
    gl.disable(gl.BLEND);
    sunraysMaskProgram.bind();
    gl.uniform1i(sunraysMaskProgram.uniforms.uTexture, source.attach(0));
    blit(mask);

    sunraysProgram.bind();
    gl.uniform1f(sunraysProgram.uniforms.weight, config.SUNRAYS_WEIGHT);
    gl.uniform1i(sunraysProgram.uniforms.uTexture, mask.attach(0));
    blit(destination);
}

function blur (target, temp, iterations) {
    blurProgram.bind();
    for (let i = 0; i < iterations; i++) {
        gl.uniform2f(blurProgram.uniforms.texelSize, target.texelSizeX, 0.0);
        gl.uniform1i(blurProgram.uniforms.uTexture, target.attach(0));
        blit(temp);

        gl.uniform2f(blurProgram.uniforms.texelSize, 0.0, target.texelSizeY);
        gl.uniform1i(blurProgram.uniforms.uTexture, temp.attach(0));
        blit(target);
    }
}

function splatPointer (pointer) {
    let dx = pointer.deltaX * config.SPLAT_FORCE;
    let dy = pointer.deltaY * config.SPLAT_FORCE;
    splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
}

function multipleSplats (amount) {
    for (let i = 0; i < amount; i++) {
        const color = generateColor();
        color.r *= 10.0;
        color.g *= 10.0;
        color.b *= 10.0;
        const x = Math.random();
        const y = Math.random();
        const dx = 1000 * (Math.random() - 0.5);
        const dy = 1000 * (Math.random() - 0.5);
        splat(x, y, dx, dy, color);
    }
}

function splat (x, y, dx, dy, color) {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
}

function correctRadius (radius) {
    let aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1)
        radius *= aspectRatio;
    return radius;
}

// The choreographed modes (see RIGS) are built from two things: pushes that move the fluid
// without colouring it, and stamps of dye that colour it without moving it.
function splatPush (x, y, dx, dy, radius) {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(radius / 100.0));
    blit(velocity.write);
    velocity.swap();
}

// Stamps wait in a queue per kind and are drawn STAMP_BATCH to a blit (see stampSource); they
// only add, so the order they are drawn in does not matter. flushStamps() draws what is waiting.
const stampQueues = stampPrograms.map(() => ({ shape: new Float32Array(STAMP_BATCH * 4), tint: new Float32Array(STAMP_BATCH * 4), extra: new Float32Array(STAMP_BATCH * 4), n: 0 }));

function stamp (kind, x, y, size, reach, color, a, e0, e1, e2, e3) {
    const q = stampQueues[kind], i = q.n * 4;
    q.shape[i] = x; q.shape[i + 1] = y; q.shape[i + 2] = size; q.shape[i + 3] = reach;
    q.tint[i] = color.r; q.tint[i + 1] = color.g; q.tint[i + 2] = color.b; q.tint[i + 3] = a;
    q.extra[i] = e0; q.extra[i + 1] = e1; q.extra[i + 2] = e2; q.extra[i + 3] = e3;
    if (++q.n === STAMP_BATCH) flushStamps(kind);
}

function flushStamps (kind) {
    if (kind === undefined) { stampQueues.forEach((q, k) => flushStamps(k)); return; }
    const q = stampQueues[kind], uniforms = stampPrograms[kind].uniforms;
    if (q.n === 0) return;
    stampPrograms[kind].bind();
    gl.uniform1i(uniforms.uTarget, dye.read.attach(0));
    gl.uniform1f(uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform1i(uniforms.count, q.n);
    gl.uniform4fv(uniforms['shape[0]'], q.shape);
    gl.uniform4fv(uniforms['tint[0]'], q.tint);
    if (uniforms['extra[0]']) gl.uniform4fv(uniforms['extra[0]'], q.extra);
    blit(dye.write);
    dye.swap();
    q.n = 0;
}

// A soft round spot of dye. radius: in SPLAT_RADIUS units, like a splat's.
function dotDye (x, y, color, radius) {
    stamp(STAMP_DOT, x, y, correctRadius(radius / 100.0), 0, color, 0, 0, 0, 0, 0);
}

// A ripple: a ring of dye trailed by up to three more, `gap` apart, whose weights are `lobes`
// (trough, second crest, second trough). Drawn a little wider on every frame it really travels,
// which the fluid cannot do for it (it is incompressible, so a ring cannot push outward all
// round). A negative lobe is negative dye: it takes back what an earlier ring left there, so
// the ripple stays a thin moving line instead of filling in, and where two ripples cross they
// add and cancel like waves. ringRadius, gap: in screen heights. thickness: in SPLAT_RADIUS units.
function ringDye (x, y, ringRadius, color, thickness, gap, lobes) {
    const variance = correctRadius(thickness / 100.0);
    stamp(STAMP_RING, x, y, ringRadius, 3.5 * Math.sqrt(variance), color, variance, gap, lobes[0], lobes[1], lobes[2]);
}
const RING_RIPPLE = [-0.92, 0, 0];

// A jellyfish. radius: of the bell, in screen heights. squeeze: 0 relaxed .. 1 contracted.
// (upX, upY): the unit vector it points along. sway: how far its tentacles hang to one side.
function bellDye (x, y, radius, squeeze, upX, upY, sway, color) {
    stamp(STAMP_BELL, x, y, radius, 0, color, squeeze, upX, upY, sway, 0);
}

// One raindrop ripple, rendered by the one-pass ring shader: a continuous
// gaussian annulus of dye centred on (x, y), with a matching radial outward
// push so the ring expands into a real concentric ripple over the following
// frames. Two fullscreen blits total (velocity + dye) — the previous JS-loop
// version needed up to 96. The shader aspect-corrects internally, so the
// ripple is a true circle on screen for any canvas shape. `thickness` is in
// config.SPLAT_RADIUS units and controls the width of the ring's cross-section.
function splatRing (x, y, ringRadius, ringForce, color, thickness = config.SPLAT_RADIUS) {
    ringProgram.bind();
    gl.uniform1f(ringProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(ringProgram.uniforms.point, x, y);
    gl.uniform1f(ringProgram.uniforms.radius, ringRadius);
    gl.uniform1f(ringProgram.uniforms.thickness, correctRadius(thickness / 100.0));
    // Velocity pass — radial outward push along the annulus
    gl.uniform1i(ringProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(ringProgram.uniforms.velocityPass, 1.0);
    gl.uniform1f(ringProgram.uniforms.force, ringForce);
    blit(velocity.write);
    velocity.swap();
    // Dye pass — tint the same annulus
    gl.uniform1i(ringProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform1f(ringProgram.uniforms.velocityPass, 0.0);
    gl.uniform3f(ringProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
}

// Emit a splat plus its N-fold rotated copies around the canvas center —
// the KALEIDO mode's mirror symmetry. Rotation happens in aspect-corrected
// space so the mandala stays rotationally symmetric on screen, not just in
// UV coordinates.
const KALEIDO_SYMMETRY = 6;
function emitKaleido (x, y, dx, dy, color) {
    const aspect = canvas.width / canvas.height;
    const px = (x - 0.5) * aspect, py = y - 0.5;
    const vx = dx * aspect,        vy = dy;
    for (let k = 0; k < KALEIDO_SYMMETRY; k++) {
        const a = (k / KALEIDO_SYMMETRY) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        splat(
            0.5 + (px * ca - py * sa) / aspect,
            0.5 + (px * sa + py * ca),
            (vx * ca - vy * sa) / aspect,
            vx * sa + vy * ca,
            color);
    }
}

// ============================================================
// Mouse/touch input is removed — flow is driven by audio below.
// `pause` keybinding kept for convenience.
// ============================================================
window.addEventListener('keydown', e => {
    if (e.code === 'KeyP') config.PAUSED = !config.PAUSED;
    if (e.code === 'KeyD') document.getElementById('debug').classList.toggle('visible');
});

function generateColor () {
    let c = HSVtoRGB(Math.random(), 1.0, 1.0);
    c.r *= 0.15;
    c.g *= 0.15;
    c.b *= 0.15;
    return c;
}

function HSVtoRGB (h, s, v) {
    let r, g, b, i, f, p, q, t;
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }

    return {
        r,
        g,
        b
    };
}

function normalizeColor (input) {
    let output = {
        r: input.r / 255,
        g: input.g / 255,
        b: input.b / 255
    };
    return output;
}

function wrap (value, min, max) {
    let range = max - min;
    if (range == 0) return min;
    return (value - min) % range + min;
}

function getResolution (resolution) {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1)
        aspectRatio = 1.0 / aspectRatio;

    let min = Math.round(resolution);
    let max = Math.round(resolution * aspectRatio);

    if (gl.drawingBufferWidth > gl.drawingBufferHeight)
        return { width: max, height: min };
    else
        return { width: min, height: max };
}

function getTextureScale (texture, width, height) {
    return {
        x: width / texture.width,
        y: height / texture.height
    };
}

function scaleByPixelRatio (input) {
    let pixelRatio = window.devicePixelRatio || 1;
    return Math.floor(input * pixelRatio);
}

function hashCode (s) {
    if (s.length == 0) return 0;
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};


// ============================================================
// AUDIO ENGINE
// Microphone → AnalyserNode → derives:
//   bands[6]  log-spaced frequency-band energies (0..1)
//   volume    time-domain RMS (0..1)
//   onset     spectral-flux based transient flag (per frame)
// ============================================================

const BAND_EDGES_HZ = [60, 200, 500, 1500, 3000, 6000, 12000];
const NUM_BANDS = BAND_EDGES_HZ.length - 1; // 6

// ============================================================
// RHYTHM — what the music is doing, not how loud it is.
//
// The six display bands above are levels on a dB scale, smoothed twice, and
// their 70 dB window clips loud bass: a kick drum moves the sub band from
// about 0.86 to 0.91. Anything driven by them flows like a tap, it does not
// dance. Rhythm listens to a second, unsmoothed analyser with headroom
// (see _initAnalyserOnce) and reports events instead:
//
//   low   35-110 Hz    kick drum, bass notes
//   mid   250-2500 Hz  snare, clap, chords, voice
//   high  5-14 kHz     hats, cymbals, air
// (and 110-230 Hz, heard only to catch a kick's punch a frame sooner)
//
// For each range, every frame:
//   struck   true on the frame a transient lands
//   hit      how much strength arrived this frame. A hit is called on the first
//            frame it shows, before its size is known, so the rest of it
//            arrives over the next frame or two; the parts add up to
//   strength the size of the current hit: 0.3 a ghost note, 1 a solid hit,
//            1.3 an accent
//   env      the last hit, decaying (instant attack, musical release)
//   level    0..1 sustained loudness, relative to the range's own recent peak
// and `snare` (with `snareEnv`): set once per mid hit that turns out to be
// broadband, i.e. a snare or a clap rather than a note; and `drop`: true on the
// kick that comes back after the kicks went missing for a beat or more (the
// first bar after a breakdown, a fill, a rest) — the moment to do something big.
//
// A transient is measured as spectral flux in linear amplitude: how much each
// bin rose over the last ~30 ms, summed over the range and divided by the
// range's recent peak. So 1 means "as much new sound as this range ever gets
// in this song" whether the source is a quiet microphone or a loud file, and
// a faint click in a silence stays faint. The threshold follows the range's
// own recent flux, so a busy passage does not fire on every wobble.
// ============================================================
const RHYTHM_RANGES = [
    // floor: least flux that counts; cool: share of the cooldown knob; release: env / level decay (s)
    { name: 'low',  lo: 35,   hi: 110,   floor: 0.22, cool: 0.30, release: 0.30 },
    { name: 'mid',  lo: 250,  hi: 2500,  floor: 0.16, cool: 0.26, release: 0.20 },
    { name: 'high', lo: 5000, hi: 14000, floor: 0.16, cool: 0.17, release: 0.10 },
    { name: 'bass', lo: 110,  hi: 230,   floor: 0.22, cool: 0.30, release: 0.30 },   // a kick's punch, a snare's body
];
const RHYTHM_MIN_DB = -120, RHYTHM_MAX_DB = -10;      // the rhythm analyser's window: room for a quiet microphone, headroom for a loud file
const RHYTHM_HISTORY = 8;                             // spectra kept, to measure a rise over ~30 ms at any frame rate
const RHYTHM_AMP = new Float32Array(256);             // analyser byte -> linear amplitude
for (let i = 0; i < 256; i++) RHYTHM_AMP[i] = Math.pow(10, (RHYTHM_MIN_DB + i * (RHYTHM_MAX_DB - RHYTHM_MIN_DB) / 255) / 20);
const RHYTHM_SILENCE = RHYTHM_AMP[0];

class Rhythm {
    constructor (binHz, binCount) {
        this.ranges = RHYTHM_RANGES.map(r => ({
            ...r,
            k0: Math.max(1, Math.round(r.lo / binHz)),
            k1: Math.min(binCount - 1, Math.round(r.hi / binHz)),
        }));
        [this.low, this.mid, this.high, this.bass] = this.ranges;
        this.history = [];
        for (let i = 0; i < RHYTHM_HISTORY; i++) this.history.push(new Uint8Array(binCount));
        this.reset();
    }

    reset () {
        for (const r of this.ranges) {
            r.amp = RHYTHM_SILENCE;     // mean amplitude of the range, this frame
            r.peak = RHYTHM_SILENCE;    // its recent peak — the range's own automatic gain
            r.flux = 0;                 // new sound this frame, relative to that peak
            r.mean = r.floor / 2.2;     // running flux, the adaptive part of the threshold
            r.last = -1e9;              // time of the last hit, ms
            r.struck = false; r.hit = 0; r.strength = 0; r.env = 0; r.level = 0;
        }
        for (const h of this.history) h.fill(0);
        this.head = 0;
        this.t = -1;                    // time of the last update, ms
        this.dt = 1 / 60;
        this.peak = RHYTHM_SILENCE;     // loudest range lately — the overall automatic gain
        this.loudness = 0;              // 0..1, how close the music is to its recent peak (0 in silence)
        this.snare = 0; this.snareEnv = 0;
        this.snareCalled = true;        // whether the current mid hit has already been judged a snare
        this.beat = 0;                  // count of low hits: lets a mode alternate left / right, big / small
        this.quiet = 1e9;               // seconds since the last low hit
        this.drop = false;
        this.kickGap = 0;               // seconds since the last solid kick (strength >= 0.85)
        this.kickEvery = 0.5;           // their usual spacing, seconds
        this.kickJitter = 1;            // how irregular that spacing is (0 = a metronome)
        this.solid = -1e9;              // the last low hit already counted as a solid kick
    }

    // bytes: the rhythm analyser's frequency data. now: ms. sensitivity, cooldownMs: the onset knobs.
    update (bytes, now, sensitivity, cooldownMs) {
        const dt = this.t < 0 ? 1 / 60 : Math.min(0.1, Math.max(1 / 240, (now - this.t) / 1000));
        this.t = now; this.dt = dt;
        const lag = Math.min(RHYTHM_HISTORY - 1, Math.max(1, Math.round(0.030 / dt)));
        const past = this.history[(this.head - lag + RHYTHM_HISTORY) % RHYTHM_HISTORY];
        const AMP = RHYTHM_AMP;

        let loudest = RHYTHM_SILENCE;
        for (const r of this.ranges) {
            let rise = 0, sum = 0;
            for (let k = r.k0; k <= r.k1; k++) {
                const a = AMP[bytes[k]], d = a - AMP[past[k]];
                if (d > 0) rise += d;
                sum += a;
            }
            const n = r.k1 - r.k0 + 1;
            r.amp = sum / n;
            r.rise = rise / n;
            if (r.amp > loudest) loudest = r.amp;
        }
        this.history[this.head].set(bytes);
        this.head = (this.head + 1) % RHYTHM_HISTORY;

        // Automatic gain: everything is judged against the recent peak, which lets go slowly (3 dB/s).
        // Below about -80 dB the "music" is mostly the room, so the picture dims instead of following it down.
        this.peak = Math.max(loudest, this.peak * Math.pow(10, -3 * dt / 20), RHYTHM_SILENCE);
        const presence = Math.min(1, Math.max(0, (20 * Math.log10(this.peak) + 98) / 18));
        this.loudness = presence * Math.min(1, Math.max(0, 1 + 20 * Math.log10(loudest / this.peak) / 24));
        this.quiet += dt;

        const factor = 1.15 + 0.85 * sensitivity, release = Math.pow(10, -4 * dt / 20);
        for (const r of this.ranges) {
            // a range may turn itself up by 36 dB at most: hats far below the bass still count, hiss does not
            r.peak = Math.max(r.amp, r.peak * release, this.peak * 0.016);
            r.flux = r.rise / r.peak;
            r.threshold = Math.max(r.floor, r.mean * factor);
            // the running flux ignores the height of the spikes, or a busy bar would deafen the next one
            r.mean += (Math.min(r.flux, r.threshold * 1.5) - r.mean) * (1 - Math.exp(-dt / 0.5));
            const level = Math.min(1, Math.max(0, 1 + Math.log10(r.amp / r.peak))) * presence;     // 20 dB below the peak = 0
            r.level = level > r.level ? level : r.level + (level - r.level) * (1 - Math.exp(-dt / r.release));
            r.env *= Math.exp(-dt / r.release);
            r.struck = false; r.hit = 0;
        }
        this.snareEnv *= Math.exp(-dt / 0.16);
        this.snare = 0;
        this.drop = false;
        this.kickGap += dt;

        const { low, mid, high, bass } = this;
        const ATTACK = 70;                       // ms during which a hit can still grow to its real size
        const size = flux => Math.min(1.3, Math.max(0.3, flux / 0.6)) * presence;
        const strike = (r, flux) => {
            if (flux <= 0 || presence <= 0) return;
            if (now - r.last > cooldownMs * r.cool) {
                r.last = now; r.struck = true; r.strength = r.hit = size(flux);
            } else if (now - r.last <= ATTACK && size(flux) > r.strength) {
                r.hit = size(flux) - r.strength; r.strength += r.hit;
            }
            if (r.strength > r.env && now - r.last <= ATTACK) r.env = r.strength;
        };

        // Kick: its body rises in `low`. Its punch often rises in `bass` a frame or two earlier — but so
        // does the body of a snare, which gives itself away by rising just as much in the mid range.
        const punch = bass.flux > bass.threshold && mid.flux < 0.6 * bass.flux ? bass.flux : 0;
        strike(low, Math.max(low.flux > low.threshold ? low.flux : 0, punch));
        if (low.struck) { this.beat++; this.quiet = 0; }
        // A solid kick, counted once it has shown its size. It is the drop if the kicks had gone
        // missing: for a steady four-on-the-floor one skipped beat is enough, for a syncopated
        // pattern (whose rests are part of the groove) it takes a real pause.
        if (low.strength >= 0.85 && this.solid !== low.last) {
            this.solid = low.last;
            const steady = this.kickJitter < 0.15;
            this.drop = this.kickGap >= (steady ? Math.max(0.6, 1.8 * this.kickEvery) : Math.max(1.0, 2.5 * this.kickEvery));
            if (this.kickGap < 2) {
                this.kickJitter += (Math.abs(this.kickGap - this.kickEvery) / this.kickEvery - this.kickJitter) * 0.25;
                this.kickEvery += (this.kickGap - this.kickEvery) * 0.25;
            }
            this.kickGap = 0;
        }

        // Mid: a note, a chord, a snare. Not the click on top of a kick, which is small next to its body.
        const own = mid.flux >= 0.5 * Math.max(low.flux, bass.flux * 0.8);
        strike(mid, mid.flux > mid.threshold && own ? mid.flux : 0);
        if (mid.struck) this.snareCalled = false;
        if (!this.snareCalled && now - mid.last <= ATTACK && mid.flux >= 0.45 && high.flux >= 0.3) {
            this.snareCalled = true;
            this.snare = Math.max(mid.strength, size(mid.flux));
            this.snareEnv = Math.max(this.snareEnv, this.snare);
        }

        strike(high, high.flux > high.threshold ? high.flux : 0);
    }
}

class AudioAnalyzer {
    constructor () {
        this.ready = false;
        this.ctx = null;
        this.analyser = null;
        this.freqData = null;
        this.timeData = null;
        this.bands = new Array(NUM_BANDS).fill(0);
        this.smoothedBands = new Array(NUM_BANDS).fill(0);
        this.volume = 0;
        this.smoothedVolume = 0;
        this.onset = false;
        this.prevSpectrum = null;
        this.beatAnalyser = null;   // unsmoothed tap for the Rhythm analysis
        this.beatData = null;
        this.rhythm = null;         // Rhythm instance: hits, envelopes and levels per range
        this.fluxHistory = [];   // rolling window of recent flux values
        this.fluxHistoryMax = 43; // ~700ms at 60fps
        this.lastOnsetTime = 0;
        this.binToHz = 0;
        this.bandBinRanges = []; // [{lo, hi}] for each band

        // Multi-source mixer state. Each source feeds the analyser through its
        // own GainNode (a fader); all gains sum into mixBus -> analyser.
        this.sources = [];               // [{ id, kind, label, node, gain, stream, mediaEl, muted, level }]
        this.mixBus = null;              // GainNode summing every source into the analyser
        this._nextSourceId = 1;
        this.currentDeviceId = null;     // last mic device added (for device-picker highlight)
        this.onSourcesChanged = null;    // UI callback: a source was added / removed / ended

        // iOS/Safari suspend the AudioContext on tab switch, screen lock or
        // an incoming call (state becomes 'suspended', or WebKit's private
        // 'interrupted') and don't reliably resume it — the page comes back
        // with a silent analyser. Nudge it awake whenever the page becomes
        // active again, and on the next touch as a belt-and-braces fallback.
        const tryResume = () => {
            if (this.ctx && this.ctx.state !== 'running') {
                this.ctx.resume().catch(() => {});
            }
        };
        document.addEventListener('visibilitychange', () => { if (!document.hidden) tryResume(); });
        window.addEventListener('pageshow', tryResume);
        window.addEventListener('focus', tryResume);
        document.addEventListener('touchend', tryResume, { passive: true });
    }

    async _ensureContext () {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') await this.ctx.resume();
    }

    _initAnalyserOnce () {
        if (this.analyser) return;
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.7;
        // Mixer bus: every source's gain connects here; this feeds the analyser.
        this.mixBus = this.ctx.createGain();
        this.mixBus.connect(this.analyser);
        // Rhythm tap on the same bus: unsmoothed, with a window wide enough for a quiet
        // microphone and a loud file alike. See the Rhythm class.
        this.beatAnalyser = this.ctx.createAnalyser();
        this.beatAnalyser.fftSize = 2048;
        this.beatAnalyser.smoothingTimeConstant = 0;
        this.beatAnalyser.minDecibels = RHYTHM_MIN_DB;
        this.beatAnalyser.maxDecibels = RHYTHM_MAX_DB;
        this.mixBus.connect(this.beatAnalyser);
        this.beatData = new Uint8Array(this.beatAnalyser.frequencyBinCount);
        this.rhythm = new Rhythm(this.ctx.sampleRate / this.beatAnalyser.fftSize, this.beatAnalyser.frequencyBinCount);
        const binCount = this.analyser.frequencyBinCount;
        this.freqData = new Uint8Array(binCount);
        this.timeData = new Uint8Array(this.analyser.fftSize);
        this.prevSpectrum = new Float32Array(binCount);
        this.binToHz = this.ctx.sampleRate / this.analyser.fftSize;
        for (let i = 0; i < NUM_BANDS; i++) {
            const lo = Math.max(0, Math.floor(BAND_EDGES_HZ[i] / this.binToHz));
            const hi = Math.min(binCount - 1, Math.ceil(BAND_EDGES_HZ[i + 1] / this.binToHz));
            this.bandBinRanges.push({ lo, hi: Math.max(lo + 1, hi) });
        }
    }

    // Wire a new source into the mixer: node -> per-source gain -> mixBus.
    _registerSource ({ kind, node, label, stream = null, mediaEl = null, toDestination = false }) {
        const gain = this.ctx.createGain();
        node.connect(gain);
        gain.connect(this.mixBus);
        // File playback must also reach the speakers; mic / system must NOT
        // (routing those to the output would feed back / echo).
        if (toDestination) gain.connect(this.ctx.destination);
        const src = {
            id: this._nextSourceId++,
            kind, node, gain, stream, mediaEl, label,
            muted: false, level: 1,
        };
        this.sources.push(src);
        this.ready = true;
        if (this.onSourcesChanged) this.onSourcesChanged();
        return src;
    }

    removeSource (id) {
        const i = this.sources.findIndex(s => s.id === id);
        if (i === -1) return;
        const s = this.sources[i];
        try { s.node.disconnect(); } catch (e) {}
        try { s.gain.disconnect(); } catch (e) {}
        if (s.stream) s.stream.getTracks().forEach(t => t.stop());
        if (s.mediaEl) {
            s.mediaEl.pause();
            try { URL.revokeObjectURL(s.mediaEl.src); } catch (e) {}
        }
        this.sources.splice(i, 1);
        if (this.sources.length === 0) {
            this.ready = false;
            // Reset transient state so the next source doesn't inherit old flux
            this.fluxHistory.length = 0;
            if (this.prevSpectrum) this.prevSpectrum.fill(0);
            if (this.rhythm) this.rhythm.reset();
        }
        if (this.onSourcesChanged) this.onSourcesChanged();
    }

    setSourceLevel (id, level) {
        const s = this.sources.find(s => s.id === id);
        if (!s) return;
        s.level = level;
        if (!s.muted) s.gain.gain.value = level;
    }

    setSourceMuted (id, muted) {
        const s = this.sources.find(s => s.id === id);
        if (!s) return;
        s.muted = muted;
        s.gain.gain.value = muted ? 0 : s.level;
    }

    // A stream track ended on its own (mic unplugged, screen-share stopped).
    _onSourceTrackEnded (id) {
        this.removeSource(id);
    }

    async addMicrophone (deviceId) {
        // Fail fast with a precise reason BEFORE touching getUserMedia, so the
        // UI can tell file:// apart from an in-app webview apart from a real
        // permission denial — instead of a generic "didn't start".
        if (!window.isSecureContext) {
            throw new Error('INSECURE_CONTEXT');      // file:// or plain http (not localhost)
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('NO_MEDIA_DEVICES');       // in-app webview / unsupported browser
        }
        const audioConstraints = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        };
        if (deviceId) audioConstraints.deviceId = { exact: deviceId };
        // getUserMedia FIRST, before any other await — Safari (iOS and macOS)
        // only shows the permission prompt inside a user activation, and
        // awaiting AudioContext setup first can drop out of it.
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        } catch (err) {
            // Safari can choke on the audio-processing constraints themselves
            // and report "no input found" even though a mic exists — retry
            // once with the plainest possible request before giving up.
            const n = err && err.name;
            if (n === 'OverconstrainedError' || n === 'NotFoundError' || n === 'TypeError') {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
                });
            } else {
                throw err;
            }
        }
        // Create the AudioContext AFTER the mic is live. WebKit locks the
        // context to the hardware sample rate at construction; on iOS the
        // audio route often switches when the mic activates (e.g. 48000 →
        // 44100), and a context built on the old rate reads pure silence
        // from createMediaStreamSource. If a context already exists at the
        // wrong rate and nothing else is using it, rebuild it.
        const track = stream.getAudioTracks()[0];
        const settings = track.getSettings ? track.getSettings() : {};
        if (this.ctx && this.sources.length === 0 &&
            settings.sampleRate && this.ctx.sampleRate !== settings.sampleRate) {
            try { this.ctx.close(); } catch (e) {}
            this.ctx = null;
            this.analyser = null;      // rebuild analysers + mix bus on the new context
            this.beatAnalyser = null;
            this.rhythm = null;
            this.mixBus = null;
            this.bandBinRanges = [];
        }
        await this._ensureContext();
        this._initAnalyserOnce();
        this.currentDeviceId = deviceId || settings.deviceId;
        const node = this.ctx.createMediaStreamSource(stream);
        // Pick a friendlier label from the device's actual name if available
        const label = track.label ? track.label.toUpperCase().slice(0, 24) : 'MIC';
        const src = this._registerSource({ kind: 'mic', node, label, stream });
        stream.getAudioTracks().forEach(t => {
            t.onended = () => this._onSourceTrackEnded(src.id);
        });
        return src;
    }

    // Enumerate all audio input devices. Browsers hide device labels until
    // permission has been granted at least once, so we trigger a one-shot
    // getUserMedia() to unlock them, then immediately stop that stream.
    async listInputDevices () {
        let tempStream = null;
        try {
            // Only request a temp stream if we don't already have permission.
            // If labels are already populated, skip the prompt.
            let devices = await navigator.mediaDevices.enumerateDevices();
            const needPermission = devices
                .filter(d => d.kind === 'audioinput')
                .every(d => !d.label);
            if (needPermission) {
                tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                devices = await navigator.mediaDevices.enumerateDevices();
            }
            return devices.filter(d => d.kind === 'audioinput').map(d => ({
                deviceId: d.deviceId,
                label: d.label || 'Audio input',
                groupId: d.groupId,
            }));
        } finally {
            if (tempStream) tempStream.getTracks().forEach(t => t.stop());
        }
    }

    async addDisplay () {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            throw new Error('UNSUPPORTED');
        }
        // Picker first (user-gesture safety, same as addMicrophone), and
        // shape it toward choices that actually carry audio: hide this page's
        // own tab, and on macOS hide "Entire screen" — no browser can capture
        // whole-screen audio on a Mac, only TAB shares have audio there.
        // Unknown dictionary members are ignored by other browsers.
        const displayOpts = {
            video: true,            // required by spec even though we only want audio
            audio: true,
            selfBrowserSurface: 'exclude',
        };
        if (isMacPlatform()) displayOpts.monitorTypeSurfaces = 'exclude';
        const stream = await navigator.mediaDevices.getDisplayMedia(displayOpts);
        await this._ensureContext();
        this._initAnalyserOnce();
        // Drop video tracks immediately to save GPU/network
        stream.getVideoTracks().forEach(t => t.stop());
        if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach(t => t.stop());
            throw new Error('NO_AUDIO_TRACK');
        }
        const node = this.ctx.createMediaStreamSource(stream);
        const src = this._registerSource({ kind: 'display', node, label: 'SYSTEM', stream });
        stream.getAudioTracks().forEach(t => {
            t.onended = () => this._onSourceTrackEnded(src.id);
        });
        return src;
    }

    async addFile (file) {
        await this._ensureContext();
        this._initAnalyserOnce();
        const url = URL.createObjectURL(file);
        const audioEl = new Audio();
        audioEl.src = url;
        audioEl.loop = true;
        audioEl.crossOrigin = 'anonymous';
        const node = this.ctx.createMediaElementSource(audioEl);
        await audioEl.play();
        // toDestination: file audio is also sent to the speakers (mic/system aren't)
        const src = this._registerSource({
            kind: 'file', node, label: 'FILE: ' + (file.name || 'audio'),
            mediaEl: audioEl, toDestination: true,
        });
        return src;
    }

    tick () {
        if (!this.ready) return;
        this.analyser.getByteFrequencyData(this.freqData);
        this.analyser.getByteTimeDomainData(this.timeData);

        // Per-band mean energy, normalized to 0..1
        for (let i = 0; i < NUM_BANDS; i++) {
            const { lo, hi } = this.bandBinRanges[i];
            let sum = 0;
            for (let k = lo; k < hi; k++) sum += this.freqData[k];
            const mean = sum / (hi - lo) / 255;
            this.bands[i] = mean;
            // Slight smoothing to avoid stuttering splats
            this.smoothedBands[i] = this.smoothedBands[i] * 0.6 + mean * 0.4;
        }

        // RMS volume from time-domain (centred at 128)
        let sqSum = 0;
        for (let k = 0; k < this.timeData.length; k++) {
            const v = (this.timeData[k] - 128) / 128;
            sqSum += v * v;
        }
        this.volume = Math.sqrt(sqSum / this.timeData.length);
        this.smoothedVolume = this.smoothedVolume * 0.85 + this.volume * 0.15;

        // Spectral flux for onset detection
        let flux = 0;
        for (let k = 0; k < this.freqData.length; k++) {
            const cur = this.freqData[k] / 255;
            const d = cur - this.prevSpectrum[k];
            if (d > 0) flux += d;
            this.prevSpectrum[k] = cur;
        }
        // Normalize roughly
        flux /= this.freqData.length;

        // Maintain rolling history and compute mean baseline
        this.fluxHistory.push(flux);
        if (this.fluxHistory.length > this.fluxHistoryMax) this.fluxHistory.shift();
        let mean = 0;
        for (let i = 0; i < this.fluxHistory.length; i++) mean += this.fluxHistory[i];
        mean /= Math.max(1, this.fluxHistory.length);

        const now = performance.now();
        const threshold = mean * AUDIO.ONSET_SENSITIVITY + 0.0005; // adaptive + floor
        this.onset = false;
        if (flux > threshold && (now - this.lastOnsetTime) > AUDIO.ONSET_COOLDOWN_MS && this.volume > 0.02) {
            this.onset = true;
            this.lastOnsetTime = now;
        }

        if (this.rhythm) {
            this.beatAnalyser.getByteFrequencyData(this.beatData);
            this.rhythm.update(this.beatData, now, AUDIO.ONSET_SENSITIVITY, AUDIO.ONSET_COOLDOWN_MS);
        }
    }
}

// ============================================================
// AUDIO → FLUID
// Maps each frequency band to a fixed anchor on the canvas.
// Each anchor wobbles slowly so colors are not pinned in a line.
// Onsets fire `multipleSplats` for extra punch.
// ============================================================

const BAND_ANCHORS = [
    { baseX: 0.18, baseY: 0.55, hue: 0.00 }, // sub-bass — red
    { baseX: 0.32, baseY: 0.45, hue: 0.08 }, // bass     — orange
    { baseX: 0.46, baseY: 0.58, hue: 0.55 }, // low-mid  — cyan
    { baseX: 0.60, baseY: 0.42, hue: 0.66 }, // mid      — blue
    { baseX: 0.74, baseY: 0.55, hue: 0.78 }, // high-mid — violet
    { baseX: 0.88, baseY: 0.45, hue: 0.92 }, // air      — magenta
];

// All audio-mapping knobs live here so the settings panel can mutate them.
const AUDIO = {
    BAND_THRESHOLD: 0.08,     // ignore band energies under this (floor noise)
    SPLAT_FORCE: 1500,        // per-band push magnitude
    VOLUME_GAIN: 1.2,         // how much overall volume amplifies the force
    COLOR_GAIN: 0.41,         // upper-asymptote of per-splat dye brightness
    COLOR_KNEE: 1.6,          // soft-clip knee — larger = approaches gain faster
    VOLUME_COMPRESS: 0.2,     // > 0: louder volume → dimmer per-splat color (prevents whiteout)
    ENERGY_CURVE: 1.15,       // exponent applied to band energy — higher = punchier
    ANCHOR_WOBBLE: 0.05,      // how much each band's anchor drifts over time
    ONSET_SENSITIVITY: 1.3,   // flux must exceed mean × this to fire onset
    ONSET_COOLDOWN_MS: 365,   // min gap between consecutive onsets
    ONSET_BURST_BASE: 3,      // splats per onset, baseline
    ONSET_BURST_GAIN: 4.5,    // extra splats per unit of smoothed volume
};

// Soft-saturating brightness curve. Input: energy ≥ 0. Output: ∈ [0, gain).
// No matter how loud, the per-splat brightness can never exceed `gain`.
function softColor (energy, gain, knee) {
    return gain * (1 - Math.exp(-energy * knee));
}

// ============================================================
// PALETTE — decouples color from mode/trajectory.
//   FULL   — each band uses its own anchor hue (rainbow spread)
//   SINGLE — every splat picks a hue around `singleHue` with ±range jitter
//   MONO   — saturation = 0, brightness only (black / white / grey)
// AQUA trajectory still bumps the brightness so water tones pop.
// ============================================================
const PALETTE = {
    mode: 'FULL',          // 'FULL' | 'SINGLE' | 'MONO'
    singleHue: 0.5,        // 0..1 — base hue for SINGLE mode (0.5 = cyan)
    singleRange: 0.20,     // ±range jitter around singleHue
};

function paletteColor (bandIndex, baseIntensity) {
    // AQUA pumps brightness independently of the palette mode
    const isAqua = currentTrajectory === 'AQUA';
    const v = isAqua ? Math.min(1.0, baseIntensity * 2.0) : baseIntensity;

    if (PALETTE.mode === 'MONO') {
        return HSVtoRGB(0, 0, v);
    }
    if (PALETTE.mode === 'SINGLE') {
        let h = PALETTE.singleHue + (Math.random() - 0.5) * PALETTE.singleRange;
        h = ((h % 1) + 1) % 1;        // wrap to [0,1]
        return HSVtoRGB(h, 1.0, v);
    }
    // FULL — band anchor hue if known, else random across the spectrum
    const h = (bandIndex != null && bandIndex >= 0)
        ? BAND_ANCHORS[bandIndex].hue
        : Math.random();
    return HSVtoRGB(h, 1.0, v);
}

// Trajectory functions — given band index i and time t (seconds),
// each returns { x, y, dx, dy } where (x,y) ∈ [0,1]² is the splat
// position and (dx,dy) is a unit vector along the curve's tangent.
// The fluid will be pushed in that direction (so flow follows the path).
const TRAJECTORY = {
    RANDOM: (i, t) => {
        const ax = BAND_ANCHORS[i].baseX + Math.sin(t + i * 1.3) * AUDIO.ANCHOR_WOBBLE;
        const ay = BAND_ANCHORS[i].baseY + Math.cos(t * 0.9 + i * 0.7) * AUDIO.ANCHOR_WOBBLE;
        const ang = Math.random() * Math.PI * 2;
        return { x: ax, y: ay, dx: Math.cos(ang), dy: Math.sin(ang) };
    },
    LISSAJOUS: (i, t) => {
        const cx = 0.5, cy = 0.5;
        const rx = 0.34, ry = 0.30;
        const a = 2 + i * 0.5;        // x angular frequency
        const b = 3 + i * 0.3;        // y angular frequency
        const phi = i * 0.7;
        const T = t * 0.6;            // global slowdown
        const x = cx + rx * Math.sin(a * T + phi);
        const y = cy + ry * Math.sin(b * T);
        // dx/dT, dy/dT (tangent), then normalize
        const tx = a * Math.cos(a * T + phi);
        const ty = b * Math.cos(b * T);
        const len = Math.hypot(tx, ty) || 1;
        return { x, y, dx: tx / len, dy: ty / len };
    },
    ORBIT: (i, t) => {
        const cx = 0.5, cy = 0.5;
        const r = 0.14 + i * 0.04;    // each band on its own ring
        const speed = 0.5 + i * 0.12;
        const phi = i * (Math.PI * 2 / NUM_BANDS);
        const theta = speed * t + phi;
        const x = cx + r * Math.cos(theta);
        const y = cy + r * Math.sin(theta);
        // Tangent vector (perpendicular to radius)
        return { x, y, dx: -Math.sin(theta), dy: Math.cos(theta) };
    },
    SINE_WAVE: (i, t) => {
        // Each band travels left-right on its own horizontal lane,
        // bouncing via sin() so there's no wrap discontinuity.
        const yLane = 0.18 + (i + 0.5) / NUM_BANDS * 0.64;
        const xSpeed = 0.6;
        const x = 0.5 + 0.42 * Math.sin(xSpeed * t + i * 0.4);
        const yOmega = 3 + i * 0.4;
        const yAmp = 0.06;
        const y = yLane + yAmp * Math.sin(yOmega * t + i);
        const dx_dt = 0.42 * Math.cos(xSpeed * t + i * 0.4) * xSpeed;
        const dy_dt = yAmp * Math.cos(yOmega * t + i) * yOmega;
        const len = Math.hypot(dx_dt, dy_dt) || 1;
        return { x, y, dx: dx_dt / len, dy: dy_dt / len };
    },
    AQUA: (i, t) => {
        // Random x across the full width — don't cluster bubbles in band
        // columns (low-freq-heavy audio used to crowd the left side).
        // Slight y spread so bubbles aren't born in a perfect line.
        // Gentle horizontal drift makes them meander like jellyfish.
        const x = Math.random();
        const y = 0.03 + Math.random() * 0.04;
        const drift = (Math.random() - 0.5) * 0.18;
        const len = Math.hypot(drift, 1);
        return { x, y, dx: drift / len, dy: 1 / len };
    },
    BLINK: (i, t) => {
        // Each splat is a raindrop impact at a random (x, y) on the canvas.
        // Direction is fully random — the splat causes a tiny local turbulence
        // that the high-curl preset spins into ripple-like rings.
        const x = Math.random();
        const y = Math.random();
        const angle = Math.random() * Math.PI * 2;
        return { x, y, dx: Math.cos(angle), dy: Math.sin(angle) };
    },
    VORTEX: (i, t) => {
        // All bands feed ONE coherent whirlpool: each band rides its own ring
        // around the center, pushing tangentially (counter-clockwise) with a
        // slight inward pull so dye spirals toward the eye instead of flying
        // off. Geometry is aspect-corrected so the spiral is round on screen.
        const aspect = canvas.width / canvas.height;
        const r = 0.10 + (i / NUM_BANDS) * 0.26;          // height-fraction units
        const theta = t * (0.4 + i * 0.07) + i * 2.4;     // slow per-band drift
        const ca = Math.cos(theta), sa = Math.sin(theta);
        let dxA = -sa - ca * 0.25;                        // tangent + 25% inward
        let dyA =  ca - sa * 0.25;
        const len = Math.hypot(dxA, dyA) || 1;
        return {
            x: 0.5 + ca * r / aspect,
            y: 0.5 + sa * r,
            dx: (dxA / len) / aspect,
            dy: dyA / len,
        };
    },
    KALEIDO: (i, t) => {
        // Seed point for the 6-fold mirror (emitKaleido rotates the copies):
        // a random radius from the center — capped so every rotated copy
        // stays on screen for any aspect — at a random angle, pushed in a
        // blend of outward and tangential directions for petal-like swirls.
        const aspect = canvas.width / canvas.height;
        const radMax = Math.min(0.40, 0.45 * aspect);
        const rad = radMax * (0.18 + 0.82 * Math.random());
        const ang = Math.random() * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const mix = Math.random() * 0.8;                  // 0 = radial, 0.8 = mostly tangential
        const dxA = ca * (1 - mix) - sa * mix;
        const dyA = sa * (1 - mix) + ca * mix;
        const len = Math.hypot(dxA, dyA) || 1;
        return {
            x: 0.5 + ca * rad / aspect,
            y: 0.5 + sa * rad,
            dx: (dxA / len) / aspect,
            dy: dyA / len,
        };
    },
    COMET: (i, t) => {
        // Meteor shower: streaks spawn near the top edge and fly right-and-
        // down in near-parallel lanes; higher bands take slightly steeper
        // angles so the sky layers. (UV y = 1 is the top of the canvas.)
        const x = Math.random() * 0.55 - 0.05;
        const y = 0.70 + Math.random() * 0.28;
        const ang = -0.38 - i * 0.05 + (Math.random() - 0.5) * 0.10;
        return { x, y, dx: Math.cos(ang), dy: Math.sin(ang) };
    },
    PULSE: (i, t) => {
        // PULSE emits shader rings from the center (see applyAudioInputs);
        // position is the center and direction random-outward, only used as
        // a fallback if another code path consumes the trajectory directly.
        const ang = Math.random() * Math.PI * 2;
        return { x: 0.5, y: 0.5, dx: Math.cos(ang), dy: Math.sin(ang) };
    },
};

let currentTrajectory = 'RANDOM';

// ============================================================
// FILTER (post-processing layer over the canvas)
// Three flavours of effect:
//   1. CSS filters (FROST/DREAM/GRAIN/VIGNETTE) — handled by
//      .filter-overlay div + backdrop-filter / mix-blend-mode.
//   2. SVG glass-displacement filters (RIPPLE/PEBBLED/DIAMOND/MOLTEN)
//      — applied to the canvas via `filter: url(#…)`. JS patches each
//      filter's <feTurbulence> + <feDisplacementMap> + <feGaussianBlur>
//      attributes live, so the panel can mutate every variable.
//   3. Shader filters (REEDED/HALFTONE/ASCII/DITHER) — a WebGL pass over
//      the finished picture, see SHADER_FILTERS / drawFilter().
// ============================================================
const filterState = {
    name: 'NONE',
    intensity: 50,
    scale: 50,          // shader filters: feature size (flute width / dot pitch / glyph / pixel)
    // Per-glass parameters — reloaded from preset whenever the glass mode changes
    freqX: 0.018,
    freqY: 0.018,
    octaves: 3,
    seed: 5,
    blur: 0,
};

// Each glass preset bundles default values for every variable.
// baseScale = feDisplacementMap.scale at intensity=50.
const SVG_FILTERS = {
    RIPPLE:  { id: 'ripple-glass',  turbId: 'ripple-turb',  dispId: 'ripple-disp',  blurId: 'ripple-blur',
               type: 'fractalNoise', baseScale: 25,  freqX: 0.018,  freqY: 0.018,  octaves: 3, seed: 5,  blur: 0 },
    PEBBLED: { id: 'pebbled-glass', turbId: 'pebbled-turb', dispId: 'pebbled-disp', blurId: 'pebbled-blur',
               type: 'fractalNoise', baseScale: 14,  freqX: 0.050,  freqY: 0.050,  octaves: 2, seed: 7,  blur: 0 },
    DIAMOND: { id: 'diamond-glass', turbId: 'diamond-turb', dispId: 'diamond-disp', blurId: 'diamond-blur',
               type: 'turbulence',   baseScale: 22,  freqX: 0.050,  freqY: 0.050,  octaves: 1, seed: 11, blur: 0 },
    MOLTEN:  { id: 'molten-glass',  turbId: 'molten-turb',  dispId: 'molten-disp',  blurId: 'molten-blur',
               type: 'fractalNoise', baseScale: 100, freqX: 0.005,  freqY: 0.005,  octaves: 1, seed: 13, blur: 2 },
};

// True if any glass preset shares this name — used to gate panel knobs
function isGlassFilter (name) { return SVG_FILTERS[name] != null; }

// Pull the active glass preset's defaults into filterState so the panel
// knobs reflect the new baseline. Intensity is preserved.
function loadGlassPreset (name) {
    const def = SVG_FILTERS[name];
    if (!def) return;
    filterState.freqX   = def.freqX;
    filterState.freqY   = def.freqY;
    filterState.octaves = def.octaves;
    filterState.seed    = def.seed;
    filterState.blur    = def.blur;
}

function applyFilter () {
    shaderFilter = SHADER_FILTERS[filterState.name] || null;   // picked up by render()

    const el = document.getElementById('filter-overlay');
    if (!el) return;
    el.setAttribute('data-filter', filterState.name);
    el.style.setProperty('--filter-strength', filterState.intensity);

    const def = SVG_FILTERS[filterState.name];
    if (def) {
        canvas.style.filter = `url(#${def.id})`;
        const turb = document.getElementById(def.turbId);
        const disp = document.getElementById(def.dispId);
        const blur = document.getElementById(def.blurId);
        if (turb) {
            turb.setAttribute('type', def.type);
            turb.setAttribute('baseFrequency', `${filterState.freqX} ${filterState.freqY}`);
            turb.setAttribute('numOctaves', String(Math.max(1, filterState.octaves | 0)));
            turb.setAttribute('seed', String(filterState.seed | 0));
        }
        if (disp) {
            // Nonlinear intensity response: unchanged at 50, gentler below,
            // and considerably more dramatic toward 100 — the old linear
            // curve topped out at a tame 2× displacement.
            const k = Math.pow(filterState.intensity / 50, 1.35);
            disp.setAttribute('scale', String(def.baseScale * k));
        }
        if (blur) blur.setAttribute('stdDeviation', String(filterState.blur));
    } else {
        canvas.style.filter = '';
    }

    document.querySelectorAll('.filters button').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filterState.name);
    });
}

// Reflect config.MATERIAL in the material tab bar. The shader side needs no
// push — renderScene() reads config.MATERIAL every frame.
function applyMaterial () {
    const name = SURFACES[config.MATERIAL] ? config.MATERIAL : 'DEFAULT';
    document.querySelectorAll('.materials button').forEach(b => {
        b.classList.toggle('active', b.dataset.material === name);
    });
}

function applyAudioInputs (audio) {
    // The choreographed modes are driven by rhythm events instead of band levels. On a GPU
    // that cannot link their shaders they fall back to the code below: most to their plain
    // versions, SMOKE, INK and RAINBOW to the stationary anchors.
    if (RIGS[currentTrajectory] && audio.rhythm && stampsLinked) { runRig(audio); return; }
    rigCurl = 0;

    const t = performance.now() * 0.001; // seconds
    const traj = TRAJECTORY[currentTrajectory] || TRAJECTORY.RANDOM;

    // Loud-passage compression: pull per-splat brightness down as volume rises.
    // At volume=1 with COMPRESS=0.6 → colors are scaled by 1/(1+0.6) ≈ 0.625
    const compress = 1 / (1 + audio.smoothedVolume * AUDIO.VOLUME_COMPRESS);
    const effectiveGain = AUDIO.COLOR_GAIN * compress;

    // Per-trajectory tweaks for the discrete-event / structured modes.
    const isAqua    = currentTrajectory === 'AQUA';
    const isBlink   = currentTrajectory === 'BLINK';
    const isKaleido = currentTrajectory === 'KALEIDO';
    const isComet   = currentTrajectory === 'COMET';
    const isPulse   = currentTrajectory === 'PULSE';
    const origRadius = config.SPLAT_RADIUS;

    for (let i = 0; i < NUM_BANDS; i++) {
        const energy = audio.smoothedBands[i];
        if (energy < AUDIO.BAND_THRESHOLD) continue;

        const e = Math.pow(energy, AUDIO.ENERGY_CURVE);

        // Stochastic gates so discrete-event modes fire as distinct events,
        // not a 360-splats-per-second continuous stream. KALEIDO's gate also
        // compensates its 6× mirror copies so GPU cost stays near other modes.
        if (isAqua    && Math.random() > e * 0.10) continue;
        if (isBlink   && Math.random() > e * 0.18) continue;
        if (isPulse   && Math.random() > e * 0.22) continue;
        if (isKaleido && Math.random() > 0.60)     continue;

        const pt = traj(i, t);

        // AQUA: gentle rising bubbles (not jets). BLINK: tiny impact pulses.
        // COMET: fast meteor streaks need extra push.
        const forceMult = isAqua ? 0.35 : isBlink ? 0.20 : isComet ? 1.5 : 1.0;
        const force = e * AUDIO.SPLAT_FORCE * forceMult * (0.5 + audio.smoothedVolume * AUDIO.VOLUME_GAIN);
        const dx = pt.dx * force;
        const dy = pt.dy * force;

        const intensity = softColor(e, effectiveGain, AUDIO.COLOR_KNEE);
        // Color picked by the active palette (FULL / SINGLE / MONO);
        // AQUA brightness boost is applied inside paletteColor.
        const color = paletteColor(i, intensity);

        if (isAqua) {
            // Bubble radius: small when quiet, medium when loud
            config.SPLAT_RADIUS = origRadius * (0.6 + e * 0.5 + audio.smoothedVolume * 0.3);
            splat(pt.x, pt.y, dx, dy, color);
            continue;
        }
        if (isBlink) {
            // One expanding raindrop ripple at the impact point, drawn by the
            // one-pass ring shader (true circle on screen, 2 blits total).
            const ringRadius = 0.022 + e * 0.028 + audio.smoothedVolume * 0.02;
            const ringForce = e * AUDIO.SPLAT_FORCE * 0.28 * (0.5 + audio.smoothedVolume * AUDIO.VOLUME_GAIN);
            splatRing(pt.x, pt.y, ringRadius, ringForce, color, origRadius * (0.45 + e * 0.35));
            continue;
        }
        if (isPulse) {
            // Speaker-cone rings: every band owns a radius slot out from the
            // center — bass flashes the inner rings, air the outer ones.
            const ringRadius = 0.05 + (i / NUM_BANDS) * 0.30 + audio.smoothedVolume * 0.03;
            const ringForce = e * AUDIO.SPLAT_FORCE * 0.22 * (0.5 + audio.smoothedVolume * AUDIO.VOLUME_GAIN);
            splatRing(0.5, 0.5, ringRadius, ringForce, color, origRadius * (0.35 + e * 0.3));
            continue;
        }
        if (isKaleido) {
            // 6-fold mirrored mandala: the seed splat plus 5 rotated copies.
            emitKaleido(pt.x, pt.y, dx, dy, color);
            continue;
        }
        splat(pt.x, pt.y, dx, dy, color);
    }

    if (isAqua) config.SPLAT_RADIUS = origRadius;

    if (audio.onset) {
        const burst = Math.max(1, Math.floor(AUDIO.ONSET_BURST_BASE + audio.smoothedVolume * AUDIO.ONSET_BURST_GAIN));
        audioBurst(burst, audio, effectiveGain);
    }
}

// Replacement for Pavel's multipleSplats() — same idea (random scatter) but
// brightness goes through softColor instead of the ×10 multiplier that
// blows out the screen on loud beats.
function audioBurst (amount, audio, gain) {
    const isAqua    = currentTrajectory === 'AQUA';
    const isBlink   = currentTrajectory === 'BLINK';
    const isKaleido = currentTrajectory === 'KALEIDO';
    const isComet   = currentTrajectory === 'COMET';
    const isPulse   = currentTrajectory === 'PULSE';
    for (let i = 0; i < amount; i++) {
        // Bursts are inherently punchier — push the energy term up,
        // but still through softColor so brightness can never exceed gain×1.4
        const intensity = softColor(0.8 + audio.smoothedVolume, gain * 1.4, AUDIO.COLOR_KNEE);
        // No band index — paletteColor falls back to random in FULL mode,
        // single-hue jitter in SINGLE, greyscale in MONO.
        const color = paletteColor(null, intensity);
        const f = AUDIO.SPLAT_FORCE * 1.6 * (0.4 + audio.smoothedVolume);

        if (isAqua) {
            // Burst spawns at random x along the bottom, every jet straight up
            splat(Math.random(), 0.02, 0, f, color);
            continue;
        }
        if (isBlink) {
            // Burst raindrop = a single, larger ring ripple at a random spot.
            splatRing(Math.random(), Math.random(),
                      0.035 + audio.smoothedVolume * 0.025, f * 0.25, color,
                      config.SPLAT_RADIUS * 0.55);
            continue;
        }
        if (isPulse) {
            // One hard shockwave from the center per onset — stacking
            // `amount` identical rings only adds brightness, so fire once.
            splatRing(0.5, 0.5, 0.045 + audio.smoothedVolume * 0.03,
                      f * 0.30, color, config.SPLAT_RADIUS * 0.6);
            return;
        }
        if (isKaleido) {
            // One mirrored flare set per onset (already 6 splats).
            const pt = TRAJECTORY.KALEIDO(0, 0);
            emitKaleido(pt.x, pt.y, pt.dx * f, pt.dy * f, color);
            return;
        }
        if (isComet) {
            // Extra meteors streaking in on the beat
            const pt = TRAJECTORY.COMET(Math.floor(Math.random() * NUM_BANDS), 0);
            splat(pt.x, pt.y, pt.dx * f, pt.dy * f, color);
            continue;
        }
        // Default: random scatter in random direction
        const ang = Math.random() * Math.PI * 2;
        splat(Math.random(), Math.random(), Math.cos(ang) * f, Math.sin(ang) * f, color);
    }
}

// ============================================================
// RIGS — the choreographed modes.
//
// A rig turns Rhythm's events into gestures, and a gesture has an attack and a
// body. The frame of the hit is the frame with the most new light and the
// hardest push: a column of smoke stands in the air at once, a brush stroke is
// half drawn, a ripple begins as a flash. What follows carries that motion on
// towards the next hit. Each of the nine answers the drums in its own way:
//
//            kick / bass note        snare / a mid note            hats
//   SMOKE    the centre cannon       the outer pair, a gust back   two small vents tick
//   INK      a downstroke / short    a slash / a dot               specks
//   RAINBOW  a bow rises             a beam through a prism / bead glints
//   AQUA     the jellyfish pulse     they flash and turn / one     plankton sparkles
//   BLINK    a drop at one focus     a drop at the other / small   droplets
//   VORTEX   a new arm, a heartbeat  the core flares, a whip / a   stars
//            at the core             knot of light
//   KALEIDO  a ring of petals        petals folded in / beads      glitter at the rim
//   COMET    a bright meteor         one that bursts / a faint one sparks
//   PULSE    a ring out              a ring in / a short ring      a quick ripple
//
// and each keeps a quiet bed going from the sustained levels, so music without
// drums still moves; the bed ducks under every kick, the way a mix does. With no
// beat at all, most of them keep a slow pulse of their own. The panel's audio
// knobs keep their meaning: Splat force scales every push, Color gain every dye,
// Burst base the weight of the hits against the bed, Band threshold and Energy
// curve gate and shape the bed, Sensitivity and Cooldown decide what counts as
// a hit.
// ============================================================
let rigState = null;        // the active rig's memory; rebuilt whenever the trajectory changes

// A colour from the active palette. v: brightness (may exceed 1); h: 0..1, where inside the
// palette — left out, a random place, like paletteColor().
function rigColor (v, h) {
    if (PALETTE.mode === 'MONO') return HSVtoRGB(0, 0, v);
    const u = h == null ? Math.random() : h;
    const hue = PALETTE.mode === 'SINGLE' ? PALETTE.singleHue + (u - 0.5) * PALETTE.singleRange : u;
    return HSVtoRGB(((hue % 1) + 1) % 1, 1.0, v);
}

// Evenly scattered points that never clump the way random ones do: (x, y) in [0, 1)².
function halton (i) {
    let x = 0, y = 0, f = 0.5, n = i + 1;
    for (; n > 0; n = Math.floor(n / 2), f /= 2) x += f * (n % 2);
    for (n = i + 1, f = 1 / 3; n > 0; n = Math.floor(n / 3), f /= 3) y += f * (n % 3);
    return [x, y];
}

// A jet is a short burst from a point: a push and a puff of dye on every frame of its life,
// strongest at the start. dx, dy and col are the amounts of its first frame at 60 fps.
function jet (c, x, y, dx, dy, col, radius, life) {
    c.S.jets.push({ x, y, dx, dy, col, radius, life, age: 0 });
}

function runJets (c) {
    const jets = c.S.jets;
    for (let i = jets.length - 1; i >= 0; i--) {
        const j = jets[i];
        const w = Math.pow(1 - j.age / j.life, 1.5) * c.step;
        splatPush(j.x, j.y, j.dx * w, j.dy * w, j.radius);
        if (j.col) dotDye(j.x, j.y, { r: j.col.r * w, g: j.col.g * w, b: j.col.b * w }, j.radius);
        j.age += c.dt;
        if (j.age >= j.life) jets.splice(i, 1);
    }
}

// A stroke is a line drawn fast: its head runs from (x0, y0) to (x1, y1) in `life` seconds,
// quickest at the start, leaving dots of dye `col` close enough to run together and pushing
// the fluid the way it goes.
function stroke (c, x0, y0, x1, y1, col, radius, push, life) {
    c.S.strokes.push({ x0, y0, x1, y1, col, radius, push, life, age: 0, drawn: 0 });
}

function runStrokes (c) {
    const strokes = c.S.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes[i];
        s.age += c.dt;
        const u = Math.min(1, s.age / s.life), p = 1 - (1 - u) * (1 - u);
        const lx = (s.x1 - s.x0) * c.aspect, ly = s.y1 - s.y0, len = Math.hypot(lx, ly) || 1e-6;
        const n = Math.ceil((p - s.drawn) * len / (0.5 * Math.sqrt(correctRadius(s.radius / 100))));
        for (let k = 1; k <= n; k++) {
            const q = s.drawn + (p - s.drawn) * k / n;
            dotDye(s.x0 + (s.x1 - s.x0) * q, s.y0 + (s.y1 - s.y0) * q, s.col, s.radius);
        }
        const w = s.push * (1 - u) * c.step;
        splatPush(s.x0 + (s.x1 - s.x0) * p, s.y0 + (s.y1 - s.y0) * p, lx / len * w, ly / len * w, s.radius * 1.5);
        s.drawn = p;
        if (u >= 1) strokes.splice(i, 1);
    }
}

// A sweep is a line drawn fast along any path: its head runs along path(u), u from 0 to 1, in
// `life` seconds, quickest at the start, leaving dots of dye `col` close enough to run together
// and pushing the fluid the way it goes. Its `amp` scales both, so a hit that turns out bigger
// than it first sounded can still grow it; `head` > 0 draws a brighter spot that travels with
// the head, as bright as `head` times the line; `end` runs once the head has arrived.
function sweep (c, path, col, radius, push, life, end, head = 0) {
    const s = { path, col, radius, push, life, end, head, amp: 1, age: 0, drawn: 0 };
    c.S.sweeps.push(s);
    return s;
}

function runSweeps (c) {
    const sweeps = c.S.sweeps;
    for (let i = sweeps.length - 1; i >= 0; i--) {
        const s = sweeps[i];
        s.age += c.dt;
        const u = Math.min(1, s.age / s.life), p = 1 - (1 - u) * (1 - u);
        // the stretch of path the head covered this frame, in screen heights
        let len = 0, [ax, ay] = s.path(s.drawn);
        for (let k = 1; k <= 4; k++) {
            const [bx, by] = s.path(s.drawn + (p - s.drawn) * k / 4);
            len += Math.hypot((bx - ax) * c.aspect, by - ay); ax = bx; ay = by;
        }
        const n = Math.ceil(len / (0.5 * Math.sqrt(correctRadius(s.radius / 100))));
        const col = { r: s.col.r * s.amp, g: s.col.g * s.amp, b: s.col.b * s.amp };
        for (let k = 1; k <= n; k++) {
            const [x, y] = s.path(s.drawn + (p - s.drawn) * k / n);
            dotDye(x, y, col, s.radius);
        }
        const [hx, hy] = s.path(p), [tx, ty] = s.path(Math.max(0, p - 0.02));
        if (s.head > 0) { const h = s.head * (1 - u); dotDye(hx, hy, { r: col.r * h, g: col.g * h, b: col.b * h }, s.radius * 1.4); }
        const dx = (hx - tx) * c.aspect, dy = hy - ty, d = Math.hypot(dx, dy) || 1e-6, w = s.push * s.amp * (1 - u) * c.step;
        splatPush(hx, hy, dx / d * w, dy / d * w, s.radius * 1.5);
        s.drawn = p;
        if (u >= 1) { sweeps.splice(i, 1); if (s.end) s.end(); }
    }
}

// A ripple that really travels: each frame it is drawn at its new radius and what it drew the
// frame before is taken back (as negative dye, less what the water lost in between), all but a
// share `wake` that is left to glow and fade behind it. It leaves fast and slows as it spreads,
// fading as it goes. reach: how far it gets, in screen heights (negative: it shrinks); glow: how
// bright it may get, in shares of the panel's colour gain; delay: seconds before it sets off.
// A ripple object with a `base` starts from that radius instead of 0.02 (the rainbow's bands).
function ripple (list, x, y, amp, reach, life, thick, glow, wake, hue, delay = 0) {
    const p = { x, y, amp, reach, life, thick, glow, wake, hue, age: -delay, last: 0, rad: 0 };
    list.push(p);
    if (list.length > 24) list.shift();
    return p;
}

function runRipples (c, list) {
    const kept = 1 / (1 + config.DENSITY_DISSIPATION * lastStepDt);     // what is left of last frame's dye
    for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += c.dt;
        if (p.age <= 0) continue;                                       // not off yet
        const u = p.age / p.life;
        if (u >= 1) { list.splice(i, 1); continue; }
        const rad = (p.base == null ? 0.02 : p.base) + p.reach * (1 - Math.pow(1 - u, 2.2));
        const v = softColor(p.amp * Math.pow(1 - u, 2.2) * 1.3, c.gain * p.glow, AUDIO.COLOR_KNEE);
        if (v > 0.0005) ringDye(p.x, p.y, rad, rigColor(v, p.hue), c.r * p.thick, rad - p.rad, [p.last > 0 ? -(p.last / v) * (1 - p.wake) * kept : 0, 0, 0]);
        p.last = v > 0.0005 ? v : 0; p.rad = rad;
    }
}

function runRig (audio) {
    const name = currentTrajectory, rig = RIGS[name], R = audio.rhythm;
    if (!rigState || rigState.name !== name) rigState = Object.assign({ name, jets: [], strokes: [], sweeps: [] }, rig.init());
    const gate = AUDIO.BAND_THRESHOLD, loud = R.loudness;
    const c = {
        R, S: rigState,
        dt: R.dt, step: R.dt * 60,              // step: 1 at 60 fps, so per-frame amounts hold at any frame rate
        t: performance.now() * 0.001,
        F: AUDIO.SPLAT_FORCE * (0.5 + 0.42 * loud * AUDIO.VOLUME_GAIN),
        gain: AUDIO.COLOR_GAIN / (1 + loud * AUDIO.VOLUME_COMPRESS),
        punch: AUDIO.ONSET_BURST_BASE / 3 * (1 + (loud - 0.5) * AUDIO.ONSET_BURST_GAIN / 15),
        r: config.SPLAT_RADIUS,
        aspect: canvas.width / canvas.height,
        // a sustained level, gated and shaped by the panel
        level: x => Math.pow(Math.max(0, (x - gate) / (1 - gate)), AUDIO.ENERGY_CURVE),
        // the bed makes room for the kick and swells back after it
        duck: 1 - 0.85 * Math.min(1, R.low.env),
    };
    // how much of the scene shows: nothing in silence, all of it once the music is up
    c.seen = Math.min(1, c.level(loud) * 1.6);
    // With no beat to follow, a slow pulse of its own: the weight of a soft beat on the frame it
    // falls, about every `period` seconds, and 0 on every other frame.
    c.own = period => {
        if (R.quiet < 1.5 || c.seen < 0.05) return 0;
        if ((rigState.own -= c.dt) > 0) return 0;
        rigState.own = period * (0.85 + 0.3 * Math.random());
        return 0.35 + 0.3 * c.seen;
    };
    // the weight of a hit of this strength: accents stand out, ghost notes stay small
    c.hit = strength => Math.pow(strength, 1.5) * c.punch;
    // the part of a range's hit that arrives on this frame (a hit is called before its size is
    // known, and the rest follows within a frame or two): the parts add up to hit(strength)
    c.arrive = range => range.hit > 0 ? c.hit(range.strength) - c.hit(range.strength - range.hit) : 0;
    // dye for an energy x: soft-clipped like every other splat, `mult` times the panel's colour gain at most
    c.dye = (x, mult, h) => rigColor(softColor(x, c.gain * mult, AUDIO.COLOR_KNEE), h);
    rigCurl = 0;
    rig.frame(c);
    runJets(c);
    runStrokes(c);
    runSweeps(c);
    flushStamps();
}

const RIGS = {
    // ---------------------------------------------------------------- SMOKE
    // Five cannons along the floor, like the fog jets of a stage. The kick fires the big one in
    // the middle — the column is in the air at once, as tall as the hit is hard — and rocks the
    // room sideways, left on one beat, right on the next. The snare fires the outer pair and
    // blows the tops back the other way; notes puff the outer cannons in turn, hats tick the
    // inner pair.
    SMOKE: {
        init: () => ({ sway: 1, tick: 0, side: 0 }),
        frame (c) {
            const { R, S, F } = c, floor = 0.03;
            const r = c.r * Math.pow(Math.min(1, c.aspect), 2);          // on an upright screen the cannons stand closer: thinner columns
            // a shot of weight a: a column `tall` high and `wide` across, leaning to one side at the top
            const shot = (x, a, tall, wide, lean) => {
                for (let i = 0; i < 4; i++) {
                    const u = i / 3, y = floor + tall * u;
                    dotDye(x + lean * 0.04 * u * u, y, c.dye(a * (1.3 - 0.7 * u), 1.5), r * wide * (1 - 0.35 * u));
                    splatPush(x, y, lean * F * 0.3 * a * u, F * 0.9 * a * (1 - 0.4 * u), r * wide * (1 - 0.3 * u));
                }
            };
            // bed: a thread of smoke from each vent for as long as its range sounds
            for (const [x, lv] of [[0.5, R.low.level], [0.2, R.mid.level], [0.8, R.mid.level], [0.35, R.high.level], [0.65, R.high.level]]) {
                const L = c.level(lv) * c.duck;
                if (L < 0.03) continue;
                const wob = Math.sin(c.t * 1.7 + x * 9) * 0.008;
                splatPush(x + wob, floor, 0, F * 0.07 * (0.5 + L) * c.step, r * 0.9);
                dotDye(x + wob, floor, c.dye(L * 0.7, 0.12 * c.step), r * 0.8);
            }
            const low = c.arrive(R.low), mid = c.arrive(R.mid), high = c.arrive(R.high);
            if (R.low.struck) S.sway = -S.sway;
            if (low > 0) {
                shot(0.5, low, 0.12 + 0.24 * Math.min(1.3, R.low.strength), 2.0, S.sway);
                jet(c, 0.5, floor, S.sway * F * 0.2 * low, F * 1.0 * low, c.dye(low, 0.5), r * 1.8, 0.1);
                splatPush(0.5, 0.55, S.sway * F * 0.5 * low, 0, c.r * 9);      // the room rocks
            }
            if (R.drop) {
                // the drop: every cannon fires at once
                for (const x of [0.2, 0.35, 0.65, 0.8]) {
                    shot(x, 1.2 * c.punch, 0.36, 1.6, x < 0.5 ? -1 : 1);
                    jet(c, x, floor, 0, F * 1.2 * c.punch, c.dye(1.2, 0.5), r * 1.5, 0.12);
                }
            }
            if (R.snare > 0) {
                const h = c.hit(R.snare);
                for (const x of [0.2, 0.8]) {
                    shot(x, h, 0.14 + 0.14 * Math.min(1.3, R.snare), 1.5, x < 0.5 ? 1 : -1);
                    jet(c, x, floor, 0, F * 0.9 * h, c.dye(h, 0.4), r * 1.4, 0.08);
                }
                splatPush(0.5, 0.74, -S.sway * F * 0.7 * h, 0, c.r * 9);       // and the tops blow back
            }
            if (R.mid.struck) S.side++;
            if (mid > 0) shot((S.side % 2) ? 0.8 : 0.2, mid * 0.6, 0.14, 1.1, 0);
            if (R.high.struck) S.tick++;
            if (high > 0) shot((S.tick % 2) ? 0.65 : 0.35, high * 0.6, 0.1, 0.55, 0);
            rigCurl = 6 * c.level(R.high.level) + 8 * R.high.env;        // cymbals make the smoke curl
        },
    },

    // ---------------------------------------------------------------- INK
    // The music writes, in ink on wet paper. A brush travels along the top of the page at the
    // speed of the song — eight beats from one side to the other, then back to the start —
    // and every drum is a stroke made where the brush is: a kick a full downstroke, a bass
    // note a short one, a note a dot, a hat a speck beside it. So the row of strokes on the
    // page is the last bars written out, evenly spaced when the beat is steady, the newest
    // sharp and the older ones already bleeding into the water. A snare is a slash drawn in
    // from the side, straight across them.
    INK: {
        init: () => ({ pen: 0, pend: 0, wait: 0, solid: false, at: 0.5, hue: 0.5, m: 0, dab: 0.5 }),
        frame (c) {
            const { R, S, F, r } = c, top = 0.985;
            let T = R.kickEvery;                                         // the beat, folded into a walking pace
            while (T > 0.75) T /= 2;
            while (T < 0.33) T *= 2;
            if (c.level(R.loudness) > 0.02) S.pen = (S.pen + c.dt / ((c.aspect >= 1 ? 8 : 4) * T)) % 1;
            const x = 0.06 + 0.88 * S.pen;

            // a thread of ink runs from the brush for as long as the music sustains
            const L = c.level(Math.max(R.mid.level, R.low.level * 0.8)) * c.duck;
            if (L > 0.03) {
                splatPush(x, top, 0, -F * 0.06 * L * c.step, r * 0.5);
                dotDye(x, top, c.dye(L * 0.8, 0.3 * c.step, 0.5), r * 0.3);
            }
            // A low hit is a full downstroke if it is solid and a short one if it is not. It is called
            // before its size is known, so a small one waits a moment to see whether it grows.
            const low = c.arrive(R.low);
            if (R.low.struck) { S.solid = false; S.pend = 0; S.wait = 0.07; S.at = x; S.hue = 0.35 + 0.3 * Math.random(); }
            if (S.solid || S.wait > 0) {
                S.pend += low;
                if (!S.solid && R.low.strength >= 0.7) { S.solid = true; S.wait = 0; }
                if (S.solid) {
                    if (S.pend > 0) {
                        dotDye(S.at, top - 0.035, c.dye(S.pend * 1.3, 2.0, S.hue), r * 1.2);        // the brush lands, then travels
                        stroke(c, S.at, top, S.at + (Math.random() - 0.5) * 0.02, top - 0.2 - 0.3 * Math.min(1.3, R.low.strength), c.dye(S.pend * 1.3, 0.65, S.hue), r * 0.8, F * 1.1 * S.pend, 0.07);
                        S.pend = 0;
                    }
                } else if ((S.wait -= c.dt) <= 0) {
                    stroke(c, S.at, top, S.at, top - 0.1 - 0.12 * R.low.strength, c.dye(S.pend * 1.3, 0.6, S.hue), r * 0.35, F * 0.6 * S.pend, 0.1);
                    S.pend = 0;
                }
            }
            if (R.drop) {
                // the drop: four more downstrokes at once, and two slashes cross the page
                for (const dx of [0.2, 0.4, 0.6, 0.8]) {
                    const at = 0.06 + 0.88 * ((S.pen + dx) % 1);
                    stroke(c, at, top, at, top - 0.55, c.dye(1.4, 0.6, Math.random()), r * 0.7, F * 1.0 * c.punch, 0.14);
                }
                for (const side of [-1, 1]) stroke(c, 0.5 - side * 0.47, 0.5 + side * 0.14, 0.5 + side * 0.3, 0.5 - side * 0.1, c.dye(1.3, 0.75, 0.7), r * 0.8, F * 1.4 * c.punch, 0.16);
            }
            if (R.snare > 0) {
                const h = c.hit(R.snare), left = (S.m++ % 2) === 0, y = 0.3 + 0.4 * ((S.m * 0.381966) % 1);
                const x0 = left ? 0.03 : 0.97, x1 = x0 + (left ? 1 : -1) * (0.26 + 0.24 * Math.min(1.3, R.snare));
                stroke(c, x0, y, x1, y + (Math.random() - 0.5) * 0.14, c.dye(h * 1.2, 0.5, 0.7), r * 0.6, F * 1.0 * h, 0.08);
            }
            const mid = c.arrive(R.mid), high = c.arrive(R.high);
            if (R.mid.struck) S.dab = x;
            if (mid > 0) {
                dotDye(S.dab, top - 0.02, c.dye(mid, 2.2, 0.3 + 0.4 * Math.random()), r * 0.3);
                splatPush(S.dab, top - 0.02, 0, -F * 0.5 * mid, r * 0.4);
            }
            if (high > 0) dotDye(x + (Math.random() - 0.5) * 0.08, top - 0.03 - 0.07 * Math.random(), c.dye(high, 2.2), r * 0.16);
            rigCurl = 5 * R.high.env;
        },
    },

    // ---------------------------------------------------------------- RAINBOW
    // Light and a prism. Every kick raises a rainbow: seven bands, red outside and violet inside,
    // that rise from below the floor as one wave and leave a glow of colour that the air carries
    // off. The bow rises on the left on one beat and on the right on the next. A snare is a beam
    // of white light that crosses into the picture and splits into a fan of colours where it
    // meets the prism; a note is a bead of the next colour of the spectrum, a hat a glint. With
    // nothing striking, colour rises from the floor in the order of the spectrum.
    RAINBOW: {
        init: () => ({ bows: [], side: 0, beam: 0, k: 0, hue: 0 }),
        frame (c) {
            const { R, S, F, r } = c, BANDS = 7;
            const hueOf = i => 0.8 * i / (BANDS - 1);                    // red .. violet
            const bow = (x, amp, reach, life, wake, delay = 0, flip = false) => {
                const out = [];
                for (let i = 0; i < BANDS; i++) {
                    const p = { x, y: -0.18, base: 0.5 - 0.036 * i, amp, reach, life, thick: 0.06, glow: 2.0, wake, hue: hueOf(flip ? BANDS - 1 - i : i), age: -delay, last: 0, rad: 0 };
                    S.bows.push(p); out.push(p);
                }
                while (S.bows.length > 4 * BANDS) S.bows.shift();
                return out;
            };
            // bed: the spectrum rises from the floor for as long as the music sustains
            const L = c.level(Math.max(R.mid.level, R.low.level * 0.8)) * c.duck;
            if (L > 0.03) {
                for (let i = 0; i < BANDS; i++) {
                    const x = 0.08 + 0.84 * i / (BANDS - 1) + Math.sin(c.t * 0.9 + i * 1.3) * 0.02;
                    splatPush(x, 0.02, 0, F * 0.04 * (0.5 + L) * c.step, r * 0.8);
                    dotDye(x, 0.02, c.dye(L * 0.6, 0.03 * c.step, hueOf(i)), r * 0.5);
                }
            }
            const low = c.arrive(R.low);
            if (R.low.struck) { S.side = 1 - S.side; S.kick = bow(S.side ? 0.6 : 0.4, 0, 0.3, 0.8, 0.08); }
            if (low > 0 && S.kick) {
                const s = Math.min(1.3, R.low.strength), beat = R.kickJitter < 0.15 ? R.kickEvery : 0.55;
                for (const p of S.kick) { p.amp += low * 0.75; p.reach = 0.12 + 0.3 * s; p.life = Math.min(1.2, Math.max(0.55, 1.4 * beat)); }
                // the bow lifts the air with it, and the colour it leaves billows
                for (let i = 0; i < 5; i++) {
                    const a = Math.PI * (0.25 + 0.125 * i), x = S.kick[0].x + Math.cos(a) * 0.62 / c.aspect, y = -0.18 + Math.sin(a) * 0.62;
                    if (y > 0) splatPush(x, y, Math.cos(a) * F * 0.2 * low, Math.sin(a) * F * 0.2 * low, r * 2.5);
                }
            }
            if (R.drop) {
                // the drop: a double rainbow, the second one wider and with its colours the other way round
                bow(0.5, 1.4 * c.punch, 0.45, 1.4, 0.3);
                bow(0.5, 0.8 * c.punch, 0.62, 1.6, 0.3, 0.1, true);
            }
            const beam = (h, left) => {
                const y0 = 0.45 + 0.3 * ((S.beam * 0.618034) % 1), px = left ? 0.4 : 0.6, py = y0 - 0.04;
                stroke(c, left ? -0.02 : 1.02, y0, px, py, c.dye(h * 0.8, 0.25, 0), r * 0.25, F * 0.3 * h, 0.06);
                for (let i = 0; i < BANDS; i++) {
                    const a = -0.32 + 0.09 * i, d = left ? 1 : -1;
                    stroke(c, px, py, px + d * Math.cos(a) * 0.7 / c.aspect, py + Math.sin(a) * 0.7, c.dye(h, 0.22, hueOf(i)), r * 0.3, F * 0.25 * h, 0.12);
                }
                dotDye(px, py, c.dye(h * 1.2, 1.2, 0.15), r * 0.6);
            };
            if (R.snare > 0) beam(c.hit(R.snare), (S.beam++ % 2) === 0);
            if (R.drop) { beam(1.2 * c.punch, true); beam(1.2 * c.punch, false); }
            const mid = c.arrive(R.mid), high = c.arrive(R.high);
            if (R.mid.struck) { const [hx, hy] = halton(S.k++); S.note = [0.08 + 0.84 * hx, 0.3 + 0.6 * hy]; S.hue = (S.hue + 1) % BANDS; }
            if (mid > 0 && S.note) {
                dotDye(S.note[0], S.note[1], c.dye(mid * 1.1, 1.4, hueOf(S.hue)), r * 0.35);
                splatPush(S.note[0], S.note[1], 0, F * 0.3 * mid, r * 0.6);
            }
            if (high > 0) dotDye(Math.random(), 0.2 + 0.75 * Math.random(), c.dye(high, 2.2, Math.random() * 0.8), r * 0.14);
            runRipples(c, S.bows);
            rigCurl = 4 * R.high.env;
        },
    },

    // ---------------------------------------------------------------- AQUA
    // A handful of jellyfish that swim the way jellyfish do: a contraction, a glide. They all
    // contract on the kick, so the whole swarm lifts in time and sinks back between the beats;
    // a snare makes them flash and lean the other way; hats are plankton lighting up around
    // them. With no beat to follow they keep their own slow pulse.
    AQUA: {
        init () {
            const n = canvas.width > canvas.height ? 5 : 3, jellies = [];
            for (let i = 0; i < n; i++) {
                const x = 0.1 + 0.8 * (i + 0.5) / n + (Math.random() - 0.5) * 0.05, y = 0.2 + 0.4 * ((i * 0.618034 + 0.3) % 1);
                jellies.push({
                    x, y, homeX: x, homeY: y,                // where it rests: the beat lifts it from there, and it sinks back
                    vx: 0, vy: 0, size: 0.85 + 0.45 * Math.random(), hue: (i + Math.random()) / n,
                    lean: (Math.random() - 0.5) * 0.7, tilt: 0, pulse: 0, flash: 0, own: Math.random() * 1.1, sway: Math.random() * 6,
                });
            }
            return { jellies, dir: 1, turn: 0, halos: [] };
        },
        frame (c) {
            const { R, S, F, r } = c, seen = Math.min(1, c.level(R.loudness) * 1.6);
            const beat = c.arrive(R.low);
            const snare = R.snare > 0 ? c.hit(R.snare) : 0;
            if (snare > 0) S.dir = -S.dir;
            const note = !snare && R.mid.struck ? S.jellies[S.turn++ % S.jellies.length] : null;
            for (const j of S.jellies) {
                let kick = beat;
                if (R.quiet > 0.9 && seen > 0.05) {                       // no beat: its own slow pulse
                    j.own -= c.dt;
                    if (j.own <= 0) { kick = 0.4 + 0.35 * seen; j.own = 1.0 + 0.5 * Math.random(); }
                }
                if (note === j) { kick = Math.max(kick, 0.4 * c.hit(R.mid.strength)); j.flash = Math.max(j.flash, 0.6 * R.mid.strength); }
                const R0 = 0.07 * j.size;                                 // bell radius, in screen heights
                const ux = Math.sin(j.tilt), uy = Math.cos(j.tilt);       // the way it points
                if (kick > 0) {
                    j.pulse = Math.min(1.25, j.pulse + kick);
                    j.vy += 0.2 * kick / j.size * uy; j.vx += 0.2 * kick / j.size * ux / c.aspect;
                    // the water it throws behind itself, which draws its tentacles out
                    // (lit, so every stroke is a flare under the bell that stretches into the tail)
                    splatPush(j.x - ux * R0 * 1.2 / c.aspect, j.y - uy * R0 * 1.2, -ux * F * 0.55 * kick, -uy * F * 0.55 * kick, r * 0.9 * j.size);
                    dotDye(j.x - ux * R0 * 1.1 / c.aspect, j.y - uy * R0 * 1.1, c.dye(kick * seen, 1.6, j.hue + 0.08), r * 0.45 * j.size);
                    // and a halo of light that leaves the bell with every solid stroke
                    if (kick >= 0.35 && S.halos.length < 16) S.halos.push({ x: j.x, y: j.y, hue: j.hue, amp: 0.8 * Math.min(1.3, kick), reach: 0.15 * j.size, life: 0.45, age: 0 });
                }
                if (snare > 0) { j.flash = Math.max(j.flash, snare); j.lean = S.dir * (0.25 + 0.45 * Math.random()); }
                j.tilt += (j.lean * 0.6 - j.tilt) * (1 - Math.exp(-c.dt / 0.35));
                // each stroke lifts it; in between it sinks back towards the depth it lives at
                j.vy = (j.vy - 3.0 * (j.y - j.homeY) * c.dt) * Math.exp(-c.dt / 0.36);
                j.vx = (j.vx - 1.0 * (j.x - j.homeX) * c.dt) * Math.exp(-c.dt / 0.36);
                j.x = Math.min(0.96, Math.max(0.04, j.x + j.vx * c.dt)); j.y = Math.min(0.94, j.y + j.vy * c.dt);
                j.pulse *= Math.exp(-c.dt / 0.22); j.flash *= Math.exp(-c.dt / 0.25);
                const glow = (0.2 + 1.1 * Math.min(1, j.pulse) + 0.8 * j.flash) * seen;
                if (glow < 0.01) continue;
                const sway = Math.sin(c.t * 2.2 + j.sway) * 0.25;
                bellDye(j.x, j.y, R0, Math.min(1, j.pulse), ux, uy, sway, c.dye(glow, 0.32 * c.step, j.hue + 0.12 * j.flash));
                // a snare is a flash: the whole bell at once, a shade off its own colour
                if (snare > 0) bellDye(j.x, j.y, R0, Math.min(1, j.pulse), ux, uy, sway, c.dye(snare * seen, 1.6, j.hue + 0.15));
            }
            const high = c.arrive(R.high);
            if (high > 0) dotDye(Math.random(), Math.random(), c.dye(high * 0.9, 2.0), r * 0.16);
            if (R.drop) {
                // the drop: the whole swarm flashes, each sends out a wide ring, the water fills with plankton
                for (const j of S.jellies) {
                    j.flash = Math.max(j.flash, 1.3);
                    S.halos.push({ x: j.x, y: j.y, hue: j.hue, amp: 1.2 * c.punch, reach: 0.32, life: 0.9, age: 0 });
                }
                for (let i = 0; i < 14; i++) dotDye(Math.random(), Math.random(), c.dye(1.2, 2.2), r * 0.16);
            }
            for (let i = S.halos.length - 1; i >= 0; i--) {
                const p = S.halos[i];
                p.age += c.dt;
                const u = p.age / p.life;
                if (u >= 1) { S.halos.splice(i, 1); continue; }
                ringDye(p.x, p.y, 0.02 + p.reach * (1 - Math.pow(1 - u, 1.7)), c.dye(p.amp * Math.pow(1 - u, 1.3) * seen, 0.8 * c.step, p.hue), r * 0.05, 0.022, RING_RIPPLE);
            }
        },
    },

    // ---------------------------------------------------------------- BLINK
    // Rain on still water at night. Every hit is a drop: a flash where it lands, and a ring
    // that leaves at speed and slows as it spreads. Kicks and bass notes land at one spot,
    // snares at its mirror image across the centre, so two trains of rings march outward in
    // time and cross; the pair turns slowly. A note is a small drop somewhere else, a hat a
    // droplet.
    // (A ring really travels: see ripple().)
    BLINK: {
        init: () => ({ ripples: [], k: 0, kick: [], shock: null, note: null, tick: null }),
        frame (c) {
            const { R, S, r } = c;
            const ring = (x, y, amp, reach, life, thick, glow, wake, hue, delay = 0) => ripple(S.ripples, x, y, amp, reach, life, thick, glow, wake, hue, delay);
            const flash = (x, y, a, size, hue) => dotDye(x, y, c.dye(a, 2.6, hue), r * size);
            const th = c.t * 0.21, fx = Math.cos(th) * 0.17 / c.aspect, fy = Math.sin(th) * 0.17;
            const low = c.arrive(R.low), mid = c.arrive(R.mid), high = c.arrive(R.high);
            if (R.low.struck) {
                // a drop and the two smaller waves that follow it out
                const x = 0.5 + fx, y = 0.5 + fy, hue = Math.random();
                S.kick = [ring(x, y, 0, 0, 1, 0.09, 2.2, 0.14, hue), ring(x, y, 0, 0, 1, 0.07, 2.2, 0, hue, 0.075), ring(x, y, 0, 0, 1, 0.06, 2.2, 0, hue, 0.15)];
                S.shock = null;
            }
            if (low > 0 && S.kick.length) {
                // the hit shows its size over a frame or two, and the ripple grows with it
                const s = Math.min(1.3, R.low.strength), beat = R.kickJitter < 0.15 ? R.kickEvery : 0.55;
                S.kick.forEach((p, i) => {
                    if (i === 0 || s >= 0.7) p.amp += low * [1, 0.5, 0.25][i];          // only a solid hit is followed out
                    p.reach = 0.2 + 0.42 * s * s;
                    p.life = Math.min(1.1, Math.max(0.5, 1.25 * beat)) * (0.6 + 0.4 * s);
                });
                flash(S.kick[0].x, S.kick[0].y, low * 1.3, 0.5 + 1.7 * s, S.kick[0].hue);
                // a solid one also throws a splash: a thin ring that is gone almost as soon as it is seen
                if (s >= 0.7 && !S.shock) S.shock = ring(S.kick[0].x, S.kick[0].y, 0, 0.3, 0.16, 0.04, 2.6, 0, S.kick[0].hue);
                if (S.shock) { S.shock.amp += low * 1.2; S.shock.reach = 0.22 + 0.2 * s; }
            }
            if (R.drop) {
                // the drop: one swell across the whole pond, and a shower around it
                flash(0.5, 0.5, 1.5 * c.punch, 4, 0.5);
                for (let i = 0; i < 3; i++) ring(0.5, 0.5, 1.6 * c.punch / (1 + i), 1.0, 1.5, 0.12 - 0.02 * i, 2.4, i ? 0 : 0.2, 0.5, i * 0.09);
                for (let i = 0; i < 8; i++) {
                    const x = Math.random(), y = Math.random();
                    flash(x, y, 0.9, 0.3); ring(x, y, 0.8, 0.07, 0.35, 0.04, 1.4, 0, Math.random());
                }
            }
            if (R.snare > 0) {
                const h = c.hit(R.snare), s = Math.min(1.3, R.snare), hue = Math.random();
                flash(0.5 - fx, 0.5 - fy, h * 1.3, 1.5, hue);
                ring(0.5 - fx, 0.5 - fy, h * 1.2, 0.14 + 0.22 * s, 0.5, 0.055, 2.6, 0.08, hue);
                ring(0.5 - fx, 0.5 - fy, h * 0.5, 0.14 + 0.22 * s, 0.5, 0.045, 2.6, 0, hue, 0.06);
            }
            if (R.mid.struck) {
                const [hx, hy] = halton(S.k++);
                S.note = ring(0.1 + 0.8 * hx, 0.12 + 0.76 * hy, 0, 0.1, 0.4, 0.045, 1.4, 0, Math.random());
            }
            if (mid > 0 && S.note) { S.note.amp += mid * 0.9; flash(S.note.x, S.note.y, mid * 0.9, 0.4, S.note.hue); }
            if (R.high.struck) S.tick = ring(Math.random(), Math.random(), 0, 0.035, 0.22, 0.035, 1.2, 0, Math.random());
            if (high > 0 && S.tick) { S.tick.amp += high * 0.8; flash(S.tick.x, S.tick.y, high, 0.2, S.tick.hue); }
            // a drizzle for music that sustains without striking
            const calm = c.level(R.loudness) * Math.max(0, 1 - R.high.env - R.mid.env);
            if (Math.random() < calm * 2.2 * c.dt) {
                const x = Math.random(), y = Math.random();
                flash(x, y, 0.5, 0.2); ring(x, y, 0.4 + 0.3 * calm, 0.07, 0.45, 0.04, 1.2, 0, Math.random());
            }
            runRipples(c, S.ripples);
        },
    },

    // ---------------------------------------------------------------- VORTEX
    // A whirlpool, or a spiral galaxy. Every kick lays a new arm from the rim to the core, makes
    // the core beat and spins the water up; the turning water winds the arms in, so the tighter
    // an arm is wound, the more beats ago it was laid. The arms of one bar stand a quarter turn
    // apart. A snare makes the core flare and whips the outer water round; notes are knots of
    // light and hats are stars, and they get wound in like everything else. The sustained sound
    // keeps it turning.
    VORTEX: {
        init: () => ({ k: 0, base: Math.random() * 6.2832, arm: null, a0: 1, star: null, own: 0 }),
        frame (c) {
            const { R, S, F, r } = c, k = Math.min(1, c.aspect);
            const at = (rho, th) => [0.5 + rho * k * Math.cos(th) / c.aspect, 0.5 + rho * k * Math.sin(th)];
            // Turn the water, anticlockwise: eight pushes round a small ring. Driven at the core, the flow
            // round it falls off the way a whirlpool's does, fast inside and slow outside, and that
            // difference is what winds the arms into a spiral.
            const spin = (a, rho) => {
                for (let i = 0; i < 8; i++) {
                    const th = i * Math.PI / 4, [x, y] = at(rho, th);
                    splatPush(x, y, -Math.sin(th) * a, Math.cos(th) * a, r * 1.2);
                }
            };
            // an arm: a spiral drawn fast from radius rho0 to near the core, winding `wind` radians on the way
            const arm = (th0, a, hue, rho0, wind, width, life) =>
                sweep(c, u => at(rho0 * Math.pow(0.12, u), th0 + wind * u), c.dye(a, 1.6, hue), r * width, F * 0.15 * a, life);
            const L = c.level(Math.max(R.low.level, R.mid.level));
            if (L > 0.03) {
                spin(F * 0.015 * L * c.step, 0.07);
                const [x, y] = at(0.42, c.t * 0.6);                      // dust drawn in from the rim shows the water turning
                dotDye(x, y, c.dye(L * 0.6, 0.12 * c.step, 0.5 + 0.4 * Math.sin(c.t * 0.13)), r * 0.3);
            }
            const low = c.arrive(R.low), own = c.own(1.8);
            if (R.low.struck || own) {
                S.k++;
                const a = R.low.struck ? c.hit(R.low.strength) : own, s = R.low.struck ? Math.min(1.3, R.low.strength) : 0.5;
                const m = arm(S.base + S.k * Math.PI / 2, a, (S.k * 0.618034) % 1, 0.32 + 0.12 * s, 2.4, 0.11 + 0.05 * s, 0.15);
                if (R.low.struck) { S.arm = m; S.a0 = a; } else spin(F * 0.3 * own, 0.07);
            } else if (R.low.hit > 0 && S.arm) S.arm.amp = c.hit(R.low.strength) / S.a0;
            if (low > 0) {
                spin(F * 0.18 * low, 0.07);
                dotDye(0.5, 0.5, c.dye(low * 1.2, 2.4, (S.k * 0.618034) % 1), r * (0.5 + 0.4 * Math.min(1.3, R.low.strength)));   // the core beats
            }
            if (R.drop) {
                // the drop: a new galaxy, four arms at once, and the core goes off
                for (let j = 0; j < 4; j++) arm(S.base + S.k * Math.PI / 2 + j * Math.PI / 2, 1.2 * c.punch, (j * 0.25 + 0.1) % 1, 0.46, 2.4, 0.3, 0.18);
                dotDye(0.5, 0.5, c.dye(1.5 * c.punch, 2.4, 0.5), r * 1.2);
                spin(F * 0.3 * c.punch, 0.07);
            }
            if (R.snare > 0) {
                const h = c.hit(R.snare), s = Math.min(1.3, R.snare), hue = Math.random();
                dotDye(0.5, 0.5, c.dye(h * 1.3, 2.6, hue), r * (0.6 + 0.4 * s));
                spin(F * 0.25 * h, 0.26);                                          // and the outer water is whipped round
            } else if (R.mid.struck) {
                const [x, y] = at(0.1 + 0.25 * Math.random(), Math.random() * 6.2832);      // a knot of light, soon wound in
                dotDye(x, y, c.dye(0.6 * c.hit(R.mid.strength), 1.8, Math.random()), r * 0.16);
            }
            const high = c.arrive(R.high);
            if (R.high.struck) S.star = at(0.08 + 0.36 * Math.random(), Math.random() * 6.2832);
            if (high > 0 && S.star) dotDye(S.star[0], S.star[1], c.dye(high, 2.4, Math.random()), r * 0.1);
        },
    },

    // ---------------------------------------------------------------- KALEIDO
    // A mandala drawn ring by ring, with the symmetry of a kaleidoscope: every mark is made
    // twelve times, six turns and their mirror images. Each kick opens a ring of petals a step
    // further out than the last — four kicks, four rings, from the centre to the rim — then
    // it starts again at the centre while the old rings fade, and each ring takes the next
    // colour. A snare folds a ring of petals inward between them; notes set beads on the
    // spokes; hats glitter at the rim.
    KALEIDO: {
        init: () => ({ k: -1, n: 0, q: 0, hue: Math.random(), ripples: [], own: 0 }),
        frame (c) {
            const { R, S, F, r } = c, k = Math.min(1, c.aspect);
            // every mark twelve times: at radius rho (screen heights) and angle th from the centre, turned
            // six times and mirrored. fn(x, y, ux, uy, vx, vy): (ux, uy) points outward, (vx, vy) along
            // the circle, away from the spoke the mirror runs along (th = 0: on the spokes, six marks).
            const twelve = (rho, th, fn) => {
                for (let j = 0; j < 6; j++) for (const s of th ? [1, -1] : [1]) {
                    const a = s * th + j * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a);
                    fn(0.5 + rho * k * ca / c.aspect, 0.5 + rho * k * sa, ca, sa, -s * sa, s * ca);
                }
            };
            // a ring of petals: jets pushing out (out > 0) or in, and splaying away from the spokes (side > 0)
            const petals = (rho, th, a, hue, out, side, width, reach = 1) => twelve(rho, th, (x, y, ux, uy, vx, vy) =>
                jet(c, x, y, (ux * out + vx * side) * F * 0.7 * a * reach, (uy * out + vy * side) * F * 0.7 * a * reach, c.dye(a, 0.6, hue), r * width, 0.1));
            // ring i of four, from the centre out: the further out, the further its petals reach
            const ring = (i, a, s) => petals(0.07 + 0.1 * i, 0.12 + 0.07 * i, a, S.hue + 0.11 * i, 1, 0.45, (0.2 + 0.05 * i) * (0.8 + 0.3 * s), 0.3 + 0.24 * i);
            // bed: a fountain at the centre, as strong as the music sustains
            const L = c.level(Math.max(R.low.level, R.mid.level)) * c.duck;
            if (L > 0.03) twelve(0.02, 0, (x, y, ux, uy) => {
                splatPush(x, y, ux * F * 0.03 * L * c.step, uy * F * 0.03 * L * c.step, r * 0.5);
                dotDye(x, y, c.dye(L * 0.6, 0.04 * c.step, S.hue + 0.5), r * 0.3);
            });
            const own = c.own(1.6);
            if (R.low.struck || own) {
                if (++S.k % 4 === 0) S.hue += 0.07;
                ring(S.k % 4, R.low.struck ? c.hit(R.low.strength) : own, R.low.struck ? Math.min(1.3, R.low.strength) : 0.5);
            }
            if (R.drop) {
                // the drop: the whole mandala at once
                for (let i = 0; i < 4; i++) ring(i, 1.2 * c.punch, 1);
                dotDye(0.5, 0.5, c.dye(1.5 * c.punch, 2.4, S.hue), r * 1.4);
                ripple(S.ripples, 0.5, 0.5, 1.4 * c.punch, 0.6 * k, 0.9, 0.08, 2.4, 0.15, S.hue);
            }
            if (R.snare > 0) {
                const h = c.hit(R.snare);
                petals(0.33, Math.PI / 6 - 0.1, h * 0.9, S.hue + 0.5, -0.8, -0.35, 0.3);
                dotDye(0.5, 0.5, c.dye(h, 1.8, S.hue + 0.5), r * 0.8);
                ripple(S.ripples, 0.5, 0.5, h * 0.8, 0.42 * k, 0.45, 0.05, 2.0, 0.08, S.hue + 0.5);
            } else if (R.mid.struck) {
                const h = 0.6 * c.hit(R.mid.strength), rho = 0.1 + 0.28 * ((S.n++ * 0.618034) % 1);
                twelve(rho, 0, (x, y) => dotDye(x, y, c.dye(h, 1.6, S.hue + 0.3), r * 0.2));
            }
            const high = c.arrive(R.high);
            if (R.high.struck) S.q++;
            if (high > 0) twelve(0.44, 0.04 + (S.q * 0.23) % 0.44, (x, y) => dotDye(x, y, c.dye(high, 2.2, S.hue + 0.6), r * 0.1));
            runRipples(c, S.ripples);
        },
    },

    // ---------------------------------------------------------------- COMET
    // A meteor shower. Every streak flies away from one point beyond the top-left corner, the
    // way all the meteors of a real shower seem to come from one place in the sky. A kick is a
    // bright meteor, and each kick takes the next lane down, so a bar of kicks sweeps across
    // the sky; a snare is a meteor that bursts at the end of its flight; notes are fainter
    // meteors, hats short sparks. The drop is a storm, with a fireball through the middle.
    COMET: {
        init: () => ({ k: 0, n: 0, kick: null, a0: 1, own: 0 }),
        frame (c) {
            const { R, S, F, r } = c;
            const rx = -0.12 * Math.max(1, c.aspect), ry = 1.12;       // the radiant, in screen heights from the bottom-left corner
            const A0 = Math.atan2(0.92 - ry, c.aspect - rx), A1 = Math.atan2(0.08 - ry, 0.04 - rx);
            // a meteor in lane f (0 = below the top-right corner .. 1 = the bottom-left), its head
            // `start` screen heights past where the lane enters the screen; end(x, y, ux, uy) once it is over
            const meteor = (f, a, start, len, width, life, hue, end) => {
                const ang = A0 + (A1 - A0) * f, ux = Math.cos(ang), uy = Math.sin(ang);
                const d0 = Math.max(-rx / ux, (ry - 1) / -uy, 0) + start, x0 = rx + ux * d0, y0 = ry + uy * d0;
                return sweep(c, u => [(x0 + ux * len * u) / c.aspect, y0 + uy * len * u], c.dye(a, 1.0, hue), r * width, F * 0.06 * a, life,
                             end && (() => end((x0 + ux * len) / c.aspect, y0 + uy * len)), 1.5);
            };
            // bed: the sky twinkles as long as there is music
            const L = c.level(R.loudness) * c.duck;
            if (Math.random() < L * 5 * c.dt) dotDye(Math.random(), 0.1 + 0.85 * Math.random(), c.dye(0.3 + 0.4 * L, 1.0, Math.random()), r * 0.07);
            const own = c.own(1.5);
            if (R.low.struck || own) {
                const a = R.low.struck ? c.hit(R.low.strength) : own, s = R.low.struck ? Math.min(1.3, R.low.strength) : 0.5;
                const m = meteor(0.12 + 0.25 * (S.k++ % 4), a, 0.05 + 0.15 * Math.random(), 0.35 + 0.4 * s, 0.12 + 0.06 * s, 0.2, 0.3 + 0.4 * Math.random());
                if (R.low.struck) { S.kick = m; S.a0 = a; }
            } else if (R.low.hit > 0 && S.kick) S.kick.amp = c.hit(R.low.strength) / S.a0;
            if (R.drop) {
                // the drop: a storm across every lane, and a fireball
                for (let i = 0; i < 9; i++) meteor(i / 8, 0.9 * c.punch, 0.05 + 0.3 * Math.random(), 0.4 + 0.4 * Math.random(), 0.12, 0.22 + 0.1 * Math.random(), Math.random());
                meteor(0.5, 1.5 * c.punch, 0.02, 1.2, 0.4, 0.35, 0.5);
            }
            if (R.snare > 0) {
                const h = c.hit(R.snare), hue = Math.random();
                meteor((S.n++ * 0.618034) % 1, h, 0.1 + 0.2 * Math.random(), 0.3, 0.12, 0.16, hue, (x, y) => {
                    // it bursts: a flash, and sparks thrown out all round
                    dotDye(x, y, c.dye(h * 1.2, 2.2, hue), r * 0.18);
                    for (let i = 0; i < 8; i++) {
                        const th = i * 0.7854 + Math.random() * 0.4, ux = Math.cos(th), uy = Math.sin(th), d = 0.04 + 0.05 * Math.random();
                        dotDye(x + ux * d / c.aspect, y + uy * d, c.dye(h, 2.4, hue + 0.1), r * 0.06);
                        splatPush(x + ux * d / c.aspect, y + uy * d, ux * F * 0.5 * h, uy * F * 0.5 * h, r * 0.25);
                    }
                });
            } else if (R.mid.struck) {
                meteor((S.n++ * 0.618034) % 1, 0.6 * c.hit(R.mid.strength), 0.1 + 0.3 * Math.random(), 0.22, 0.09, 0.15, Math.random());
            }
            if (R.high.struck) meteor(Math.random(), 0.5 * c.hit(R.high.strength), 0.1 + 0.5 * Math.random(), 0.07, 0.06, 0.06, Math.random());
        },
    },

    // ---------------------------------------------------------------- PULSE
    // A speaker cone seen from the front. The kick pushes it out: a flash at the centre and a
    // thick ring that leaves at speed, followed by a smaller one, so the rings stand out in time
    // with the kicks. A snare is the room answering: a ring that comes in from the edge and
    // closes on the centre. Notes send a thin ring part of the way out, hats a quick ripple.
    // With no beat the centre breathes with the music.
    PULSE: {
        init: () => ({ rings: [], k: 0 }),
        frame (c) {
            const { R, S, F, r } = c, cx = 0.5, cy = 0.5;
            const edge = Math.min(0.5, 0.52 * c.aspect);
            const ring = (amp, base, reach, life, thick, glow, wake, hue, delay = 0) => {
                const p = { x: cx, y: cy, base, amp, reach, life, thick, glow, wake, hue, age: -delay, last: 0, rad: 0 };
                S.rings.push(p);
                if (S.rings.length > 24) S.rings.shift();
                return p;
            };
            // bed: the centre breathes with the music, and is pushed back by every kick
            const L = c.level(Math.max(R.low.level, R.mid.level)) * c.duck;
            if (L > 0.03) dotDye(cx, cy, c.dye(L * 0.8, 0.08 * c.step, 0.5), r * (0.4 + 0.5 * L));
            const low = c.arrive(R.low);
            if (R.low.struck) { const hue = (S.k++ % 2) ? 0.42 : 0.58; S.kick = [ring(0, 0.03, 0.3, 0.8, 0.12, 2.2, 0.12, hue), ring(0, 0.03, 0.3, 0.8, 0.07, 2.2, 0, hue, 0.09)]; }
            if (low > 0 && S.kick) {
                const s = Math.min(1.3, R.low.strength), beat = R.kickJitter < 0.15 ? R.kickEvery : 0.55;
                S.kick.forEach((p, i) => {
                    if (i === 0 || s >= 0.7) p.amp += low * [1, 0.55][i];
                    p.reach = (0.3 + 0.55 * s / 1.3) * edge * 1.6;
                    p.life = Math.min(1.1, Math.max(0.5, 1.3 * beat)) * (0.6 + 0.4 * s);
                });
                dotDye(cx, cy, c.dye(low * 1.4, 1.8, S.kick[0].hue), r * (0.4 + 0.9 * s));
                for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; splatPush(cx + Math.cos(a) * 0.06 / c.aspect, cy + Math.sin(a) * 0.06, Math.cos(a) * F * 0.4 * low / c.aspect, Math.sin(a) * F * 0.4 * low, r * 1.5); }
            }
            if (R.snare > 0) {
                const h = c.hit(R.snare);
                ring(h * 1.1, edge * 0.95, -edge * 0.8, 0.45, 0.06, 2.4, 0.1, 0.62);
                ring(h * 0.5, edge * 0.95, -edge * 0.8, 0.45, 0.045, 2.4, 0, 0.62, 0.06);
            }
            if (R.drop) {
                dotDye(cx, cy, c.dye(1.5 * c.punch, 2.6, 0.5), r * 4);
                for (let i = 0; i < 4; i++) ring(1.5 * c.punch / (1 + 0.4 * i), 0.03, edge * 1.9, 1.3, 0.12 - 0.02 * i, 2.4, i ? 0 : 0.2, 0.5 + 0.04 * i, i * 0.1);
            }
            if (R.mid.struck) S.note = ring(0, 0.03, edge * (0.35 + 0.3 * Math.random()), 0.45, 0.045, 1.6, 0, 0.5 + 0.12 * Math.random());
            const mid = c.arrive(R.mid), high = c.arrive(R.high);
            if (mid > 0 && S.note) S.note.amp += mid * 0.9;
            if (R.high.struck) S.tick = ring(0, 0.02, edge * 0.25, 0.2, 0.035, 1.2, 0, 0.55);
            if (high > 0 && S.tick) S.tick.amp += high * 0.7;
            runRipples(c, S.rings);
        },
    },
};

// ============================================================
// PRESETS — each mode is a complete "scene": physics + trajectory +
// palette together. Earlier versions only changed physics knobs while
// every mode shared the same random trajectory and full-rainbow palette,
// which is why they all looked alike. (The old DEFAULT was merged into
// RAINBOW — it was the same scene with milder bloom.)
// Each preset patches `config` then forces shader keyword rebuild.
// ============================================================

const PRESETS = {
    SMOKE: {
        _trajectory: 'SMOKE',          // fog cannons fired by the drums
        _palette: { mode: 'MONO' },    // monochrome plumes — actual smoke
        DENSITY_DISSIPATION: 2.4,      // a column thins out over a beat or two
        VELOCITY_DISSIPATION: 2.0,     // the room settles between shots
        PRESSURE: 0.6,
        CURL: 3,
        SPLAT_RADIUS: 0.3,
        BLOOM: false,
        BLOOM_INTENSITY: 0.5,
        BLOOM_THRESHOLD: 0.7,
        SUNRAYS: false,
        SUNRAYS_WEIGHT: 0.4,
        SHADING: true,
    },
    INK: {
        _trajectory: 'INK',            // brush strokes written on the beat
        _palette: { mode: 'SINGLE', singleHue: 0.60, singleRange: 0.06 }, // deep indigo ink-in-water
        DENSITY_DISSIPATION: 1.5,      // a stroke stays on the page for three or four beats
        VELOCITY_DISSIPATION: 2.0,     // wet paper: a stroke bleeds and curls where it was made, it does not wander
        PRESSURE: 0.9,
        CURL: 2,
        SPLAT_RADIUS: 0.3,
        BLOOM: false,
        BLOOM_INTENSITY: 0.4,
        BLOOM_THRESHOLD: 0.6,
        SUNRAYS: false,
        SUNRAYS_WEIGHT: 0.6,
        SHADING: true,
    },
    RAINBOW: {
        _trajectory: 'RAINBOW',        // a rainbow raised by every kick, a prism lit by the snare
        _palette: { mode: 'FULL' },    // the full-spectrum showcase
        DENSITY_DISSIPATION: 2.8,      // the colour a bow leaves hangs in the air for a beat
        VELOCITY_DISSIPATION: 0.8,
        PRESSURE: 0.8,
        CURL: 1,
        SPLAT_RADIUS: 0.3,
        BLOOM: false,
        BLOOM_INTENSITY: 1.4,
        BLOOM_THRESHOLD: 0.45,
        SUNRAYS: true,
        SUNRAYS_WEIGHT: 1.0,
        SHADING: true,
    },
    AQUA: {
        _trajectory: 'AQUA',           // jellyfish that swim on the kick
        _palette: { mode: 'SINGLE', singleHue: 0.5, singleRange: 0.30 },  // default aqua palette
        DENSITY_DISSIPATION: 4.0,      // values set by hand in the panel (2026-11-28)
        VELOCITY_DISSIPATION: 1.74,
        PRESSURE: 0.39,
        CURL: 1,
        SPLAT_RADIUS: 0.03,            // fine tentacles and plankton; the bells keep their own size
        BLOOM: !isMobile(),            // bioluminescence wants a glow; phones skip the cost
        BLOOM_INTENSITY: 0.45,
        BLOOM_THRESHOLD: 0.45,
        SUNRAYS: false,                // sunrays scramble the up-direction
        SUNRAYS_WEIGHT: 0.6,
        SHADING: true,
    },
    BLINK: {
        _trajectory: 'BLINK',           // raindrops that land on the beat
        _palette: { mode: 'MONO' },    // greyscale rings on dark surface (override per palette panel)
        DENSITY_DISSIPATION: 3.5,
        VELOCITY_DISSIPATION: 0.7,     // only matters to what a pointer stirs up: the ripples do not push
        PRESSURE: 0.85,                // mid — incompressible water-surface feel
        CURL: 1,
        SPLAT_RADIUS: 0.3,
        BLOOM: false,
        BLOOM_INTENSITY: 0.55,
        BLOOM_THRESHOLD: 0.55,
        SUNRAYS: false,
        SUNRAYS_WEIGHT: 0.5,
        SHADING: true,
    },
    VORTEX: {
        _trajectory: 'VORTEX',          // a galaxy that winds in a new arm on every kick
        _palette: { mode: 'SINGLE', singleHue: 0.74, singleRange: 0.22 }, // violet galaxy
        DENSITY_DISSIPATION: 3.2,      // an arm fades as it is wound in, by the time the next one comes
        VELOCITY_DISSIPATION: 0.5,     // each kick spins the whirlpool up, and it slows between them
        PRESSURE: 0.85,
        CURL: 1,
        SPLAT_RADIUS: 0.3,
        BLOOM: false,
        BLOOM_INTENSITY: 0.7,
        BLOOM_THRESHOLD: 0.5,
        SUNRAYS: false,
        SUNRAYS_WEIGHT: 0.6,
        SHADING: true,
    },
    KALEIDO: {
        _trajectory: 'KALEIDO',         // a mandala drawn ring by ring on the beat
        _palette: { mode: 'FULL' },    // rainbow petals
        DENSITY_DISSIPATION: 3.5,
        VELOCITY_DISSIPATION: 0.4,
        PRESSURE: 0.8,
        CURL: 1,
        SPLAT_RADIUS: 0.3,
        BLOOM: false,
        BLOOM_INTENSITY: 0.7,
        BLOOM_THRESHOLD: 0.55,
        SUNRAYS: false,
        SUNRAYS_WEIGHT: 0.6,
        SHADING: true,
    },
    COMET: {
        _trajectory: 'COMET',           // a meteor shower, a meteor on every kick
        _palette: { mode: 'SINGLE', singleHue: 0.08, singleRange: 0.08 }, // golden-orange fire
        DENSITY_DISSIPATION: 3.5,
        VELOCITY_DISSIPATION: 1.3,     // push is local & transient — clean streaks, no soup
        PRESSURE: 0.7,
        CURL: 1,
        SPLAT_RADIUS: 0.3,
        BLOOM: false,
        BLOOM_INTENSITY: 0.9,
        BLOOM_THRESHOLD: 0.5,
        SUNRAYS: false,
        SUNRAYS_WEIGHT: 0.6,
        SHADING: true,
    },
    PULSE: {
        _trajectory: 'PULSE',           // rings out on the kick, in on the snare
        _palette: { mode: 'SINGLE', singleHue: 0.55, singleRange: 0.12 }, // electric cyan
        DENSITY_DISSIPATION: 3.5,
        VELOCITY_DISSIPATION: 1.1,     // shockwave travels briefly, then stills
        PRESSURE: 0.9,
        CURL: 1,
        SPLAT_RADIUS: 0.3,
        BLOOM: false,
        BLOOM_INTENSITY: 0.8,
        BLOOM_THRESHOLD: 0.5,
        SUNRAYS: false,
        SUNRAYS_WEIGHT: 0.5,
        SHADING: true,
    },
};

let currentPresetName = 'SMOKE';

function applyPreset (name) {
    const p = PRESETS[name];
    if (!p) return;
    currentPresetName = name;
    for (const k in p) {
        if (k.startsWith('_')) continue;   // meta keys (e.g. _trajectory, _palette)
        config[k] = p[k];
    }
    if (p._trajectory) currentTrajectory = p._trajectory;
    if (p._palette) Object.assign(PALETTE, p._palette);
    updateKeywords();
    // Reflect in UI
    document.querySelectorAll('.modes button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === name);
    });
}

// ============================================================
// SETTINGS PANEL
// Schema-driven sliders, toggles, selects and color pickers
// that mutate `config` (fluid) and `AUDIO` (audio mapping) live.
// ============================================================

function rgbToHex (c) {
    const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + h(c.r) + h(c.g) + h(c.b);
}

function hexToRgb (hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// ============================================================
// i18n — English ↔ Chinese
// English source text IS the lookup key. STRINGS.zh maps it to Chinese.
// Missing keys fall back to English. t(s, vars) handles {placeholder}
// interpolation so the same site works for both languages.
// ============================================================

let currentLang = 'en';
try {
    const saved = localStorage.getItem('swirl-lang');
    if (saved === 'en' || saved === 'zh') currentLang = saved;
    else if ((navigator.language || '').toLowerCase().startsWith('zh')) currentLang = 'zh';
} catch (_) {}

const STRINGS = {
    en: {
        // Semantic keys (not natural English) need an explicit en value
        // because t() falls back to the key itself when no translation exists.
        'device.foot': 'Don\'t see your app? Install a virtual audio cable<br>(<a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener">VB-Cable</a> on Windows, <a href="https://github.com/ExistentialAudio/BlackHole" target="_blank" rel="noopener">BlackHole</a> on macOS) and route the app to it.',
    },
    zh: {
        // ── Tab labels / toggles ────────────────────────────────
        'Settings': '设置',
        'present': '展示',
        'OFF': '关',
        'Smoke': '烟雾',
        'Ink': '墨色',
        'Rainbow': '彩虹',
        'Aqua': '水母',
        'Blink': '涟漪',
        'Vortex': '漩涡',
        'Kaleido': '万花筒',
        'Comet': '流星',
        'Pulse': '脉冲',
        'None': '无',
        'Frost': '磨砂',
        'Dream': '梦境',
        'Grain': '颗粒',
        'Vignette': '暗角',
        'Halftone': '半调',
        'Dither': '抖动',
        'Reeded': '凹槽',
        'Ripple': '波纹',
        'Pebbled': '鹅卵石',
        'Diamond': '菱形',
        'Molten': '熔融',
        'Classic': '默认',
        'Chrome': '液态铬',
        'Oil': '油膜',

        // ── Source picker / overlay ─────────────────────────────
        'Audio-reactive fluid simulation. Enable your microphone to begin.':
            '音频驱动的流体模拟。开启麦克风即可开始。',
        'Microphone': '麦克风',
        'Use the default system microphone': '使用默认系统麦克风',
        'Browser tab / system audio': '浏览器标签 / 系统音频',
        'Pick a tab or share your screen with audio': '选择一个标签页或共享带音频的屏幕',
        'Audio file': '音频文件',
        'MP3, WAV, OGG — plays on loop': 'MP3, WAV, OGG — 循环播放',
        'Choose audio input': '选择音频输入',
        '[← ] Back': '[← ] 返回',
        'device.foot': '看不到您的应用?安装虚拟音频线<br>(Windows 使用 <a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener">VB-Cable</a>,macOS 使用 <a href="https://github.com/ExistentialAudio/BlackHole" target="_blank" rel="noopener">BlackHole</a>)然后将应用路由到它。',

        // ── Status / hint messages ──────────────────────────────
        'Not supported in this browser — try Chrome or Edge': '此浏览器不支持 — 请试用 Chrome 或 Edge',
        'Safari can’t capture tab / system audio — use Chrome or Edge, or add an audio file.':
            'Safari 无法捕获标签页 / 系统音频 —— 请改用 Chrome 或 Edge,或添加音频文件。',
        'Loading devices…': '加载设备中…',
        'Microphone permission denied — needed to list devices.': '麦克风权限被拒绝 — 列出设备需要权限。',
        'Could not list audio devices.': '无法列出音频设备。',
        'No audio inputs found.': '未找到音频输入设备。',
        'Requesting…': '请求中…',
        'This browser does not support tab / system audio capture.': '此浏览器不支持标签 / 系统音频捕获。',
        'No audio captured. Check "Share audio" when picking the source.': '未捕获到音频。选择源时请勾选"共享音频"。',
        'No audio in that share. On a Mac, choose a browser TAB (not a window or the screen) and tick "Also share tab audio".':
            '这次共享没有音频。Mac 上只有共享浏览器"标签页"才带声音(窗口 / 整个屏幕都不行),选标签页并勾选"同时共享标签页音频"。',
        'Permission denied. Allow access in your browser and try again.': '权限被拒绝。请在浏览器中允许访问后重试。',
        'Microphone needs HTTPS or localhost. This page is on neither, so the browser blocks it. Open the HTTPS link or run a local server.':
            '麦克风需要 HTTPS 或 localhost。本页两者都不是,所以被浏览器屏蔽。请打开 HTTPS 链接,或用本地服务器运行。',
        'This browser blocks microphone access. If you opened the link inside an app (WeChat, etc.), tap ⋯ and "Open in browser" — use Chrome, Edge or Safari.':
            '此浏览器禁用了麦克风访问。如果你是在 App 内(如微信)打开的链接,请点右上角 ⋯ 选择"在浏览器打开" —— 用 Chrome、Edge 或 Safari。',
        'Microphone access is blocked for this site. Chrome/Edge: click the 🔒 icon in the address bar and allow Microphone. Safari: menu Safari → Settings → Websites → Microphone → Allow; also check macOS System Settings → Privacy & Security → Microphone. Then reload.':
            '此网站的麦克风访问已被拦截。Chrome/Edge:点击地址栏 🔒 图标,允许麦克风。Safari:菜单 Safari → 设置 → 网站 → 麦克风 → 允许;并检查 macOS 系统设置 → 隐私与安全性 → 麦克风。然后刷新页面。',
        'Tap the Microphone button below to start — the browser only turns the mic on after you tap.':
            '请点击下方的"麦克风"按钮开始 —— 浏览器只有在你点击之后才会开启麦克风。',
        // ── Mixer ───────────────────────────────────────────────
        'Sources': '音源',
        '+ Mic': '+ 麦克风',
        '+ System': '+ 系统',
        '+ File': '+ 文件',
        'No sources yet.': '还没有音源。',
        'Mute': '静音',
        'Remove': '移除',
        'All sources removed. Add one to begin.': '已移除全部音源。添加一个即可开始。',
        'No microphone found. Connect one and click Microphone to retry.':
            '未找到麦克风。请接入麦克风后,点击"麦克风"重试。',
        'The microphone is in use by another app. Close it and click Microphone to retry.':
            '麦克风正被其他应用占用。请关闭该应用后,点击"麦克风"重试。',
        'This browser can’t capture live mic / system audio (common in embedded preview browsers). Add an audio File instead, or open the page in Chrome / Edge / Safari.':
            '此浏览器无法捕获实时麦克风 / 系统音频(内置预览浏览器常见)。请改用"文件"音源,或在 Chrome / Edge / Safari 中打开本页。',
        'Screen / tab share was cancelled or denied. Click + System again and remember to tick "Share audio".':
            '屏幕 / 标签共享被取消或拒绝。请再次点击"+ 系统",并记得勾选"共享音频"。',
        'Couldn’t play that file. Tap + File and pick an audio file again.':
            '无法播放该文件。请点击"+ 文件"重新选择一个音频文件。',
        'That audio file format isn’t supported. Try MP3, WAV or OGG.':
            '不支持该音频格式。请改用 MP3、WAV 或 OGG。',
        'That device is no longer available. Pick another.': '此设备不再可用。请选择其他设备。',
        'Failed to start source. See console for details.': '源启动失败。详情请查看控制台。',
        "Microphone didn't start. Click Microphone to retry, or check that the site is on HTTPS and microphone access is allowed.":
            '麦克风未启动。点击"麦克风"重试,或检查站点是否为 HTTPS 且已允许麦克风访问。',

        // ── Panel sections + labels ─────────────────────────────
        'Simulation': '模拟',
        'Effects': '视觉效果',
        'Palette': '调色板',
        'Filter': '滤镜',
        'Glass displacement': '玻璃位移',
        'Audio → Fluid': '音频 → 流体',
        'Onset / Beat': '起音 / 节拍',
        'Playback': '控制',

        'Sim resolution': '模拟分辨率',
        'Dye resolution': '颜料分辨率',
        'Density diffusion': '密度扩散',
        'Velocity diffusion': '速度扩散',
        'Pressure': '压力',
        'Vorticity (curl)': '涡度 (旋转)',
        'Splat radius': '喷溅半径',

        'Shading': '着色',
        'Bloom': '泛光',
        'Bloom intensity': '泛光强度',
        'Bloom threshold': '泛光阈值',
        'Sunrays': '光线',
        'Sunrays weight': '光线强度',
        'Background': '背景色',

        'Material': '材质',
        'DEFAULT': '默认',
        'CHROME': '液态铬',
        'OIL': '油膜',
        'Relief': '起伏',
        'Tint': '染色',

        'Mode': '模式',
        'Base hue': '基础色相',
        'Hue range': '色相范围',
        'FULL': '全彩',
        'SINGLE': '单色',
        'MONO': '黑白',

        'NONE': '无',
        'FROST': '磨砂',
        'DREAM': '梦境',
        'GRAIN': '颗粒',
        'VIGNETTE': '暗角',
        'HALFTONE': '半调',
        'ASCII': '字符画',
        'DITHER': '抖动',
        'REEDED': '凹槽',
        'RIPPLE': '波纹',
        'PEBBLED': '鹅卵石',
        'DIAMOND': '菱形',
        'MOLTEN': '熔融',
        'Filter intensity': '滤镜强度',
        'Filter scale': '滤镜尺度',

        'Frequency X': '频率 X',
        'Frequency Y': '频率 Y',
        'Octaves': '噪声层数',
        'Seed': '随机种子',
        'Glass blur': '玻璃模糊',

        'Trajectory': '轨迹',
        'RANDOM': '随机',
        'LISSAJOUS': '利萨如',
        'ORBIT': '轨道',
        'SINE_WAVE': '正弦波',
        'SMOKE': '烟雾',
        'INK': '墨色',
        'RAINBOW': '彩虹',
        'AQUA': '水母',
        'BLINK': '涟漪',
        'VORTEX': '漩涡',
        'KALEIDO': '万花筒',
        'COMET': '流星',
        'PULSE': '脉冲',
        'Band threshold': '频段阈值',
        'Splat force': '喷溅力度',
        'Volume gain': '音量增益',
        'Color gain': '颜色增益',
        'Color knee': '颜色弯曲点',
        'Volume compress': '音量压缩',
        'Energy curve': '能量曲线',
        'Anchor wobble': '锚点抖动',

        'Sensitivity': '灵敏度',
        'Cooldown (ms)': '冷却 (ms)',
        'Burst base': '爆发基础',
        'Burst gain': '爆发增益',

        'Paused': '暂停',
        'Random splats': '随机喷溅',
        'Reset preset': '重置预设',
        'Save as default': '保存为默认',
        'Reset to factory': '恢复出厂',
        'Copy settings as JSON': '复制设置为 JSON',
        'Export to file': '导出为文件',
        'Import settings': '导入设置',
        'Saved ✓': '已保存 ✓',
        'Copied ✓': '已复制 ✓',
        'Exported ✓': '已导出 ✓',
        'Imported ✓': '已导入 ✓',
        'Bad file': '文件无效',
        'See console': '查看控制台',

        // ── Tooltips ────────────────────────────────────────────
        'Grid resolution of the velocity-field simulation. Higher = finer motion detail, more GPU cost. Changing rebuilds framebuffers.':
            '速度场模拟的网格分辨率。越高 = 运动细节越精细,GPU 开销越大。改动会重建帧缓冲。',
        'Resolution of the color (dye) texture. Higher = crisper colors, more VRAM. Changing rebuilds framebuffers.':
            '颜料(染料)纹理的分辨率。越高 = 颜色越锐利,显存占用越大。改动会重建帧缓冲。',
        'How quickly the color fades. 0 = colors stay forever, 4 = vanish almost instantly. Raise if the screen gets too saturated.':
            '颜色消散的速度。0 = 颜色永久保留,4 = 几乎瞬间消失。如果画面过饱和,调高此值。',
        'How quickly motion slows down. Higher = fluid quickly comes to rest, lower = momentum keeps swirling for ages.':
            '运动衰减的速度。越高 = 流体快速静止,越低 = 动量持续旋转许久。',
        'Strength of pressure projection — how strictly the fluid stays incompressible. Lower = soft puffy smoke, higher = liquid-like.':
            '压力投影的强度 — 流体保持不可压缩的严格程度。越低 = 蓬松烟雾感,越高 = 液体感。',
        'How much swirling is amplified. 0 = no eddies, 30+ = strong vortices. The signature "swirl" knob.':
            '旋转涡度的放大倍数。0 = 无涡流,30+ = 强烈漩涡。"漩涡"的核心调节。',
        'Size of each color injection. Small = pinpoint dots, large = broad smears.':
            '每次颜色注入的大小。小 = 精准点,大 = 宽阔涂抹。',

        'Adds fake lighting based on color gradients — makes the fluid look 3D. Off = flat, off-trippy.':
            '基于颜色梯度添加伪光照 — 使流体看起来立体。关闭 = 扁平。',
        'Glow halo around bright areas. Major visual punch but the main cause of whiteout on loud audio. Turn off if too blown out.':
            '明亮区域周围的光晕。视觉冲击力强但大音量下容易过曝。如果太亮可以关掉。',
        'Strength of the bloom glow. Lower if loud passages turn the screen white.':
            '泛光强度。如果大音量时画面变白,调低此值。',
        'Brightness above which bloom kicks in. Raise (toward 1) so only very bright spots glow.':
            '触发泛光的亮度阈值。调高(接近 1)则仅最亮的点会发光。',
        'God rays / volumetric light streaming from bright spots. Adds drama, also tends to whiteout on loud audio.':
            '从亮点散射的体积光线 / 神光。增加戏剧感,但大音量时容易过曝。',
        'Strength of the god rays.': '神光强度。',
        'Canvas background color. Tip: pure black (#000000) makes additive colors pop the most.':
            '画面背景色。提示:纯黑 (#000000) 让叠加颜色最鲜明。',

        'How the dye is turned into a picture. DEFAULT = glowing pigment (uses Shading, Bloom and Sunrays). CHROME = liquid metal: density becomes a surface that mirrors a studio environment. OIL = oil slick: iridescent interference colors follow the film thickness. CHROME and OIL ignore Shading, Bloom and Sunrays, and combine with any filter.':
            '染料如何变成画面。默认 = 发光颜料(使用着色、泛光和光线)。液态铬 = 液态金属:密度变成反射摄影棚环境的表面。油膜 = 浮油:彩虹干涉色随膜厚变化。液态铬和油膜会忽略着色、泛光和光线,并可与任意滤镜叠加。',
        'CHROME / OIL only. How strongly density differences tilt the surface. 0 = flat mirror, higher = deeper ripples and sharper highlights.':
            '仅液态铬 / 油膜。密度差异使表面倾斜的程度。0 = 平面镜,越高 = 起伏越深、高光越锐利。',
        'CHROME / OIL only. How much of the palette color the surface keeps. 0 = pure silver / pure interference colors, 1 = fully tinted by the dye.':
            '仅液态铬 / 油膜。表面保留多少调色板颜色。0 = 纯银色 / 纯干涉色,1 = 完全染上染料的颜色。',

        'How splat colors are picked. FULL = each band uses its anchor hue, splats span the rainbow. SINGLE = every splat picks a hue around Base hue with ±Hue range jitter. MONO = saturation forced to 0, only brightness varies — black/white/grey.':
            '喷溅颜色的选择方式。全彩 = 每个频段使用各自的色相,跨越彩虹。单色 = 每次喷溅围绕基础色相在 ±色相范围内浮动。黑白 = 饱和度强制为 0,只有亮度变化。',
        'SINGLE mode only. 0 = red, 0.17 = yellow, 0.33 = green, 0.5 = cyan, 0.67 = blue, 0.83 = magenta. Loops back to red at 1.':
            '仅单色模式。0 = 红,0.17 = 黄,0.33 = 绿,0.5 = 青,0.67 = 蓝,0.83 = 品红。1 时回到红色。',
        'SINGLE mode only. ±jitter around Base hue. 0 = strict single color. 0.3+ = wide spectrum within one family. 0.5 = nearly full rainbow.':
            '仅单色模式。围绕基础色相的 ±抖动范围。0 = 严格单色,0.3+ = 同色系宽频谱,0.5 = 接近全彩虹。',

        'Post-processing over the fluid. CSS layer: FROST/DREAM (blur), GRAIN (film grain), VIGNETTE (dark corners). Shader: HALFTONE (print dots sized by brightness), ASCII (character grid), DITHER (1-bit pixels), REEDED (fluted glass). SVG glass displacement: RIPPLE (water), PEBBLED (small cobbles), DIAMOND (lattice/patterned), MOLTEN (large organic).':
            '流体之上的后期处理。CSS 层:磨砂/梦境(模糊)、颗粒(胶片颗粒)、暗角(边缘变暗)。着色器:半调(网点大小随亮度变化)、字符画(字符网格)、抖动(1-bit 像素)、凹槽(条纹玻璃)。SVG 玻璃位移:波纹(水)、鹅卵石(小石子)、菱形(格子/图案)、熔融(大型有机)。',
        'Strength of the active filter. FROST/DREAM: blur radius. GRAIN: opacity. VIGNETTE: darkness. HALFTONE: dot size. ASCII: how much image color is kept (all of it from 50 up, 0 = two-tone). DITHER: how much image color is kept (0 = two-tone). REEDED: refraction. Other glass modes: pixel-displacement scale (the main "depth" knob). Has no effect when filter is NONE.':
            '当前滤镜的强度。磨砂/梦境:模糊半径。颗粒:不透明度。暗角:暗度。半调:网点大小。字符画:保留多少画面颜色(50 及以上为全彩,0 = 双色)。抖动:保留多少画面颜色(0 = 双色)。凹槽:折射强度。其他玻璃类:像素位移幅度(主要的"深度"调节)。滤镜为"无"时不起作用。',
        'Feature size of the shader filters. HALFTONE: dot pitch. ASCII: character size. DITHER: pixel size. REEDED: flute width. Has no effect on the other filters.':
            '着色器滤镜的特征尺寸。半调:网点间距。字符画:字符大小。抖动:像素大小。凹槽:条纹宽度。对其他滤镜不起作用。',

        'Horizontal noise frequency for the glass texture. LOW (0.001) = wide bands, HIGH (0.1) = tight stripes. For vertical streaks, keep this 5–50× higher than Frequency Y.':
            '玻璃纹理的水平噪声频率。低 (0.001) = 宽条带,高 (0.1) = 紧密条纹。要做垂直条纹效果,保持此值比 Y 频率高 5-50 倍。',
        'Vertical noise frequency. Mirror of Frequency X. For pure vertical streaks, drop this near 0; for round pebble patterns, match Frequency X.':
            '垂直噪声频率。X 频率的镜像。纯垂直条纹将此值降到接近 0;圆形鹅卵石图案则与 X 频率匹配。',
        'How many noise octaves are layered. 1 = clean cellular pattern (good for DIAMOND), 3+ = increasingly organic / chaotic (good for RIPPLE).':
            '叠加的噪声层数。1 = 干净的细胞图案(适合菱形),3+ = 越来越有机 / 混乱(适合波纹)。',
        'Noise random seed. Drag to scrub through different texture variations of the same style. The pattern changes shape but keeps the same overall feel.':
            '噪声随机种子。拖动以浏览同一风格的不同纹理变体。图案形状会变化但整体感觉保持一致。',
        'Extra Gaussian blur layered on top of the displaced canvas. 0 = sharp glass, 2+ = thick frosted look. Mostly used by MOLTEN; great companion to all glass modes.':
            '叠加在位移后画面之上的额外高斯模糊。0 = 锐利玻璃,2+ = 厚磨砂感。主要用于熔融效果,也适合所有玻璃模式。',

        'Path that splats follow. RANDOM = stationary anchors. LISSAJOUS = woven closed curves. ORBIT = concentric rings. SINE_WAVE = horizontal lanes. SMOKE = fog cannons fired by the drums. INK = brush strokes written on the beat. RAINBOW = a rainbow raised by every kick, a prism lit by the snare. AQUA = jellyfish that swim on the kick. BLINK = raindrops that land on the beat. VORTEX = a galaxy that winds in a new arm on every kick. KALEIDO = a mandala drawn ring by ring on the beat. COMET = a meteor shower, a meteor on every kick. PULSE = rings out on the kick, in on the snare.':
            '喷溅遵循的路径。随机 = 固定锚点。利萨如 = 编织闭合曲线。轨道 = 同心环。正弦波 = 水平轨道。烟雾 = 鼓点点燃的烟柱。墨色 = 踩着节拍写下的笔触。彩虹 = 每个底鼓升起一道彩虹,军鼓点亮一束棱镜光。水母 = 随底鼓游动的水母。涟漪 = 落在节拍上的雨滴。漩涡 = 每个底鼓卷入一条新旋臂的星系。万花筒 = 随节拍一圈圈画出的曼陀罗。流星 = 流星雨,每个底鼓一颗流星。脉冲 = 底鼓向外推出圆环,军鼓向内收拢。',
        'Frequency bands quieter than this are ignored. Raise to filter background noise (room hum, faint mic pickup).':
            '低于此阈值的频段会被忽略。调高以过滤背景噪声(房间嗡嗡声、微弱的麦克风拾音)。',
        'How hard each frame pushes the fluid. Higher = more violent motion. The main "intensity" knob.':
            '每帧推动流体的力度。越高 = 运动越剧烈。主要的"强度"调节。',
        'How much overall volume amplifies the force. 0 = volume ignored, only per-band energy matters.':
            '整体音量放大力度的程度。0 = 忽略音量,只考虑各频段的能量。',
        'Upper limit of per-splat color brightness. The screen can never get brighter than this per splat — bumper against whiteout.':
            '单次喷溅颜色亮度的上限。每次喷溅的亮度不会超过此值 — 防过曝的保护。',
        'Soft-clip steepness for per-splat brightness. Higher = approaches Color gain faster (more linear), lower = gentler ramp.':
            '单次喷溅亮度的软裁陡度。越高 = 接近颜色增益的速度越快(更线性),越低 = 过渡越平缓。',
        'Loud passages dim each splat (force unchanged). Anti-whiteout. 0 = no compression, 2+ = aggressive ducking on loud sections.':
            '大音量段落降低每次喷溅的亮度(力度不变)。防过曝。0 = 不压缩,2+ = 大音量时强烈抑制。',
        'Exponent applied to band energy. >1 = punchier (quiet quieter, loud louder). <1 = compressed dynamics.':
            '应用于频段能量的指数。>1 = 更有力(安静更安静,大声更大声)。<1 = 动态范围压缩。',
        "For RANDOM trajectory only — how much each band's splat point drifts over time. 0 = pinned points, 0.2 = roaming.":
            '仅"随机"轨迹生效 — 每个频段喷溅点随时间漂移的幅度。0 = 固定点,0.2 = 自由游走。',

        'Spectral flux must exceed its rolling average × this to fire an onset. Lower = catches every flicker, higher = only real beats.':
            '频谱通量必须超过滚动均值 × 此值才触发起音。越低 = 捕捉每一次闪烁,越高 = 仅真正的节拍。',
        'Minimum gap between consecutive onsets. Raise to prevent machine-gun bursts on busy music. The nine modes follow each drum on its own and use a fraction of this gap.':
            '相邻起音之间的最小间隔。调高以防止繁忙音乐中连发爆炸。九个模式分别跟随每种鼓,各自只用这个间隔的一部分。',
        'Baseline number of splats per onset, regardless of volume. In the nine modes: how big every hit is drawn.':
            '每次起音的基础喷溅数,与音量无关。在九个模式中:每次击打画得多大。',
        'Extra splats per onset added by volume. Big rooms get fat bursts; quiet onsets stay light. In the nine modes: how much louder passages enlarge the hits.':
            '每次起音根据音量额外增加的喷溅数。大场景获得厚重爆发,安静起音保持轻盈。在九个模式中:响亮段落把击打放大多少。',

        'Freeze the simulation. Splats keep being injected but motion stops. Shortcut: P key.':
            '冻结模拟。喷溅继续注入但运动停止。快捷键:P。',
        'Manually fire a multi-splat burst. Useful when testing visuals without audio. Shortcut: Space.':
            '手动触发多重喷溅爆发。无音频测试视觉时有用。快捷键:空格。',
        'Restore all Simulation + Effects values to the current mode preset. Audio knobs are not touched.':
            '将所有模拟 + 视觉效果值恢复到当前模式预设。音频调节不变。',
        'Persist every current panel value (fluid + audio + trajectory + filter + glass) to this browser. Next page load will start from this snapshot instead of the factory DEFAULT.':
            '将当前面板所有值(流体 + 音频 + 轨迹 + 滤镜 + 玻璃)持久化到此浏览器。下次加载将从此快照开始,而非出厂默认。',
        'Clear the saved snapshot from this browser and reload. Page will come back up with the factory defaults.':
            '清除此浏览器中保存的快照并重新加载。页面将以出厂默认设置重新启动。',
        'Copy the current panel state to your clipboard as a JSON object. Use this to share a configuration or paste into source code as a new factory default.':
            '将当前面板状态作为 JSON 对象复制到剪贴板。用于分享配置或作为新出厂默认粘贴到源代码。',
        'Download the current panel state as swirl-settings.json. Unlike "Save as default" (this browser only), the file works across devices, browsers and after clearing site data — re-load it any time with "Import settings".':
            '将当前面板状态下载为 swirl-settings.json 文件。与"保存为默认"(仅限本浏览器)不同,该文件可跨设备、跨浏览器、清除站点数据后仍可用 —— 随时用"导入设置"重新载入。',
        'Load a swirl-settings.json file exported earlier (or shared by someone else) and apply every value immediately. Tip: follow with "Save as default" to keep it on the next page load.':
            '载入此前导出(或他人分享)的 swirl-settings.json 文件并立即应用全部数值。提示:之后点"保存为默认"即可在下次加载时保留。',
    },
};

function t (s, vars) {
    // Per-lang override first, then English override, then the source string itself.
    const lang = STRINGS[currentLang];
    let out = (lang && lang[s]) || (STRINGS.en && STRINGS.en[s]) || s;
    if (vars) for (const k in vars) out = out.split('{' + k + '}').join(vars[k]);
    return out;
}

function applyLanguage () {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = t(el.dataset.i18nHtml);
    });
    // mic-label: shows t('OFF') only when in disconnected state (marked by data-off)
    const micLabel = document.getElementById('mic-label');
    if (micLabel && micLabel.hasAttribute('data-off')) micLabel.textContent = t('OFF');
    // Re-render panel so labels/tips re-translate
    if (typeof buildSettingsPanel === 'function') {
        buildSettingsPanel();
        if (typeof refreshPanel === 'function') refreshPanel();
    }
    // Re-render the mixer so its labels (Sources / Mute / add buttons) re-translate
    if (window.__renderMixer) window.__renderMixer();
    // Highlight active lang option
    document.querySelectorAll('.lang-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.lang === currentLang);
    });
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
}

function setLanguage (lang) {
    if (lang !== 'en' && lang !== 'zh' || lang === currentLang) return;
    currentLang = lang;
    try { localStorage.setItem('swirl-lang', lang); } catch (_) {}
    applyLanguage();
}

const PANEL_SCHEMA = [
    {
        title: 'Simulation',
        items: [
            { type: 'select', label: 'Sim resolution',  options: [32, 64, 128, 256],
              tip: 'Grid resolution of the velocity-field simulation. Higher = finer motion detail, more GPU cost. Changing rebuilds framebuffers.',
              get: () => config.SIM_RESOLUTION, set: v => { config.SIM_RESOLUTION = +v; initFramebuffers(); } },
            { type: 'select', label: 'Dye resolution',  options: [128, 256, 512, 1024],
              tip: 'Resolution of the color (dye) texture. Higher = crisper colors, more VRAM. Changing rebuilds framebuffers.',
              get: () => config.DYE_RESOLUTION, set: v => { config.DYE_RESOLUTION = +v; initFramebuffers(); } },
            { type: 'range',  label: 'Density diffusion',  min: 0,    max: 4,    step: 0.01,
              tip: 'How quickly the color fades. 0 = colors stay forever, 4 = vanish almost instantly. Raise if the screen gets too saturated.',
              get: () => config.DENSITY_DISSIPATION, set: v => config.DENSITY_DISSIPATION = +v },
            { type: 'range',  label: 'Velocity diffusion', min: 0,    max: 4,    step: 0.01,
              tip: 'How quickly motion slows down. Higher = fluid quickly comes to rest, lower = momentum keeps swirling for ages.',
              get: () => config.VELOCITY_DISSIPATION, set: v => config.VELOCITY_DISSIPATION = +v },
            { type: 'range',  label: 'Pressure',           min: 0,    max: 1,    step: 0.01,
              tip: 'Strength of pressure projection — how strictly the fluid stays incompressible. Lower = soft puffy smoke, higher = liquid-like.',
              get: () => config.PRESSURE, set: v => config.PRESSURE = +v },
            { type: 'range',  label: 'Vorticity (curl)',   min: 0,    max: 50,   step: 1,
              tip: 'How much swirling is amplified. 0 = no eddies, 30+ = strong vortices. The signature "swirl" knob.',
              get: () => config.CURL, set: v => config.CURL = +v },
            { type: 'range',  label: 'Splat radius',       min: 0.01, max: 1,    step: 0.01,
              tip: 'Size of each color injection. Small = pinpoint dots, large = broad smears.',
              get: () => config.SPLAT_RADIUS, set: v => config.SPLAT_RADIUS = +v },
        ],
    },
    {
        title: 'Effects',
        items: [
            { type: 'toggle', label: 'Shading',
              tip: 'Adds fake lighting based on color gradients — makes the fluid look 3D. Off = flat, off-trippy.',
              get: () => config.SHADING, set: v => { config.SHADING = v; updateKeywords(); } },
            { type: 'toggle', label: 'Bloom',
              tip: 'Glow halo around bright areas. Major visual punch but the main cause of whiteout on loud audio. Turn off if too blown out.',
              get: () => config.BLOOM, set: v => { config.BLOOM = v; updateKeywords(); } },
            { type: 'range',  label: 'Bloom intensity',  min: 0.1, max: 2, step: 0.01,
              tip: 'Strength of the bloom glow. Lower if loud passages turn the screen white.',
              get: () => config.BLOOM_INTENSITY, set: v => config.BLOOM_INTENSITY = +v },
            { type: 'range',  label: 'Bloom threshold',  min: 0,   max: 1, step: 0.01,
              tip: 'Brightness above which bloom kicks in. Raise (toward 1) so only very bright spots glow.',
              get: () => config.BLOOM_THRESHOLD, set: v => config.BLOOM_THRESHOLD = +v },
            { type: 'toggle', label: 'Sunrays',
              tip: 'God rays / volumetric light streaming from bright spots. Adds drama, also tends to whiteout on loud audio.',
              get: () => config.SUNRAYS, set: v => { config.SUNRAYS = v; updateKeywords(); } },
            { type: 'range',  label: 'Sunrays weight',   min: 0.3, max: 1, step: 0.01,
              tip: 'Strength of the god rays.',
              get: () => config.SUNRAYS_WEIGHT, set: v => config.SUNRAYS_WEIGHT = +v },
            { type: 'color',  label: 'Background',
              tip: 'Canvas background color. Tip: pure black (#000000) makes additive colors pop the most.',
              get: () => rgbToHex(config.BACK_COLOR), set: v => config.BACK_COLOR = hexToRgb(v) },
        ],
    },
    {
        title: 'Material',
        items: [
            { type: 'select', label: 'Material',
              options: ['DEFAULT', 'CHROME', 'OIL'],
              tip: 'How the dye is turned into a picture. DEFAULT = glowing pigment (uses Shading, Bloom and Sunrays). CHROME = liquid metal: density becomes a surface that mirrors a studio environment. OIL = oil slick: iridescent interference colors follow the film thickness. CHROME and OIL ignore Shading, Bloom and Sunrays, and combine with any filter.',
              get: () => SURFACES[config.MATERIAL] ? config.MATERIAL : 'DEFAULT',
              set: v => { config.MATERIAL = v; applyMaterial(); } },
            { type: 'range', label: 'Relief', min: 0, max: 12, step: 0.1,
              tip: 'CHROME / OIL only. How strongly density differences tilt the surface. 0 = flat mirror, higher = deeper ripples and sharper highlights.',
              get: () => config.MATERIAL_RELIEF, set: v => config.MATERIAL_RELIEF = +v },
            { type: 'range', label: 'Tint', min: 0, max: 1, step: 0.01,
              tip: 'CHROME / OIL only. How much of the palette color the surface keeps. 0 = pure silver / pure interference colors, 1 = fully tinted by the dye.',
              get: () => config.MATERIAL_TINT, set: v => config.MATERIAL_TINT = +v },
        ],
    },
    {
        title: 'Palette',
        items: [
            { type: 'select', label: 'Mode',
              options: ['FULL', 'SINGLE', 'MONO'],
              tip: 'How splat colors are picked. FULL = each band uses its anchor hue, splats span the rainbow. SINGLE = every splat picks a hue around Base hue with ±Hue range jitter. MONO = saturation forced to 0, only brightness varies — black/white/grey.',
              get: () => PALETTE.mode, set: v => { PALETTE.mode = v; } },
            { type: 'range', label: 'Base hue', min: 0, max: 1, step: 0.005,
              tip: 'SINGLE mode only. 0 = red, 0.17 = yellow, 0.33 = green, 0.5 = cyan, 0.67 = blue, 0.83 = magenta. Loops back to red at 1.',
              get: () => PALETTE.singleHue, set: v => { PALETTE.singleHue = +v; } },
            { type: 'range', label: 'Hue range', min: 0, max: 0.5, step: 0.005,
              tip: 'SINGLE mode only. ±jitter around Base hue. 0 = strict single color. 0.3+ = wide spectrum within one family. 0.5 = nearly full rainbow.',
              get: () => PALETTE.singleRange, set: v => { PALETTE.singleRange = +v; } },
        ],
    },
    {
        title: 'Filter',
        items: [
            { type: 'select', label: 'Filter',
              options: ['NONE', 'FROST', 'DREAM', 'GRAIN', 'VIGNETTE', 'HALFTONE', 'ASCII', 'DITHER', 'REEDED', 'RIPPLE', 'PEBBLED', 'DIAMOND', 'MOLTEN'],
              tip: 'Post-processing over the fluid. CSS layer: FROST/DREAM (blur), GRAIN (film grain), VIGNETTE (dark corners). Shader: HALFTONE (print dots sized by brightness), ASCII (character grid), DITHER (1-bit pixels), REEDED (fluted glass). SVG glass displacement: RIPPLE (water), PEBBLED (small cobbles), DIAMOND (lattice/patterned), MOLTEN (large organic).',
              get: () => filterState.name,
              set: v => {
                  filterState.name = v;
                  if (isGlassFilter(v)) loadGlassPreset(v);
                  applyFilter();
                  refreshPanel();
              } },
            { type: 'range', label: 'Filter intensity', min: 0, max: 100, step: 1,
              tip: 'Strength of the active filter. FROST/DREAM: blur radius. GRAIN: opacity. VIGNETTE: darkness. HALFTONE: dot size. ASCII: how much image color is kept (all of it from 50 up, 0 = two-tone). DITHER: how much image color is kept (0 = two-tone). REEDED: refraction. Other glass modes: pixel-displacement scale (the main "depth" knob). Has no effect when filter is NONE.',
              get: () => filterState.intensity, set: v => { filterState.intensity = +v; applyFilter(); } },
            { type: 'range', label: 'Filter scale', min: 0, max: 100, step: 1,
              tip: 'Feature size of the shader filters. HALFTONE: dot pitch. ASCII: character size. DITHER: pixel size. REEDED: flute width. Has no effect on the other filters.',
              get: () => filterState.scale, set: v => { filterState.scale = +v; } },
        ],
    },
    {
        title: 'Glass displacement',
        items: [
            { type: 'range', label: 'Frequency X', min: 0.0005, max: 0.2, step: 0.0005,
              tip: 'Horizontal noise frequency for the glass texture. LOW (0.001) = wide bands, HIGH (0.1) = tight stripes. For vertical streaks, keep this 5–50× higher than Frequency Y.',
              get: () => filterState.freqX, set: v => { filterState.freqX = +v; applyFilter(); } },
            { type: 'range', label: 'Frequency Y', min: 0.0001, max: 0.2, step: 0.0005,
              tip: 'Vertical noise frequency. Mirror of Frequency X. For pure vertical streaks, drop this near 0; for round pebble patterns, match Frequency X.',
              get: () => filterState.freqY, set: v => { filterState.freqY = +v; applyFilter(); } },
            { type: 'range', label: 'Octaves', min: 1, max: 5, step: 1,
              tip: 'How many noise octaves are layered. 1 = clean cellular pattern (good for DIAMOND), 3+ = increasingly organic / chaotic (good for RIPPLE).',
              get: () => filterState.octaves, set: v => { filterState.octaves = +v; applyFilter(); } },
            { type: 'range', label: 'Seed', min: 0, max: 100, step: 1,
              tip: 'Noise random seed. Drag to scrub through different texture variations of the same style. The pattern changes shape but keeps the same overall feel.',
              get: () => filterState.seed, set: v => { filterState.seed = +v; applyFilter(); } },
            { type: 'range', label: 'Glass blur', min: 0, max: 8, step: 0.1,
              tip: 'Extra Gaussian blur layered on top of the displaced canvas. 0 = sharp glass, 2+ = thick frosted look. Mostly used by MOLTEN; great companion to all glass modes.',
              get: () => filterState.blur, set: v => { filterState.blur = +v; applyFilter(); } },
        ],
    },
    {
        title: 'Audio → Fluid',
        items: [
            { type: 'select', label: 'Trajectory',
              options: ['RANDOM', 'LISSAJOUS', 'ORBIT', 'SINE_WAVE', 'SMOKE', 'INK', 'RAINBOW', 'AQUA', 'BLINK', 'VORTEX', 'KALEIDO', 'COMET', 'PULSE'],
              tip: 'Path that splats follow. RANDOM = stationary anchors. LISSAJOUS = woven closed curves. ORBIT = concentric rings. SINE_WAVE = horizontal lanes. SMOKE = fog cannons fired by the drums. INK = brush strokes written on the beat. RAINBOW = a rainbow raised by every kick, a prism lit by the snare. AQUA = jellyfish that swim on the kick. BLINK = raindrops that land on the beat. VORTEX = a galaxy that winds in a new arm on every kick. KALEIDO = a mandala drawn ring by ring on the beat. COMET = a meteor shower, a meteor on every kick. PULSE = rings out on the kick, in on the snare.',
              get: () => currentTrajectory, set: v => currentTrajectory = v },
            { type: 'range', label: 'Band threshold', min: 0,    max: 0.3,  step: 0.005,
              tip: 'Frequency bands quieter than this are ignored. Raise to filter background noise (room hum, faint mic pickup).',
              get: () => AUDIO.BAND_THRESHOLD, set: v => AUDIO.BAND_THRESHOLD = +v },
            { type: 'range', label: 'Splat force',    min: 0,    max: 6000, step: 50,
              tip: 'How hard each frame pushes the fluid. Higher = more violent motion. The main "intensity" knob.',
              get: () => AUDIO.SPLAT_FORCE, set: v => AUDIO.SPLAT_FORCE = +v },
            { type: 'range', label: 'Volume gain',    min: 0,    max: 4,    step: 0.05,
              tip: 'How much overall volume amplifies the force. 0 = volume ignored, only per-band energy matters.',
              get: () => AUDIO.VOLUME_GAIN, set: v => AUDIO.VOLUME_GAIN = +v },
            { type: 'range', label: 'Color gain',     min: 0,    max: 2,    step: 0.01,
              tip: 'Upper limit of per-splat color brightness. The screen can never get brighter than this per splat — bumper against whiteout.',
              get: () => AUDIO.COLOR_GAIN, set: v => AUDIO.COLOR_GAIN = +v },
            { type: 'range', label: 'Color knee',     min: 0.2,  max: 5,    step: 0.05,
              tip: 'Soft-clip steepness for per-splat brightness. Higher = approaches Color gain faster (more linear), lower = gentler ramp.',
              get: () => AUDIO.COLOR_KNEE, set: v => AUDIO.COLOR_KNEE = +v },
            { type: 'range', label: 'Volume compress', min: 0,   max: 3,    step: 0.05,
              tip: 'Loud passages dim each splat (force unchanged). Anti-whiteout. 0 = no compression, 2+ = aggressive ducking on loud sections.',
              get: () => AUDIO.VOLUME_COMPRESS, set: v => AUDIO.VOLUME_COMPRESS = +v },
            { type: 'range', label: 'Energy curve',   min: 0.5,  max: 3,    step: 0.05,
              tip: 'Exponent applied to band energy. >1 = punchier (quiet quieter, loud louder). <1 = compressed dynamics.',
              get: () => AUDIO.ENERGY_CURVE, set: v => AUDIO.ENERGY_CURVE = +v },
            { type: 'range', label: 'Anchor wobble',  min: 0,    max: 0.2,  step: 0.005,
              tip: 'For RANDOM trajectory only — how much each band\'s splat point drifts over time. 0 = pinned points, 0.2 = roaming.',
              get: () => AUDIO.ANCHOR_WOBBLE, set: v => AUDIO.ANCHOR_WOBBLE = +v },
        ],
    },
    {
        title: 'Onset / Beat',
        items: [
            { type: 'range',  label: 'Sensitivity',    min: 1,  max: 4,   step: 0.05,
              tip: 'Spectral flux must exceed its rolling average × this to fire an onset. Lower = catches every flicker, higher = only real beats.',
              get: () => AUDIO.ONSET_SENSITIVITY, set: v => AUDIO.ONSET_SENSITIVITY = +v },
            { type: 'range',  label: 'Cooldown (ms)',  min: 20, max: 500, step: 5,
              tip: 'Minimum gap between consecutive onsets. Raise to prevent machine-gun bursts on busy music. The nine modes follow each drum on its own and use a fraction of this gap.',
              get: () => AUDIO.ONSET_COOLDOWN_MS, set: v => AUDIO.ONSET_COOLDOWN_MS = +v },
            { type: 'range',  label: 'Burst base',     min: 0,  max: 20,  step: 1,
              tip: 'Baseline number of splats per onset, regardless of volume. In the nine modes: how big every hit is drawn.',
              get: () => AUDIO.ONSET_BURST_BASE, set: v => AUDIO.ONSET_BURST_BASE = +v },
            { type: 'range',  label: 'Burst gain',     min: 0,  max: 30,  step: 0.5,
              tip: 'Extra splats per onset added by volume. Big rooms get fat bursts; quiet onsets stay light. In the nine modes: how much louder passages enlarge the hits.',
              get: () => AUDIO.ONSET_BURST_GAIN, set: v => AUDIO.ONSET_BURST_GAIN = +v },
        ],
    },
    {
        title: 'Playback',
        items: [
            // Temporarily hidden — only default mic is in play.
            // { type: 'button', label: 'Change audio source',
            //   tip: 'Reopen the source picker (Microphone / Browser tab / Audio file).',
            //   action: () => { if (window.__showSourceOverlay) window.__showSourceOverlay(); } },
            // { type: 'button', label: 'Switch input device',
            //   tip: 'Jump straight to the audio input device list — useful for swapping between mic and virtual cables (VB-Cable / BlackHole).',
            //   action: () => { if (window.__showDevicePicker) window.__showDevicePicker(); } },
            { type: 'toggle', label: 'Paused',
              tip: 'Freeze the simulation. Splats keep being injected but motion stops. Shortcut: P key.',
              get: () => config.PAUSED, set: v => config.PAUSED = v },
            { type: 'button', label: 'Random splats',
              tip: 'Manually fire a multi-splat burst. Useful when testing visuals without audio. Shortcut: Space.',
              action: () => splatStack.push(Math.floor(Math.random() * 20) + 5) },
            { type: 'button', label: 'Reset preset',
              tip: 'Restore all Simulation + Effects values to the current mode preset. Audio knobs are not touched.',
              action: () => applyPreset(currentPresetName) },
            { type: 'button', label: 'Save as default',
              tip: 'Persist every current panel value (fluid + audio + trajectory + filter + glass) to this browser. Next page load will start from this snapshot instead of the factory DEFAULT.',
              action: (btn) => {
                  if (saveSettingsToStorage()) {
                      const orig = btn.textContent;
                      btn.textContent = t('Saved ✓');
                      setTimeout(() => { btn.textContent = orig; }, 1200);
                  }
              } },
            { type: 'button', label: 'Reset to factory',
              tip: 'Clear the saved snapshot from this browser and reload. Page will come back up with the factory defaults.',
              action: () => resetSettingsToFactory() },
            { type: 'button', label: 'Copy settings as JSON',
              tip: 'Copy the current panel state to your clipboard as a JSON object. Use this to share a configuration or paste into source code as a new factory default.',
              action: (btn) => {
                  copySettingsAsJSON().then(ok => {
                      const orig = btn.textContent;
                      btn.textContent = ok ? t('Copied ✓') : t('See console');
                      setTimeout(() => { btn.textContent = orig; }, 1400);
                  });
              } },
            { type: 'button', label: 'Export to file',
              tip: 'Download the current panel state as swirl-settings.json. Unlike "Save as default" (this browser only), the file works across devices, browsers and after clearing site data — re-load it any time with "Import settings".',
              action: (btn) => {
                  const ok = exportSettingsToFile();
                  const orig = btn.textContent;
                  btn.textContent = ok ? t('Exported ✓') : t('See console');
                  setTimeout(() => { btn.textContent = orig; }, 1400);
              } },
            { type: 'button', label: 'Import settings',
              tip: 'Load a swirl-settings.json file exported earlier (or shared by someone else) and apply every value immediately. Tip: follow with "Save as default" to keep it on the next page load.',
              action: (btn) => {
                  const input = document.getElementById('settings-import-input');
                  if (!input) return;
                  // Re-bind each click so the closure always sees this btn.
                  input.onchange = () => {
                      const file = input.files && input.files[0];
                      input.value = '';   // allow re-picking the same file later
                      if (!file) return;
                      importSettingsFromFile(file).then(ok => {
                          const orig = btn.textContent;
                          btn.textContent = ok ? t('Imported ✓') : t('Bad file');
                          setTimeout(() => { btn.textContent = orig; }, 1600);
                      });
                  };
                  input.click();
              } },
        ],
    },
];

const __ctrlRefreshers = [];

// ---- Tooltip ----
// One floating element, anchored to the right of the panel,
// vertically tracking whichever control the pointer is over.
let __tipEl = null;
let __tipHideTimer = null;
const PANEL_WIDTH = 300;     // keep in sync with .panel { width: 300px }
const TIP_GAP     = 14;       // px between panel edge and tooltip

function ensureTooltipEl () {
    if (__tipEl) return __tipEl;
    __tipEl = document.createElement('div');
    __tipEl.className = 'tooltip';
    document.body.appendChild(__tipEl);
    return __tipEl;
}

function bindTooltip (el, text) {
    if (!text) return;
    el.classList.add('has-tip');
    el.addEventListener('mouseenter', () => {
        clearTimeout(__tipHideTimer);
        const tip = ensureTooltipEl();
        tip.textContent = t(text);
        tip.classList.add('visible');
        const r = el.getBoundingClientRect();
        // Position to the right of the panel, vertically aligned with control center
        tip.style.left = (PANEL_WIDTH + TIP_GAP) + 'px';
        // After content is set, measure height so we can clamp into viewport
        const h = tip.offsetHeight;
        const wantedY = r.top + r.height / 2 - h / 2;
        const clampedY = Math.max(12, Math.min(window.innerHeight - h - 12, wantedY));
        tip.style.top = clampedY + 'px';
    });
    el.addEventListener('mouseleave', () => {
        // tiny delay so moving across the tip's edge doesn't flicker
        __tipHideTimer = setTimeout(() => {
            if (__tipEl) __tipEl.classList.remove('visible');
        }, 60);
    });
}

function buildSettingsPanel () {
    const panel = document.getElementById('panel');
    if (!panel) return;
    // Only remove schema-built sections; leave the close button and the
    // dynamically-managed mixer section alone.
    panel.querySelectorAll('section:not(#mixer-section)').forEach(s => s.remove());
    PANEL_SCHEMA.forEach(section => {
        const sec = document.createElement('section');
        const h = document.createElement('h3');
        h.textContent = t(section.title);
        sec.appendChild(h);
        section.items.forEach(item => sec.appendChild(buildControl(item)));
        panel.appendChild(sec);
    });
}

function buildControl (item) {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    // Bind tooltip on the wrapper so hovering anywhere on the row triggers it
    if (item.tip) bindTooltip(wrap, item.tip);

    if (item.type === 'range') {
        const row = document.createElement('div');
        row.className = 'ctrl-row';
        const lbl = document.createElement('span');
        lbl.textContent = t(item.label);
        const val = document.createElement('span');
        val.className = 'ctrl-value';
        row.appendChild(lbl); row.appendChild(val);

        const input = document.createElement('input');
        input.type = 'range';
        input.min = item.min; input.max = item.max; input.step = item.step;
        const fmt = v => {
            const n = +v;
            return Number.isInteger(item.step) ? n.toFixed(0) :
                   item.step >= 0.1 ? n.toFixed(1) :
                   item.step >= 0.01 ? n.toFixed(2) :
                                       n.toFixed(3);
        };
        const sync = () => { input.value = item.get(); val.textContent = fmt(input.value); };
        input.addEventListener('input', () => { item.set(+input.value); val.textContent = fmt(input.value); });
        sync();
        __ctrlRefreshers.push(sync);

        wrap.appendChild(row);
        wrap.appendChild(input);
        return wrap;
    }

    if (item.type === 'select') {
        const row = document.createElement('div');
        row.className = 'ctrl-row';
        const lbl = document.createElement('span');
        lbl.textContent = t(item.label);
        const sel = document.createElement('select');
        item.options.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o; opt.textContent = t(o);
            sel.appendChild(opt);
        });
        const sync = () => { sel.value = String(item.get()); };
        sel.addEventListener('change', () => item.set(sel.value));
        sync();
        __ctrlRefreshers.push(sync);
        row.appendChild(lbl); row.appendChild(sel);
        wrap.appendChild(row);
        return wrap;
    }

    if (item.type === 'toggle') {
        const lab = document.createElement('label');
        lab.className = 'ctrl-toggle';
        const txt = document.createElement('span');
        txt.textContent = t(item.label);
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        const dot = document.createElement('span');
        dot.className = 'dot';
        const sync = () => { inp.checked = !!item.get(); };
        inp.addEventListener('change', () => item.set(inp.checked));
        sync();
        __ctrlRefreshers.push(sync);
        lab.appendChild(txt); lab.appendChild(inp); lab.appendChild(dot);
        wrap.appendChild(lab);
        return wrap;
    }

    if (item.type === 'color') {
        const row = document.createElement('div');
        row.className = 'ctrl-row';
        const lbl = document.createElement('span');
        lbl.textContent = t(item.label);
        const inp = document.createElement('input');
        inp.type = 'color';
        const sync = () => { inp.value = item.get(); };
        inp.addEventListener('input', () => item.set(inp.value));
        sync();
        __ctrlRefreshers.push(sync);
        row.appendChild(lbl); row.appendChild(inp);
        wrap.appendChild(row);
        return wrap;
    }

    if (item.type === 'button') {
        const btn = document.createElement('button');
        btn.className = 'ctrl-button';
        btn.textContent = t(item.label);
        btn.addEventListener('click', () => item.action(btn));
        wrap.appendChild(btn);
        return wrap;
    }

    return wrap;
}

function refreshPanel () {
    __ctrlRefreshers.forEach(fn => fn());
}

// Patch applyPreset so the panel reflects preset changes
const __origApplyPreset = applyPreset;
applyPreset = function (name) {
    __origApplyPreset(name);
    refreshPanel();
};

// ============================================================
// SETTINGS PERSISTENCE
// `Save as default` writes the current panel state (every knob —
// fluid config, audio mapping, trajectory, preset, filter, glass
// params) to localStorage. On the next page load the snapshot is
// hydrated AFTER the factory DEFAULT preset, so it overrides it.
// ============================================================

const SWIRL_STORAGE_KEY = 'swirl-settings-v1';

function captureSettings () {
    return {
        version: 1,
        config: { ...config },
        AUDIO: { ...AUDIO },
        PALETTE: { ...PALETTE },
        currentTrajectory,
        currentPresetName,
        filterState: { ...filterState },
    };
}

function saveSettingsToStorage () {
    try {
        localStorage.setItem(SWIRL_STORAGE_KEY, JSON.stringify(captureSettings()));
        return true;
    } catch (e) {
        console.warn('Save failed:', e);
        return false;
    }
}

// Apply a settings snapshot (from localStorage OR an imported file) onto the
// live state. Pure data — it does NOT touch the DOM/shaders, so callers must
// follow it with syncUIFromState() when applying after first paint.
function applySettings (s) {
    if (!s || typeof s !== 'object') return false;
    if (s.config)        Object.assign(config, s.config);
    if (s.AUDIO)         Object.assign(AUDIO, s.AUDIO);
    if (s.PALETTE)       Object.assign(PALETTE, s.PALETTE);
    if (s.filterState)   Object.assign(filterState, s.filterState);
    if (typeof s.currentTrajectory === 'string')  currentTrajectory  = s.currentTrajectory === 'RAIN' ? 'BLINK' : s.currentTrajectory;
    if (typeof s.currentPresetName === 'string') {
        // Migrate renamed/removed preset names from old snapshots:
        // RAIN became BLINK; DEFAULT was merged into RAINBOW.
        let n = s.currentPresetName;
        if (n === 'RAIN') n = 'BLINK';
        if (n === 'DEFAULT') n = 'RAINBOW';
        currentPresetName = PRESETS[n] ? n : 'RAINBOW';
    }
    return true;
}

// Push the whole in-memory state out to the UI + shaders at once. Used after a
// bulk change (import) so sliders, toggles, mode tabs, filter tabs and the
// WebGL keywords all catch up together.
function syncUIFromState () {
    updateKeywords();
    document.querySelectorAll('.modes button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === currentPresetName);
    });
    applyFilter();   // also re-syncs the .filters tab bar active state
    applyMaterial(); // same for the .materials tab bar
    refreshPanel();  // re-syncs every panel slider / toggle / select
}

function loadSettingsFromStorage () {
    try {
        const raw = localStorage.getItem(SWIRL_STORAGE_KEY);
        if (!raw) return false;
        return applySettings(JSON.parse(raw));
    } catch (e) {
        console.warn('Load failed:', e);
        return false;
    }
}

function resetSettingsToFactory () {
    try { localStorage.removeItem(SWIRL_STORAGE_KEY); } catch (e) {}
    location.reload();
}

async function copySettingsAsJSON () {
    const json = JSON.stringify(captureSettings(), null, 2);
    try {
        await navigator.clipboard.writeText(json);
        return true;
    } catch (e) {
        console.warn('Clipboard write failed, dumping to console instead:', e);
        console.log(json);
        return false;
    }
}

// Download the current settings as a .json file. Pairs with importSettings():
// unlike "Save as default" (localStorage), a file survives across devices,
// browsers and cache clears.
function exportSettingsToFile () {
    try {
        const json = JSON.stringify(captureSettings(), null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        downloadURI('swirl-settings.json', url);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        return true;
    } catch (e) {
        console.warn('Export failed:', e);
        return false;
    }
}

// Read a user-picked .json file, sanity-check it's a SWIRL snapshot, apply it
// and refresh the UI. Resolves true on success, false on a bad/unknown file.
function importSettingsFromFile (file) {
    return new Promise(resolve => {
        if (!file) return resolve(false);
        const reader = new FileReader();
        reader.onload = () => {
            let s;
            try { s = JSON.parse(reader.result); }
            catch (e) { console.warn('Import: not valid JSON', e); return resolve(false); }
            // Shape guard so an unrelated .json doesn't silently wipe state.
            if (!s || typeof s !== 'object' ||
                (!s.config && !s.AUDIO && !s.PALETTE && !s.filterState)) {
                console.warn('Import: not a SWIRL settings file', s);
                return resolve(false);
            }
            applySettings(s);
            syncUIFromState();
            resolve(true);
        };
        reader.onerror = () => { console.warn('Import: read error', reader.error); resolve(false); };
        reader.readAsText(file);
    });
}

// ============================================================
// UI BOOTSTRAP
// Mic enable button, mode switching, debug overlay rendering.
// ============================================================

window.addEventListener('DOMContentLoaded', () => {
    buildSettingsPanel();

    // Hydrate any user-saved snapshot on top of the factory baseline
    // (which now lives in the top-of-file `config`/`AUDIO`/`filterState`
    // literals + `currentPresetName = 'SMOKE'`). We deliberately do NOT
    // call applyPreset('DEFAULT') here — that would clobber the literal
    // values with the DEFAULT preset's canonical numbers.
    loadSettingsFromStorage();

    // Sync DOM / shaders to whatever the resolved state is
    updateKeywords();
    document.querySelectorAll('.modes button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === currentPresetName);
    });
    refreshPanel();

    const panel = document.getElementById('panel');
    const panelToggle = document.getElementById('panel-toggle');
    const panelClose = document.getElementById('panel-close');
    panelToggle.addEventListener('click', () => {
        panel.classList.toggle('open');
        panelToggle.classList.toggle('open');
        refreshPanel(); // catch up if keyboard / preset changed things
    });
    panelClose.addEventListener('click', () => {
        panel.classList.remove('open');
        panelToggle.classList.remove('open');
    });

    // Language toggle: EN / 中. setLanguage() re-renders panel + statics.
    document.querySelectorAll('.lang-opt').forEach(btn => {
        btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
    });
    // Apply currently-loaded language now that all DOM + panel exist
    applyLanguage();

    // Presentation mode: body.presenting hides all chrome (title, tabs,
    // panel, footer, mic-status) via CSS; only the toggle itself stays.
    const presentToggle = document.getElementById('present-toggle');
    presentToggle.addEventListener('click', () => {
        const on = document.body.classList.toggle('presenting');
        presentToggle.classList.toggle('active', on);
        if (on) {
            // Auto-close the settings panel so it can't pop back in over the canvas
            panel.classList.remove('open');
            panelToggle.classList.remove('open');
        }
    });

    const overlay = document.getElementById('overlay');
    const overlayHint = document.getElementById('overlay-hint');
    const fileInput = document.getElementById('file-input');
    const micDot = document.getElementById('mic-dot');
    const micLabel = document.getElementById('mic-label');
    const srcBtns = document.querySelectorAll('.src-btn');
    const sourceButtonsEl = document.querySelector('.source-buttons');
    const devicePicker = document.getElementById('device-picker');
    const deviceList = document.getElementById('device-list');
    const deviceBackBtn = document.getElementById('device-back');

    // Disable unsupported source buttons up-front. Safari HAS getDisplayMedia
    // but never delivers audio tracks from it (WebKit doesn't implement
    // display-capture audio), so the button would always dead-end there.
    const displayBtn = document.querySelector('.src-btn[data-source="display"]');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || isSafari()) {
        displayBtn.disabled = true;
        // permaDisabled keeps showOverlay()'s blanket re-enable from
        // resurrecting the button after an unrelated error.
        displayBtn.dataset.permaDisabled = '1';
        // Tag with i18n key so applyLanguage() can re-render on toggle
        const hintEl = displayBtn.querySelector('.src-hint');
        const key = isSafari()
            ? 'Safari can’t capture tab / system audio — use Chrome or Edge, or add an audio file.'
            : 'Not supported in this browser — try Chrome or Edge';
        hintEl.dataset.i18n = key;
        hintEl.textContent = t(key);
    }

    function setHint (msg, isError) {
        overlayHint.textContent = msg || '';
        overlayHint.classList.toggle('error', !!isError);
    }

    function showSourceButtons () {
        sourceButtonsEl.hidden = false;
        devicePicker.hidden = true;
    }

    function showOverlay () {
        overlay.classList.remove('hidden');
        showSourceButtons();
        srcBtns.forEach(b => { if (!b.dataset.permaDisabled) b.disabled = false; });
        setHint('');
    }

    async function showDevicePickerView () {
        sourceButtonsEl.hidden = true;
        devicePicker.hidden = false;
        deviceList.innerHTML = '<div class="device-item" style="cursor:default; opacity:0.5">' + t('Loading devices…') + '</div>';
        setHint('');
        const audio = getAnalyzer();
        try {
            const devices = await audio.listInputDevices();
            renderDeviceList(devices, audio.currentDeviceId);
        } catch (err) {
            console.error('Enumerate error:', err);
            deviceList.innerHTML = '';
            if (err && err.name === 'NotAllowedError') {
                setHint(t('Microphone permission denied — needed to list devices.'), true);
            } else {
                setHint(t('Could not list audio devices.'), true);
            }
        }
    }

    function renderDeviceList (devices, activeId) {
        deviceList.innerHTML = '';
        if (devices.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'device-item';
            empty.style.cursor = 'default';
            empty.style.opacity = '0.5';
            empty.textContent = t('No audio inputs found.');
            deviceList.appendChild(empty);
            return;
        }
        devices.forEach(d => {
            const btn = document.createElement('button');
            btn.className = 'device-item';
            if (d.deviceId === activeId) btn.classList.add('active');
            btn.textContent = d.label;
            btn.addEventListener('click', () => pickSource('mic', null, d.deviceId));
            deviceList.appendChild(btn);
        });
    }

    function reflectActiveSource () {
        const audio = window.__audio;
        const n = audio ? audio.sources.length : 0;
        if (n > 0) {
            micDot.classList.add('active');
            micLabel.removeAttribute('data-off');
            const first = audio.sources[0].label;
            micLabel.textContent = n > 1 ? `${first} +${n - 1}` : first;
        } else {
            micDot.classList.remove('active');
            // data-off marker lets applyLanguage() re-translate this on toggle
            micLabel.setAttribute('data-off', '');
            micLabel.textContent = t('OFF');
        }
    }

    // Build / refresh the SOURCES mixer pinned at the top of the settings panel.
    // Sources come and go at runtime, so this rebuilds its rows on each change.
    function renderMixer () {
        const panel = document.getElementById('panel');
        if (!panel) return;
        let sec = document.getElementById('mixer-section');
        if (!sec) {
            sec = document.createElement('section');
            sec.id = 'mixer-section';
            const closeBtn = panel.querySelector('.panel-close');
            panel.insertBefore(sec, closeBtn ? closeBtn.nextSibling : panel.firstChild);
        }
        const audio = window.__audio;
        const sources = audio ? audio.sources : [];
        sec.innerHTML = '';

        const h = document.createElement('h3');
        h.textContent = t('Sources');
        sec.appendChild(h);

        // Add-source buttons
        const add = document.createElement('div');
        add.className = 'mixer-add';
        const mkAdd = (label, kind, disabled) => {
            const b = document.createElement('button');
            b.className = 'mixer-add-btn';
            b.textContent = label;
            if (disabled) b.disabled = true;
            b.addEventListener('click', () => {
                if (kind === 'file') fileInput.click();
                else pickSource(kind);
            });
            return b;
        };
        const noDisplay = !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || isSafari();
        add.appendChild(mkAdd(t('+ Mic'), 'mic', false));
        add.appendChild(mkAdd(t('+ System'), 'display', noDisplay));
        add.appendChild(mkAdd(t('+ File'), 'file', false));
        sec.appendChild(add);

        if (sources.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'mixer-empty';
            empty.textContent = t('No sources yet.');
            sec.appendChild(empty);
            return;
        }

        sources.forEach(s => {
            const row = document.createElement('div');
            row.className = 'mixer-row';

            const top = document.createElement('div');
            top.className = 'mixer-row-top';
            const name = document.createElement('span');
            name.className = 'mixer-name';
            name.textContent = s.label;
            const pct = document.createElement('span');
            pct.className = 'mixer-pct';
            pct.textContent = Math.round(s.level * 100) + '%';
            top.appendChild(name);
            top.appendChild(pct);
            row.appendChild(top);

            const ctrl = document.createElement('div');
            ctrl.className = 'mixer-ctrl';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'mixer-fader';
            slider.min = '0'; slider.max = '2'; slider.step = '0.01';
            slider.value = String(s.level);
            slider.addEventListener('input', () => {
                audio.setSourceLevel(s.id, +slider.value);
                pct.textContent = Math.round(+slider.value * 100) + '%';
            });

            const mute = document.createElement('button');
            mute.className = 'mixer-mute';
            mute.textContent = 'M';
            mute.title = t('Mute');
            mute.classList.toggle('muted', s.muted);
            mute.addEventListener('click', () => {
                audio.setSourceMuted(s.id, !s.muted);
                mute.classList.toggle('muted', s.muted);
            });

            const rm = document.createElement('button');
            rm.className = 'mixer-remove';
            rm.textContent = '✕';
            rm.title = t('Remove');
            rm.addEventListener('click', () => audio.removeSource(s.id));

            ctrl.appendChild(slider);
            ctrl.appendChild(mute);
            ctrl.appendChild(rm);
            row.appendChild(ctrl);
            sec.appendChild(row);
        });
    }
    window.__renderMixer = renderMixer;

    // Lazy singleton — created on first source selection, reused across switches
    function getAnalyzer () {
        if (!window.__audio) {
            window.__audio = new AudioAnalyzer();
            // Fires on every add / remove / auto-end — keep mixer + indicator in sync
            window.__audio.onSourcesChanged = () => {
                renderMixer();
                reflectActiveSource();
                if (window.__audio.sources.length === 0) {
                    showOverlay();   // re-enables source buttons AND clears the hint…
                    setHint(t('All sources removed. Add one to begin.'));  // …so set it after
                }
            };
        }
        return window.__audio;
    }

    // Set true once pickSource has surfaced a specific failure reason, so the
    // 3s safety-net timer below won't clobber it with a generic message.
    let micErrorShown = false;

    // fromGesture: false only for the page-load auto-start. Every button /
    // picker path is a real user activation, so a NotAllowedError there
    // means genuinely blocked — not "just needs a tap".
    async function pickSource (kind, file, deviceId, fromGesture = true) {
        micErrorShown = false;
        srcBtns.forEach(b => b.disabled = true);
        setHint(t('Requesting…'));
        const audio = getAnalyzer();
        try {
            if (kind === 'mic') {
                await audio.addMicrophone(deviceId);
            } else if (kind === 'display') {
                await audio.addDisplay();
            } else if (kind === 'file') {
                await audio.addFile(file);
            }
            overlay.classList.add('hidden');
            renderMixer();
            reflectActiveSource();
            setHint('');
        } catch (err) {
            console.error('Source error:', err);
            // A precise reason is about to be shown — stop the 3s safety net
            // from clobbering it with the generic "didn't start" message.
            micErrorShown = true;
            const msg = err && err.message;
            const name = err && err.name;

            // Resolve a message that fits the KIND being added — pickSource is
            // shared across mic / system / file, so e.g. a cancelled screen
            // share must not show microphone-permission wording.
            let text;
            if (msg === 'INSECURE_CONTEXT') {
                text = t('Microphone needs HTTPS or localhost. This page is on neither, so the browser blocks it. Open the HTTPS link or run a local server.');
            } else if (msg === 'NO_MEDIA_DEVICES') {
                text = t('This browser blocks microphone access. If you opened the link inside an app (WeChat, etc.), tap ⋯ and "Open in browser" — use Chrome, Edge or Safari.');
            } else if (msg === 'UNSUPPORTED') {
                text = t('This browser does not support tab / system audio capture.');
            } else if (msg === 'NO_AUDIO_TRACK') {
                // macOS can only deliver audio from TAB shares; picking a
                // window (or screen, on other browsers) silently drops audio.
                text = isMacPlatform()
                    ? t('No audio in that share. On a Mac, choose a browser TAB (not a window or the screen) and tick "Also share tab audio".')
                    : t('No audio captured. Check "Share audio" when picking the source.');
            } else if (name === 'NotAllowedError' || name === 'SecurityError') {
                if (kind === 'display') {
                    text = t('Screen / tab share was cancelled or denied. Click + System again and remember to tick "Share audio".');
                } else if (kind === 'file') {
                    text = t('Couldn’t play that file. Tap + File and pick an audio file again.');
                } else {
                    // mic: truly blocked vs just needs a user gesture.
                    // Chrome & co expose the Permissions API; Safari rejects
                    // the 'microphone' query entirely, so there fall back on
                    // fromGesture — a denial DURING a real user tap can only
                    // mean the permission is actually blocked, and showing
                    // "tap to start" again would loop the user forever.
                    let permState = null;
                    try {
                        if (navigator.permissions && navigator.permissions.query) {
                            permState = (await navigator.permissions.query({ name: 'microphone' })).state;
                        }
                    } catch (_) { /* Safari etc. may reject the 'microphone' name */ }
                    const blocked = permState === 'denied' || (permState === null && fromGesture);
                    text = blocked
                        ? t('Microphone access is blocked for this site. Chrome/Edge: click the 🔒 icon in the address bar and allow Microphone. Safari: menu Safari → Settings → Websites → Microphone → Allow; also check macOS System Settings → Privacy & Security → Microphone. Then reload.')
                        : t('Tap the Microphone button below to start — the browser only turns the mic on after you tap.');
                }
            } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
                text = t('No microphone found. Connect one and click Microphone to retry.');
            } else if (name === 'NotReadableError' || name === 'TrackStartError') {
                text = t('The microphone is in use by another app. Close it and click Microphone to retry.');
            } else if (name === 'OverconstrainedError') {
                text = t('That device is no longer available. Pick another.');
            } else if (name === 'NotSupportedError') {
                text = kind === 'file'
                    ? t('That audio file format isn’t supported. Try MP3, WAV or OGG.')
                    : t('This browser can’t capture live mic / system audio (common in embedded preview browsers). Add an audio File instead, or open the page in Chrome / Edge / Safari.');
            } else {
                text = t('Failed to start source. See console for details.');
            }

            // Route it: if other sources are already running, keep them and show
            // the error inline in the mixer; only the zero-source case takes over
            // the full start overlay.
            if (audio.sources.length > 0) {
                renderMixer();
                const sec = document.getElementById('mixer-section');
                if (sec) {
                    const e = document.createElement('div');
                    e.className = 'mixer-error';
                    e.textContent = text;
                    const addRow = sec.querySelector('.mixer-add');
                    if (addRow && addRow.nextSibling) sec.insertBefore(e, addRow.nextSibling);
                    else sec.appendChild(e);
                }
            } else {
                overlay.classList.remove('hidden');
                srcBtns.forEach(b => { if (!b.dataset.permaDisabled) b.disabled = false; });
                setHint(text, true);
                if (name === 'OverconstrainedError') showDevicePickerView();
            }
        }
    }

    srcBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const kind = btn.dataset.source;
            if (kind === 'file') {
                fileInput.click();
            } else if (kind === 'mic') {
                // Temporarily skip device picker — go straight to default mic.
                // To re-enable: call `showDevicePickerView()` instead.
                pickSource('mic');
            } else {
                pickSource(kind);
            }
        });
    });
    deviceBackBtn.addEventListener('click', showSourceButtons);
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
            pickSource('file', fileInput.files[0]);
            fileInput.value = '';
        }
    });

    // Expose for the Panel buttons
    window.__showSourceOverlay = showOverlay;
    window.__showDevicePicker = () => {
        overlay.classList.remove('hidden');
        showDevicePickerView();
    };

    document.querySelectorAll('.modes button').forEach(btn => {
        btn.addEventListener('click', () => applyPreset(btn.dataset.mode));
    });

    // Filter tab bar — keeps tabs + panel select in sync via filterState
    document.querySelectorAll('.filters button').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.filter;
            filterState.name = name;
            if (isGlassFilter(name)) loadGlassPreset(name);
            applyFilter();
            refreshPanel();
        });
    });
    applyFilter();

    // Material tab bar — same contract as the filter tabs, state lives in config.MATERIAL
    document.querySelectorAll('.materials button').forEach(btn => {
        btn.addEventListener('click', () => {
            config.MATERIAL = btn.dataset.material;
            applyMaterial();
            refreshPanel();
        });
    });
    applyMaterial();

    // Auto-start the default microphone on page load — no source-picker
    // overlay. The browser shows its native permission prompt the first
    // time; returning users with permission granted just go straight in.
    // pickSource() re-shows the overlay only if mic start fails.
    renderMixer();   // show the SOURCES panel section up-front (even before/if mic starts)

    // Safari — iOS, iPadOS AND macOS — blocks getUserMedia outside a user
    // gesture, so auto-start always fails there (and on the Mac it left
    // users looping between a doomed auto-attempt and the start overlay).
    // Skip auto-start on all Safari and let the user tap Microphone — that
    // tap is the gesture WebKit needs.
    if (isIOS() || isSafari()) {
        overlay.classList.remove('hidden');
        setHint(t('Tap the Microphone button below to start — the browser only turns the mic on after you tap.'));
    } else {
        pickSource('mic', null, null, false);

        // Safety net: if the mic hasn't started within 3s (browser silently
        // blocked the prompt, or HTTPS not available, or user dismissed it),
        // surface the overlay so they can click Microphone to retry manually.
        setTimeout(() => {
            const audio = window.__audio;
            if (audio && audio.ready) return;   // mic is running — nothing to do
            if (micErrorShown) return;          // a precise reason is already shown — don't clobber it
            // Genuinely still pending: prompt left open/ignored, or silently stuck.
            overlay.classList.remove('hidden');
            setHint(t("Microphone didn't start. Click Microphone to retry, or check that the site is on HTTPS and microphone access is allowed."));
        }, 3000);
    }

    // Optional debug HUD — press D to toggle
    const debugEl = document.getElementById('debug');
    function drawDebug () {
        if (window.__audio && window.__audio.ready && debugEl.classList.contains('visible')) {
            const a = window.__audio;
            const bars = a.smoothedBands.map((v, i) => {
                const n = Math.round(v * 30);
                return `${i}: ${'█'.repeat(n).padEnd(30, '·')} ${v.toFixed(2)}`;
            }).join('\n');
            debugEl.textContent =
                `vol=${a.smoothedVolume.toFixed(3)}  onset=${a.onset ? 'YES' : '   '}\n${bars}`;
        }
        requestAnimationFrame(drawDebug);
    }
    drawDebug();
});

// Splice audio.tick() into the existing update loop without
// touching the loop itself: wrap `applyInputs` once at load.
const __origApplyInputs = applyInputs;
applyInputs = function () {
    if (window.__audio) window.__audio.tick();
    __origApplyInputs();
};
