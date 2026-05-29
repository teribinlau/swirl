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
    return /Mobi|Android/i.test(navigator.userAgent);
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
const advectionProgram       = new Program(baseVertexShader, advectionShader);
const divergenceProgram      = new Program(baseVertexShader, divergenceShader);
const curlProgram            = new Program(baseVertexShader, curlShader);
const vorticityProgram       = new Program(baseVertexShader, vorticityShader);
const pressureProgram        = new Program(baseVertexShader, pressureShader);
const gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);

const displayMaterial = new Material(baseVertexShader, displayShaderSource);

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
update();

function update () {
    const dt = calcDeltaTime();
    if (resizeCanvas())
        initFramebuffers();
    updateColors(dt);
    applyInputs();
    if (!config.PAUSED)
        step(dt);
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

function updateColors (dt) {
    // Pointer-based colorful rotation removed; colors are now driven
    // per-splat by the audio frequency band hue mapping.
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
    if (config.BLOOM)
        applyBloom(dye.read, bloom);
    if (config.SUNRAYS) {
        applySunrays(dye.read, dye.write, sunrays);
        blur(sunrays, sunraysTemp, 1);
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
    drawDisplay(target);
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
        this.fluxHistory = [];   // rolling window of recent flux values
        this.fluxHistoryMax = 43; // ~700ms at 60fps
        this.lastOnsetTime = 0;
        this.binToHz = 0;
        this.bandBinRanges = []; // [{lo, hi}] for each band

        // Active source state
        this.currentSourceNode = null;   // AudioNode currently feeding analyser
        this.currentStream = null;       // MediaStream for mic/display
        this.currentMediaEl = null;      // HTMLAudioElement for file/URL
        this.sourceLabel = '';           // 'MIC' / 'TAB' / 'FILE' / etc.
        this.onSourceEnded = null;       // callback for stream-ended events
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

    _teardownCurrentSource () {
        if (this.currentSourceNode) {
            try { this.currentSourceNode.disconnect(); } catch (e) {}
            this.currentSourceNode = null;
        }
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(t => t.stop());
            this.currentStream = null;
        }
        if (this.currentMediaEl) {
            this.currentMediaEl.pause();
            try { URL.revokeObjectURL(this.currentMediaEl.src); } catch (e) {}
            this.currentMediaEl = null;
        }
        // Reset transient state so the visual doesn't jump
        this.fluxHistory.length = 0;
        if (this.prevSpectrum) this.prevSpectrum.fill(0);
    }

    _attachSource (sourceNode, label) {
        sourceNode.connect(this.analyser);
        this.currentSourceNode = sourceNode;
        this.sourceLabel = label;
        this.ready = true;
    }

    async startFromMicrophone (deviceId) {
        await this._ensureContext();
        const audioConstraints = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        };
        if (deviceId) audioConstraints.deviceId = { exact: deviceId };
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        this._teardownCurrentSource();
        this._initAnalyserOnce();
        this.currentStream = stream;
        this.currentDeviceId = deviceId || (stream.getAudioTracks()[0].getSettings().deviceId);
        const source = this.ctx.createMediaStreamSource(stream);
        stream.getAudioTracks().forEach(t => {
            t.onended = () => { this.ready = false; if (this.onSourceEnded) this.onSourceEnded('mic'); };
        });
        // Pick a friendlier label from the device's actual name if available
        const trackLabel = stream.getAudioTracks()[0].label;
        const label = trackLabel ? trackLabel.toUpperCase().slice(0, 24) : 'MIC';
        this._attachSource(source, label);
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

    async startFromDisplay () {
        if (!navigator.mediaDevices.getDisplayMedia) {
            throw new Error('UNSUPPORTED');
        }
        await this._ensureContext();
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,            // required by spec even though we only want audio
            audio: true,
        });
        // Drop video tracks immediately to save GPU/network
        stream.getVideoTracks().forEach(t => t.stop());
        if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach(t => t.stop());
            throw new Error('NO_AUDIO_TRACK');
        }
        this._teardownCurrentSource();
        this._initAnalyserOnce();
        this.currentStream = stream;
        const source = this.ctx.createMediaStreamSource(stream);
        stream.getAudioTracks().forEach(t => {
            t.onended = () => { this.ready = false; if (this.onSourceEnded) this.onSourceEnded('display'); };
        });
        this._attachSource(source, 'TAB');
    }

    async startFromFile (file) {
        await this._ensureContext();
        const url = URL.createObjectURL(file);
        const audioEl = new Audio();
        audioEl.src = url;
        audioEl.loop = true;
        audioEl.crossOrigin = 'anonymous';
        const source = this.ctx.createMediaElementSource(audioEl);
        // Route to both analyser AND speakers — MediaElementSource hijacks default routing
        source.connect(this.ctx.destination);
        await audioEl.play();
        this._teardownCurrentSource();
        this._initAnalyserOnce();
        this.currentMediaEl = audioEl;
        audioEl.addEventListener('ended', () => {
            if (this.onSourceEnded) this.onSourceEnded('file');
        });
        this._attachSource(source, 'FILE: ' + (file.name || 'audio'));
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
};

let currentTrajectory = 'RANDOM';

// ============================================================
// FILTER (post-processing layer over the canvas)
// Two flavours of effect:
//   1. CSS filters (FROST/DREAM/GRAIN/VIGNETTE/HALFTONE) — handled by
//      .filter-overlay div + backdrop-filter / mix-blend-mode.
//   2. SVG glass-displacement filters (REEDED/RIPPLE/PEBBLED/DIAMOND/MOLTEN)
//      — applied to the canvas via `filter: url(#…)`. JS patches each
//      filter's <feTurbulence> + <feDisplacementMap> + <feGaussianBlur>
//      attributes live, so the panel can mutate every variable.
// ============================================================
const filterState = {
    name: 'NONE',
    intensity: 50,
    // Per-glass parameters — reloaded from preset whenever the glass mode changes
    freqX: 0.02,
    freqY: 0.0005,
    octaves: 2,
    seed: 2,
    blur: 0,
};

// Each glass preset bundles default values for every variable.
// baseScale = feDisplacementMap.scale at intensity=50.
const SVG_FILTERS = {
    REEDED:  { id: 'reeded-glass',  turbId: 'reeded-turb',  dispId: 'reeded-disp',  blurId: 'reeded-blur',
               type: 'turbulence',   baseScale: 70,  freqX: 0.020,  freqY: 0.0005, octaves: 2, seed: 2,  blur: 0 },
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
        if (disp) disp.setAttribute('scale', String(def.baseScale * filterState.intensity / 50));
        if (blur) blur.setAttribute('stdDeviation', String(filterState.blur));
    } else {
        canvas.style.filter = '';
    }

    document.querySelectorAll('.filters button').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filterState.name);
    });
}

function applyAudioInputs (audio) {
    const t = performance.now() * 0.001; // seconds
    const traj = TRAJECTORY[currentTrajectory] || TRAJECTORY.RANDOM;

    // Loud-passage compression: pull per-splat brightness down as volume rises.
    // At volume=1 with COMPRESS=0.6 → colors are scaled by 1/(1+0.6) ≈ 0.625
    const compress = 1 / (1 + audio.smoothedVolume * AUDIO.VOLUME_COMPRESS);
    const effectiveGain = AUDIO.COLOR_GAIN * compress;

    // Per-trajectory tweaks for discrete-event modes (AQUA, BLINK).
    const isAqua = currentTrajectory === 'AQUA';
    const isBlink = currentTrajectory === 'BLINK';
    const origRadius = config.SPLAT_RADIUS;

    for (let i = 0; i < NUM_BANDS; i++) {
        const energy = audio.smoothedBands[i];
        if (energy < AUDIO.BAND_THRESHOLD) continue;

        const e = Math.pow(energy, AUDIO.ENERGY_CURVE);

        // Stochastic gate so AQUA bubbles / BLINK rings are discrete events,
        // not a 360-splats-per-second continuous stream.
        if (isAqua && Math.random() > e * 0.10) continue;
        if (isBlink && Math.random() > e * 0.18) continue;

        const pt = traj(i, t);

        // AQUA: gentle rising bubbles (not jets). BLINK: tiny impact pulses.
        const forceMult = isAqua ? 0.35 : isBlink ? 0.20 : 1.0;
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
            // True ring ripple: N splats arranged in a circle around the impact
            // point, each pushing radially OUTWARD. This is what creates the
            // visible concentric expanding ring instead of a single splotch.
            const RING_COUNT = 8;
            const ringRadius = 0.022 + e * 0.028 + audio.smoothedVolume * 0.02;
            // Per-ring-point splat is small so dots merge into a ring rather
            // than appearing as 8 discrete blobs.
            config.SPLAT_RADIUS = origRadius * (0.45 + e * 0.35);
            // Ring force is independent of trajectory dx/dy — purely radial.
            const ringForce = e * AUDIO.SPLAT_FORCE * 0.28 * (0.5 + audio.smoothedVolume * AUDIO.VOLUME_GAIN);
            const phase = Math.random() * Math.PI * 2;   // rotate ring randomly each drop
            for (let k = 0; k < RING_COUNT; k++) {
                const a = phase + (k / RING_COUNT) * Math.PI * 2;
                const ca = Math.cos(a), sa = Math.sin(a);
                splat(pt.x + ca * ringRadius, pt.y + sa * ringRadius,
                      ca * ringForce, sa * ringForce, color);
            }
            continue;
        }
        splat(pt.x, pt.y, dx, dy, color);
    }

    if (isAqua || isBlink) config.SPLAT_RADIUS = origRadius;

    if (audio.onset) {
        const burst = Math.max(1, Math.floor(AUDIO.ONSET_BURST_BASE + audio.smoothedVolume * AUDIO.ONSET_BURST_GAIN));
        audioBurst(burst, audio, effectiveGain);
    }
}

// Replacement for Pavel's multipleSplats() — same idea (random scatter) but
// brightness goes through softColor instead of the ×10 multiplier that
// blows out the screen on loud beats.
function audioBurst (amount, audio, gain) {
    const isAqua = currentTrajectory === 'AQUA';
    const isBlink = currentTrajectory === 'BLINK';
    const origRadius = config.SPLAT_RADIUS;
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
            // Burst raindrop = a single, larger ring ripple at a random spot
            const cx = Math.random(), cy = Math.random();
            const RING_COUNT = 10;
            const ringRadius = 0.035 + audio.smoothedVolume * 0.025;
            config.SPLAT_RADIUS = origRadius * 0.55;
            const ringForce = f * 0.25;
            const phase = Math.random() * Math.PI * 2;
            for (let k = 0; k < RING_COUNT; k++) {
                const a = phase + (k / RING_COUNT) * Math.PI * 2;
                const ca = Math.cos(a), sa = Math.sin(a);
                splat(cx + ca * ringRadius, cy + sa * ringRadius,
                      ca * ringForce, sa * ringForce, color);
            }
            continue;
        }
        // Default: random scatter in random direction
        const ang = Math.random() * Math.PI * 2;
        splat(Math.random(), Math.random(), Math.cos(ang) * f, Math.sin(ang) * f, color);
    }
    if (isBlink) config.SPLAT_RADIUS = origRadius;
}

// ============================================================
// PRESETS — match SWIRL's DEFAULT / SMOKE / INK / RAINBOW vibes
// Each preset patches `config` then forces shader keyword rebuild.
// ============================================================

const PRESETS = {
    DEFAULT: {
        DENSITY_DISSIPATION: 1.0,
        VELOCITY_DISSIPATION: 0.2,
        PRESSURE: 0.8,
        CURL: 30,
        SPLAT_RADIUS: 0.25,
        BLOOM: true,
        BLOOM_INTENSITY: 0.8,
        BLOOM_THRESHOLD: 0.6,
        SUNRAYS: true,
        SUNRAYS_WEIGHT: 1.0,
        SHADING: true,
    },
    SMOKE: {
        DENSITY_DISSIPATION: 0.4,
        VELOCITY_DISSIPATION: 0.6,
        PRESSURE: 0.6,
        CURL: 12,
        SPLAT_RADIUS: 0.45,
        BLOOM: true,
        BLOOM_INTENSITY: 0.5,
        BLOOM_THRESHOLD: 0.7,
        SUNRAYS: false,
        SUNRAYS_WEIGHT: 0.4,
        SHADING: true,
    },
    INK: {
        DENSITY_DISSIPATION: 2.2,
        VELOCITY_DISSIPATION: 0.05,
        PRESSURE: 0.95,
        CURL: 45,
        SPLAT_RADIUS: 0.18,
        BLOOM: false,
        BLOOM_INTENSITY: 0.4,
        BLOOM_THRESHOLD: 0.6,
        SUNRAYS: false,
        SUNRAYS_WEIGHT: 0.6,
        SHADING: true,
    },
    RAINBOW: {
        DENSITY_DISSIPATION: 0.8,
        VELOCITY_DISSIPATION: 0.15,
        PRESSURE: 0.8,
        CURL: 40,
        SPLAT_RADIUS: 0.30,
        BLOOM: true,
        BLOOM_INTENSITY: 1.4,
        BLOOM_THRESHOLD: 0.45,
        SUNRAYS: true,
        SUNRAYS_WEIGHT: 1.0,
        SHADING: true,
    },
    AQUA: {
        _trajectory: 'AQUA',           // behavioural preset — forces rising-bubble trajectory
        _palette: { mode: 'SINGLE', singleHue: 0.5, singleRange: 0.30 },  // default aqua palette
        DENSITY_DISSIPATION: 1.6,      // bubbles fade before reaching the top, but not too fast
        VELOCITY_DISSIPATION: 0.5,     // moderate damping — bubbles slow as they rise
        PRESSURE: 0.8,
        CURL: 22,                      // strong curl gives each bubble internal swirl (jellyfish-ish)
        SPLAT_RADIUS: 0.28,            // medium bubble size
        BLOOM: true,
        BLOOM_INTENSITY: 0.55,
        BLOOM_THRESHOLD: 0.55,
        SUNRAYS: false,                // sunrays scramble the up-direction
        SUNRAYS_WEIGHT: 0.6,
        SHADING: true,
    },
    BLINK: {
        _trajectory: 'BLINK',           // behavioural preset — concentric ring blinks at random points
        _palette: { mode: 'MONO' },    // greyscale rings on dark surface (override per palette panel)
        DENSITY_DISSIPATION: 1.4,      // ripple ink fades after the ring expands
        VELOCITY_DISSIPATION: 0.7,     // low damping — let the ring keep expanding outward
        PRESSURE: 0.85,                // mid — incompressible water-surface feel
        CURL: 5,                       // very low — clean radial expansion, no swirl
        SPLAT_RADIUS: 0.10,            // base; ring uses ~45% of this per point
        BLOOM: true,
        BLOOM_INTENSITY: 0.55,
        BLOOM_THRESHOLD: 0.55,
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
        'Default': '默认',
        'Smoke': '烟雾',
        'Ink': '墨色',
        'Rainbow': '彩虹',
        'Aqua': '水母',
        'Blink': '涟漪',
        'None': '无',
        'Frost': '磨砂',
        'Dream': '梦境',
        'Grain': '颗粒',
        'Vignette': '暗角',
        'Halftone': '半调',
        'Reeded': '凹槽',
        'Ripple': '波纹',
        'Pebbled': '鹅卵石',
        'Diamond': '菱形',
        'Molten': '熔融',

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
        'Loading devices…': '加载设备中…',
        'Microphone permission denied — needed to list devices.': '麦克风权限被拒绝 — 列出设备需要权限。',
        'Could not list audio devices.': '无法列出音频设备。',
        'No audio inputs found.': '未找到音频输入设备。',
        'Source ended ({kind}). Pick another one.': '音频源已结束({kind})。请选择其他源。',
        'Requesting…': '请求中…',
        'This browser does not support tab / system audio capture.': '此浏览器不支持标签 / 系统音频捕获。',
        'No audio captured. Check "Share audio" when picking the source.': '未捕获到音频。选择源时请勾选"共享音频"。',
        'Permission denied. Allow access in your browser and try again.': '权限被拒绝。请在浏览器中允许访问后重试。',
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
        'REEDED': '凹槽',
        'RIPPLE': '波纹',
        'PEBBLED': '鹅卵石',
        'DIAMOND': '菱形',
        'MOLTEN': '熔融',
        'Filter intensity': '滤镜强度',

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
        'AQUA': '水母',
        'BLINK': '涟漪',
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
        'Saved ✓': '已保存 ✓',
        'Copied ✓': '已复制 ✓',
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

        'How splat colors are picked. FULL = each band uses its anchor hue, splats span the rainbow. SINGLE = every splat picks a hue around Base hue with ±Hue range jitter. MONO = saturation forced to 0, only brightness varies — black/white/grey.':
            '喷溅颜色的选择方式。全彩 = 每个频段使用各自的色相,跨越彩虹。单色 = 每次喷溅围绕基础色相在 ±色相范围内浮动。黑白 = 饱和度强制为 0,只有亮度变化。',
        'SINGLE mode only. 0 = red, 0.17 = yellow, 0.33 = green, 0.5 = cyan, 0.67 = blue, 0.83 = magenta. Loops back to red at 1.':
            '仅单色模式。0 = 红,0.17 = 黄,0.33 = 绿,0.5 = 青,0.67 = 蓝,0.83 = 品红。1 时回到红色。',
        'SINGLE mode only. ±jitter around Base hue. 0 = strict single color. 0.3+ = wide spectrum within one family. 0.5 = nearly full rainbow.':
            '仅单色模式。围绕基础色相的 ±抖动范围。0 = 严格单色,0.3+ = 同色系宽频谱,0.5 = 接近全彩虹。',

        'Post-processing over the fluid. CSS layer: FROST/DREAM (blur), GRAIN/HALFTONE (texture overlay), VIGNETTE (dark corners). SVG glass displacement: REEDED (vertical fluted), RIPPLE (water), PEBBLED (small cobbles), DIAMOND (lattice/patterned), MOLTEN (large organic).':
            '流体之上的后期处理。CSS 层:磨砂/梦境(模糊)、颗粒/半调(纹理叠加)、暗角(边缘变暗)。SVG 玻璃位移:凹槽(垂直凹槽)、波纹(水)、鹅卵石(小石子)、菱形(格子/图案)、熔融(大型有机)。',
        'Strength of the active filter. FROST/DREAM: blur radius. GRAIN/HALFTONE: opacity. VIGNETTE: darkness. Glass modes: pixel-displacement scale (the main "depth" knob). Has no effect when filter is NONE.':
            '当前滤镜的强度。磨砂/梦境:模糊半径。颗粒/半调:不透明度。暗角:暗度。玻璃类:像素位移幅度(主要的"深度"调节)。滤镜为"无"时不起作用。',

        'Horizontal noise frequency for the glass texture. LOW (0.001) = wide bands, HIGH (0.1) = tight stripes. For vertical REEDED look, keep this 5–50× higher than Frequency Y.':
            '玻璃纹理的水平噪声频率。低 (0.001) = 宽条带,高 (0.1) = 紧密条纹。要做垂直凹槽效果,保持此值比 Y 频率高 5-50 倍。',
        'Vertical noise frequency. Mirror of Frequency X. For pure vertical reeded glass, drop this near 0; for round pebble patterns, match Frequency X.':
            '垂直噪声频率。X 频率的镜像。纯垂直凹槽玻璃将此值降到接近 0;圆形鹅卵石图案则与 X 频率匹配。',
        'How many noise octaves are layered. 1 = clean cellular pattern (good for DIAMOND), 3+ = increasingly organic / chaotic (good for RIPPLE).':
            '叠加的噪声层数。1 = 干净的细胞图案(适合菱形),3+ = 越来越有机 / 混乱(适合波纹)。',
        'Noise random seed. Drag to scrub through different texture variations of the same style. The pattern changes shape but keeps the same overall feel.':
            '噪声随机种子。拖动以浏览同一风格的不同纹理变体。图案形状会变化但整体感觉保持一致。',
        'Extra Gaussian blur layered on top of the displaced canvas. 0 = sharp glass, 2+ = thick frosted look. Mostly used by MOLTEN; great companion to all glass modes.':
            '叠加在位移后画面之上的额外高斯模糊。0 = 锐利玻璃,2+ = 厚磨砂感。主要用于熔融效果,也适合所有玻璃模式。',

        'Path that splats follow. RANDOM = stationary anchors. LISSAJOUS = woven closed curves. ORBIT = concentric rings. SINE_WAVE = horizontal lanes. AQUA = bubbles rise from bottom. BLINK = concentric ring ripples at random points across the surface.':
            '喷溅遵循的路径。随机 = 固定锚点。利萨如 = 编织闭合曲线。轨道 = 同心环。正弦波 = 水平轨道。水母 = 气泡从底部上升。涟漪 = 在画面随机点的同心环涟漪。',
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
        'Minimum gap between consecutive onsets. Raise to prevent machine-gun bursts on busy music.':
            '相邻起音之间的最小间隔。调高以防止繁忙音乐中连发爆炸。',
        'Baseline number of splats per onset, regardless of volume.':
            '每次起音的基础喷溅数,与音量无关。',
        'Extra splats per onset added by volume. Big rooms get fat bursts; quiet onsets stay light.':
            '每次起音根据音量额外增加的喷溅数。大场景获得厚重爆发,安静起音保持轻盈。',

        'Freeze the simulation. Splats keep being injected but motion stops. Shortcut: P key.':
            '冻结模拟。喷溅继续注入但运动停止。快捷键:P。',
        'Manually fire a multi-splat burst. Useful when testing visuals without audio. Shortcut: Space.':
            '手动触发多重喷溅爆发。无音频测试视觉时有用。快捷键:空格。',
        'Restore all Simulation + Effects values to the current preset (DEFAULT / SMOKE / INK / RAINBOW). Audio knobs are not touched.':
            '将所有模拟 + 视觉效果值恢复到当前预设(默认 / 烟雾 / 墨色 / 彩虹)。音频调节不变。',
        'Persist every current panel value (fluid + audio + trajectory + filter + glass) to this browser. Next page load will start from this snapshot instead of the factory DEFAULT.':
            '将当前面板所有值(流体 + 音频 + 轨迹 + 滤镜 + 玻璃)持久化到此浏览器。下次加载将从此快照开始,而非出厂默认。',
        'Clear the saved snapshot from this browser and reload. Page will come back up with the factory DEFAULT preset.':
            '清除此浏览器中保存的快照并重新加载。页面将以出厂默认预设重新启动。',
        'Copy the current panel state to your clipboard as a JSON object. Use this to share a configuration or paste into source code as a new factory default.':
            '将当前面板状态作为 JSON 对象复制到剪贴板。用于分享配置或作为新出厂默认粘贴到源代码。',
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
              options: ['NONE', 'FROST', 'DREAM', 'GRAIN', 'VIGNETTE', 'HALFTONE', 'REEDED', 'RIPPLE', 'PEBBLED', 'DIAMOND', 'MOLTEN'],
              tip: 'Post-processing over the fluid. CSS layer: FROST/DREAM (blur), GRAIN/HALFTONE (texture overlay), VIGNETTE (dark corners). SVG glass displacement: REEDED (vertical fluted), RIPPLE (water), PEBBLED (small cobbles), DIAMOND (lattice/patterned), MOLTEN (large organic).',
              get: () => filterState.name,
              set: v => {
                  filterState.name = v;
                  if (isGlassFilter(v)) loadGlassPreset(v);
                  applyFilter();
                  refreshPanel();
              } },
            { type: 'range', label: 'Filter intensity', min: 0, max: 100, step: 1,
              tip: 'Strength of the active filter. FROST/DREAM: blur radius. GRAIN/HALFTONE: opacity. VIGNETTE: darkness. Glass modes: pixel-displacement scale (the main "depth" knob). Has no effect when filter is NONE.',
              get: () => filterState.intensity, set: v => { filterState.intensity = +v; applyFilter(); } },
        ],
    },
    {
        title: 'Glass displacement',
        items: [
            { type: 'range', label: 'Frequency X', min: 0.0005, max: 0.2, step: 0.0005,
              tip: 'Horizontal noise frequency for the glass texture. LOW (0.001) = wide bands, HIGH (0.1) = tight stripes. For vertical REEDED look, keep this 5–50× higher than Frequency Y.',
              get: () => filterState.freqX, set: v => { filterState.freqX = +v; applyFilter(); } },
            { type: 'range', label: 'Frequency Y', min: 0.0001, max: 0.2, step: 0.0005,
              tip: 'Vertical noise frequency. Mirror of Frequency X. For pure vertical reeded glass, drop this near 0; for round pebble patterns, match Frequency X.',
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
              options: ['RANDOM', 'LISSAJOUS', 'ORBIT', 'SINE_WAVE', 'AQUA', 'BLINK'],
              tip: 'Path that splats follow. RANDOM = stationary anchors. LISSAJOUS = woven closed curves. ORBIT = concentric rings. SINE_WAVE = horizontal lanes. AQUA = bubbles rise from bottom. BLINK = concentric ring ripples at random points across the surface.',
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
              tip: 'Minimum gap between consecutive onsets. Raise to prevent machine-gun bursts on busy music.',
              get: () => AUDIO.ONSET_COOLDOWN_MS, set: v => AUDIO.ONSET_COOLDOWN_MS = +v },
            { type: 'range',  label: 'Burst base',     min: 0,  max: 20,  step: 1,
              tip: 'Baseline number of splats per onset, regardless of volume.',
              get: () => AUDIO.ONSET_BURST_BASE, set: v => AUDIO.ONSET_BURST_BASE = +v },
            { type: 'range',  label: 'Burst gain',     min: 0,  max: 30,  step: 0.5,
              tip: 'Extra splats per onset added by volume. Big rooms get fat bursts; quiet onsets stay light.',
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
              tip: 'Restore all Simulation + Effects values to the current preset (DEFAULT / SMOKE / INK / RAINBOW). Audio knobs are not touched.',
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
              tip: 'Clear the saved snapshot from this browser and reload. Page will come back up with the factory DEFAULT preset.',
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
    // Only remove schema-built sections; leave the close button alone
    panel.querySelectorAll('section').forEach(s => s.remove());
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

function loadSettingsFromStorage () {
    try {
        const raw = localStorage.getItem(SWIRL_STORAGE_KEY);
        if (!raw) return false;
        const s = JSON.parse(raw);
        if (s.config)        Object.assign(config, s.config);
        if (s.AUDIO)         Object.assign(AUDIO, s.AUDIO);
        if (s.PALETTE)       Object.assign(PALETTE, s.PALETTE);
        if (s.filterState)   Object.assign(filterState, s.filterState);
        if (typeof s.currentTrajectory === 'string')  currentTrajectory  = s.currentTrajectory === 'RAIN' ? 'BLINK' : s.currentTrajectory;
        if (typeof s.currentPresetName === 'string')  currentPresetName  = s.currentPresetName === 'RAIN' ? 'BLINK' : s.currentPresetName;
        return true;
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

    // Disable unsupported source buttons up-front
    const displayBtn = document.querySelector('.src-btn[data-source="display"]');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        displayBtn.disabled = true;
        // Tag with i18n key so applyLanguage() can re-render on toggle
        const hintEl = displayBtn.querySelector('.src-hint');
        hintEl.dataset.i18n = 'Not supported in this browser — try Chrome or Edge';
        hintEl.textContent = t('Not supported in this browser — try Chrome or Edge');
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

    function reflectActiveSource (label) {
        if (label) {
            micDot.classList.add('active');
            micLabel.removeAttribute('data-off');
            micLabel.textContent = label;
        } else {
            micDot.classList.remove('active');
            // data-off marker lets applyLanguage() re-translate this on toggle
            micLabel.setAttribute('data-off', '');
            micLabel.textContent = t('OFF');
        }
    }

    // Lazy singleton — created on first source selection, reused across switches
    function getAnalyzer () {
        if (!window.__audio) {
            window.__audio = new AudioAnalyzer();
            window.__audio.onSourceEnded = (kind) => {
                reflectActiveSource(null);
                setHint(t('Source ended ({kind}). Pick another one.', { kind }));
                showOverlay();
            };
        }
        return window.__audio;
    }

    async function pickSource (kind, file, deviceId) {
        srcBtns.forEach(b => b.disabled = true);
        setHint(t('Requesting…'));
        const audio = getAnalyzer();
        try {
            if (kind === 'mic') {
                await audio.startFromMicrophone(deviceId);
            } else if (kind === 'display') {
                await audio.startFromDisplay();
            } else if (kind === 'file') {
                await audio.startFromFile(file);
            }
            overlay.classList.add('hidden');
            reflectActiveSource(audio.sourceLabel);
            setHint('');
        } catch (err) {
            console.error('Source error:', err);
            // Auto-mic on page load starts with overlay hidden; surface it so
            // the user can see the failure and act on it.
            overlay.classList.remove('hidden');
            srcBtns.forEach(b => { if (!b.dataset.permaDisabled) b.disabled = false; });
            const msg = err && err.message;
            if (msg === 'UNSUPPORTED') {
                setHint(t('This browser does not support tab / system audio capture.'), true);
            } else if (msg === 'NO_AUDIO_TRACK') {
                setHint(t('No audio captured. Check "Share audio" when picking the source.'), true);
            } else if (err && err.name === 'NotAllowedError') {
                setHint(t('Permission denied. Allow access in your browser and try again.'), true);
            } else if (err && err.name === 'OverconstrainedError') {
                setHint(t('That device is no longer available. Pick another.'), true);
                showDevicePickerView();
            } else {
                setHint(t('Failed to start source. See console for details.'), true);
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

    // Auto-start the default microphone on page load — no source-picker
    // overlay. The browser shows its native permission prompt the first
    // time; returning users with permission granted just go straight in.
    // pickSource() re-shows the overlay only if mic start fails.
    pickSource('mic');

    // Safety net: if the mic hasn't started within 3s (browser silently
    // blocked the prompt, or HTTPS not available, or user dismissed it),
    // surface the overlay so they can click Microphone to retry manually.
    setTimeout(() => {
        const audio = window.__audio;
        if (!audio || !audio.ready) {
            overlay.classList.remove('hidden');
            setHint(t("Microphone didn't start. Click Microphone to retry, or check that the site is on HTTPS and microphone access is allowed."));
        }
    }, 3000);

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
