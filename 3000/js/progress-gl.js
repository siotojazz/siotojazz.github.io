function createSeekRenderer(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) {
        return {
            render: () => {}
        };
    }

    // Resize helper
    function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, Math.floor(rect.width * dpr));
        const h = Math.max(8, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
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

    const a_pos = gl.getAttribLocation(prog, 'a_pos');
    const u_res = gl.getUniformLocation(prog, 'u_res');
    const u_color = gl.getUniformLocation(prog, 'u_color');

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(a_pos);
    gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

    function rect(x, y, w, h){
        const x2 = x + w, y2 = y + h;
        const verts = new Float32Array([
            x, y,  x2, y,  x, y2,
            x, y2, x2, y, x2, y2
        ]);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function render(progress){
        resize();
        const W = gl.drawingBufferWidth;
        const H = gl.drawingBufferHeight;
        gl.uniform2f(u_res, W, H);
        gl.clearColor(1,1,1,1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        // Border
        gl.uniform4f(u_color, 0,0,0,1);
        rect(0, 0, W, 1);
        rect(0, H-1, W, 1);
        rect(0, 0, 1, H);
        rect(W-1, 0, 1, H);
        // Fill progress
        const filled = Math.max(0, Math.min(1, progress)) * (W-2);
        gl.uniform4f(u_color, 0,0,0,1);
        rect(1, 1, filled, H-2);
    }

    window.addEventListener('resize', () => render(0));
    // Initial style sizing
    const style = canvas.style;
    style.display = 'block';
    style.width = '100%';
    style.height = '12px';

    return { render };
}

window.createSeekRenderer = createSeekRenderer;

function createChordOverlayRenderer(canvas){
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) {
        return { render: () => {} };
    }

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

    function resize(){
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, Math.floor(rect.width * dpr));
        const h = Math.max(100, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
        gl.viewport(0,0,gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform2f(u_res, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }

    function rect(x,y,w,h){
        const x2 = x+w, y2 = y+h;
        const verts = new Float32Array([
            x,y,  x2,y,  x,y2,
            x,y2, x2,y, x2,y2
        ]);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function render(rects){
        resize();
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform4f(u_color, 0,0,0,0.18);
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
