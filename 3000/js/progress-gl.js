function createSeekRenderer(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) {
        return {
            render: () => {}
        };
    }

    function getThemeRgb(name, fallback) {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
        const parts = raw.split(',').map(part => {
            const value = Number.parseFloat(part.trim());
            return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) / 255 : 0;
        });
        return parts.length === 3 ? parts : fallback.split(',').map(part => Number.parseFloat(part.trim()) / 255);
    }

    const theme = {
        surface: getThemeRgb('--club-blue-surface-rgb', '224, 230, 247'),
        fill: getThemeRgb('--club-blue-rgb', '27, 53, 156'),
        fillBright: getThemeRgb('--club-blue-bright-rgb', '35, 107, 208'),
        deep: getThemeRgb('--club-blue-deep-rgb', '17, 71, 159'),
        night: getThemeRgb('--club-blue-night-rgb', '8, 32, 94'),
        border: getThemeRgb('--club-blue-strong-rgb', '19, 37, 109')
    };

    // Resize helper
    let needsResize = true;
    if (window.ResizeObserver) {
        new ResizeObserver(() => needsResize = true).observe(canvas);
    } else {
        window.addEventListener('resize', () => needsResize = true);
    }

    function resize() {
        if (!needsResize) return;
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, Math.floor(rect.width * dpr));
        const h = Math.max(8, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        needsResize = false;
    }

    // Basic shaders for solid rects
    const vsSrc = `
        attribute vec2 a_pos;
        uniform vec2 u_res;
        void main(){
            vec2 zeroToOne = a_pos / u_res;
            vec2 zeroToTwo = zeroToOne * 2.0;
            vec2 clipSpace = zeroToTwo - 1.0;
            gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        }
    `;
    const fsSrc = `
        precision mediump float;
        uniform vec4 u_color;
        void main(){
            gl_FragColor = u_color;
        }
    `;

    function compile(type, src){
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    }
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const a_pos = gl.getAttribLocation(prog, 'a_pos');
    const u_res = gl.getUniformLocation(prog, 'u_res');
    const u_color = gl.getUniformLocation(prog, 'u_color');

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(a_pos);
    gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

    // Pre-allocate buffer to avoid GC
    const verts = new Float32Array(12);

    function rect(x, y, w, h){
        const x2 = x + w, y2 = y + h;
        verts[0] = x; verts[1] = y;
        verts[2] = x2; verts[3] = y;
        verts[4] = x; verts[5] = y2;
        verts[6] = x; verts[7] = y2;
        verts[8] = x2; verts[9] = y;
        verts[10] = x2; verts[11] = y2;
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function render(progress){
        resize();
        const W = gl.drawingBufferWidth;
        const H = gl.drawingBufferHeight;
        gl.uniform2f(u_res, W, H);
        gl.clearColor(theme.surface[0], theme.surface[1], theme.surface[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const frame = Math.max(2, Math.floor(H * 0.14));
        const innerX = frame;
        const innerY = frame;
        const innerW = Math.max(0, W - frame * 2);
        const innerH = Math.max(0, H - frame * 2);
        const topSheen = Math.max(1, Math.floor(innerH * 0.34));
        const bottomShade = Math.max(1, Math.floor(innerH * 0.18));

        // Raised square shell
        gl.uniform4f(u_color, 1, 1, 1, 0.78);
        rect(0, 0, W, 1);
        rect(0, 0, 1, H);
        gl.uniform4f(u_color, theme.night[0], theme.night[1], theme.night[2], 0.48);
        rect(0, H - 1, W, 1);
        rect(W - 1, 0, 1, H);

        // Track well
        gl.uniform4f(u_color, theme.night[0], theme.night[1], theme.night[2], 0.18);
        rect(innerX, innerY, innerW, innerH);
        gl.uniform4f(u_color, 1, 1, 1, 0.44);
        rect(innerX, innerY, innerW, 1);
        gl.uniform4f(u_color, theme.border[0], theme.border[1], theme.border[2], 0.3);
        rect(innerX, innerY + innerH - 1, innerW, 1);

        // Fill progress
        const filled = Math.max(0, Math.min(1, progress)) * innerW;
        if (filled > 0) {
            gl.uniform4f(u_color, theme.deep[0], theme.deep[1], theme.deep[2], 1);
            rect(innerX, innerY, filled, innerH);
            gl.uniform4f(u_color, theme.fillBright[0], theme.fillBright[1], theme.fillBright[2], 0.92);
            rect(innerX, innerY, filled, topSheen);
            gl.uniform4f(u_color, theme.night[0], theme.night[1], theme.night[2], 0.32);
            rect(innerX, innerY + innerH - bottomShade, filled, bottomShade);
            gl.uniform4f(u_color, 1, 1, 1, 0.34);
            rect(innerX, innerY, Math.max(1, Math.floor(filled)), 1);
            gl.uniform4f(u_color, theme.night[0], theme.night[1], theme.night[2], 0.42);
            rect(Math.min(W - frame - 1, innerX + filled), innerY, 1, innerH);
        }
    }

    window.addEventListener('resize', () => render(0));
    // Initial style sizing
    const style = canvas.style;
    style.display = 'block';
    style.width = '100%';
    style.height = '14px';
    style.borderRadius = '0';

    return { render };
}

window.createSeekRenderer = createSeekRenderer;

function createChordOverlayRenderer(canvas){
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) {
        return { render: () => {} };
    }

    function getThemeRgb(name, fallback) {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
        const parts = raw.split(',').map(part => {
            const value = Number.parseFloat(part.trim());
            return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) / 255 : 0;
        });
        return parts.length === 3 ? parts : fallback.split(',').map(part => Number.parseFloat(part.trim()) / 255);
    }

    const theme = {
        overlay: getThemeRgb('--club-blue-progress-rgb', '23, 45, 133')
    };

    const vsSrc = `
        attribute vec2 a_pos;
        uniform vec2 u_res;
        void main(){
            vec2 zeroToOne = a_pos / u_res;
            vec2 zeroToTwo = zeroToOne * 2.0;
            vec2 clipSpace = zeroToTwo - 1.0;
            gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        }
    `;
    const fsSrc = `
        precision mediump float;
        uniform vec4 u_color;
        void main(){
            gl_FragColor = u_color;
        }
    `;

    function compile(t,s){ const sh = gl.createShader(t); gl.shaderSource(sh,s); gl.compileShader(sh); return sh; }
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog); gl.useProgram(prog);

    const a_pos = gl.getAttribLocation(prog,'a_pos');
    const u_res = gl.getUniformLocation(prog,'u_res');
    const u_color = gl.getUniformLocation(prog,'u_color');

    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(a_pos); gl.vertexAttribPointer(a_pos,2,gl.FLOAT,false,0,0);

    // Pre-allocate buffer
    const verts = new Float32Array(12);

    let needsResize = true;
    if (window.ResizeObserver) {
        new ResizeObserver(() => needsResize = true).observe(canvas);
    } else {
        window.addEventListener('resize', () => needsResize = true);
    }

    function resize(){
        if (!needsResize) return;
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, Math.floor(rect.width * dpr));
        const h = Math.max(100, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
        gl.viewport(0,0,gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform2f(u_res, gl.drawingBufferWidth, gl.drawingBufferHeight);
        needsResize = false;
    }

    function rect(x,y,w,h){
        const x2 = x+w, y2 = y+h;
        verts[0] = x; verts[1] = y;
        verts[2] = x2; verts[3] = y;
        verts[4] = x; verts[5] = y2;
        verts[6] = x; verts[7] = y2;
        verts[8] = x2; verts[9] = y;
        verts[10] = x2; verts[11] = y2;
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function render(rects){
        resize();
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform4f(u_color, theme.overlay[0], theme.overlay[1], theme.overlay[2], 0.22);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (const r of rects){
            rect(r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr);
        }
    }

    // initial
    window.addEventListener('resize', () => render([]));
    return { render };
}

window.getChordOverlayRenderer = function(canvas){
    if (!canvas.__renderer) {
        canvas.__renderer = createChordOverlayRenderer(canvas);
    }
    return canvas.__renderer;
};

function createPanelRenderer(canvas){
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: false });
    if (!gl) return { start:()=>{}, stop:()=>{}, setMouse:()=>{} };

    const vsSrc = `
        attribute vec2 a_pos;
        void main(){ gl_Position=vec4(a_pos,0.0,1.0); }
    `;
    const fsSrc = `
        precision mediump float;
        uniform vec2 u_res; uniform vec2 u_mouse; uniform float u_time;
        void main(){
            vec2 uv = gl_FragCoord.xy / u_res;
            vec2 m = u_mouse / u_res;
            // radial light from mouse, with soft falloff and slight time shimmer
            float d = distance(uv, m);
            float vignette = smoothstep(0.9, 0.3, d);
            float shimmer = 0.03 * sin(u_time*3.0 + uv.x*8.0 + uv.y*6.0);
            float intensity = clamp(vignette + shimmer, 0.0, 1.0);
            vec3 color = vec3(1.0) * intensity;
            gl_FragColor = vec4(color, 0.12);
        }
    `;
    function compile(t,s){ const sh=gl.createShader(t); gl.shaderSource(sh,s); gl.compileShader(sh); if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){ console.warn('PanelGL shader error:', gl.getShaderInfoLog(sh)); gl.deleteShader(sh); return null; } return sh; }
    const vs=compile(gl.VERTEX_SHADER,vsSrc), fs=compile(gl.FRAGMENT_SHADER,fsSrc);
    if (!vs || !fs) return { start:()=>{}, stop:()=>{}, setMouse:()=>{} };
    const prog=gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('PanelGL link error:', gl.getProgramInfoLog(prog)); return { start:()=>{}, stop:()=>{}, setMouse:()=>{} }; }
    gl.useProgram(prog);
    const a_pos=gl.getAttribLocation(prog,'a_pos'); const u_res=gl.getUniformLocation(prog,'u_res');
    const u_mouse=gl.getUniformLocation(prog,'u_mouse'); const u_time=gl.getUniformLocation(prog,'u_time');
    const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (a_pos === -1){ console.warn('PanelGL attribute a_pos missing'); return { start:()=>{}, stop:()=>{}, setMouse:()=>{} }; }
    gl.enableVertexAttribArray(a_pos);
    gl.vertexAttribPointer(a_pos,2,gl.FLOAT,false,0,0);
    const verts=new Float32Array(12);
    let mouseX=0, mouseY=0, running=false, rafId=null;
    function resize(){ const r=canvas.getBoundingClientRect(); const dpr=Math.min(window.devicePixelRatio||1,2);
        const w=Math.max(200, Math.floor(r.width*dpr)); const h=Math.max(40, Math.floor(r.height*dpr));
        if (canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; }
        gl.viewport(0,0,gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform2f(u_res, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    function fullQuad(){ verts[0]=-1;verts[1]=-1; verts[2]=1;verts[3]=-1; verts[4]=-1;verts[5]=1; verts[6]=-1;verts[7]=1; verts[8]=1;verts[9]=-1; verts[10]=1;verts[11]=1; gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW); gl.drawArrays(gl.TRIANGLES,0,6); }
    function draw(){ resize(); const W=gl.drawingBufferWidth,H=gl.drawingBufferHeight; gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(u_mouse, mouseX, mouseY); gl.uniform1f(u_time, performance.now()*0.001);
        fullQuad();
        if (running){ rafId=requestAnimationFrame(draw); } else { rafId=null; }
    }
    window.addEventListener('resize', draw);
    canvas.addEventListener('mousemove', (e)=>{ const r=canvas.getBoundingClientRect(); const dpr=Math.min(window.devicePixelRatio||1,2);
        mouseX=(e.clientX - r.left)*dpr; mouseY=(e.clientY - r.top)*dpr; if (!rafId) draw();
    });
    function start(){ if (!running){ running=true; draw(); } }
    function stop(){ running=false; if (!rafId) draw(); }
    function setMouse(x,y){ mouseX=x; mouseY=y; if (!rafId) draw(); }
    draw();
    return { start, stop, setMouse };
}

window.createPanelRenderer = createPanelRenderer;
