// Celebration effects for DevSnip Pro rewards (sparkles, confetti, coins,
// avatar rain, fireworks). Shared by the Milestones page and the Tools sidebar.
//
// Drawn on one temporary canvas, so it needs no stylesheet and works under the
// strict nonce CSP of the sidebar. Does nothing when the user prefers reduced
// motion. Usage: DevSnipEffects.play('confetti', { glyph: '🦊', anchor: el }).
(function () {
    'use strict';

    var COLORS = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#c77dff', '#ff9f1c', '#4cc9f0'];
    var running = null;

    function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function rand(min, max) { return min + Math.random() * (max - min); }
    function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

    /** Where effects start: the centre of the anchor element, or the top middle of the page. */
    function origin(anchor, width, height) {
        if (anchor && anchor.getBoundingClientRect) {
            var r = anchor.getBoundingClientRect();
            if (r.width || r.height) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return { x: width / 2, y: Math.min(height * 0.3, 160) };
    }

    function particlesFor(name, o, width, height, glyph) {
        var list = [];
        var i;
        if (name === 'sparkles') {
            for (i = 0; i < 26; i++) {
                list.push({ type: 'star', x: o.x + rand(-90, 90), y: o.y + rand(-50, 50), vx: rand(-0.3, 0.3), vy: rand(-0.6, -0.1), g: 0, size: rand(3, 7), color: pick(['#ffd166', '#fff3b0', '#ffe066', '#ffffff']), delay: rand(0, 500), life: rand(700, 1200) });
            }
        } else if (name === 'confetti') {
            for (i = 0; i < 90; i++) {
                var angle = rand(-Math.PI * 0.95, -Math.PI * 0.05);
                var speed = rand(4, 10);
                list.push({ type: 'rect', x: o.x, y: o.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, g: 0.22, drag: 0.985, size: rand(5, 9), rot: rand(0, Math.PI), vr: rand(-0.25, 0.25), color: pick(COLORS), delay: rand(0, 120), life: rand(1500, 2300) });
            }
        } else if (name === 'coins' || name === 'avatar') {
            var count = name === 'coins' ? 26 : 22;
            for (i = 0; i < count; i++) {
                list.push({ type: 'glyph', text: name === 'coins' ? '🪙' : (glyph || '⭐'), x: rand(0, width), y: rand(-80, -20), vx: rand(-0.4, 0.4), vy: rand(1.5, 3.5), g: 0.06, sway: rand(0, Math.PI * 2), size: rand(16, 26), delay: rand(0, 700), life: rand(1800, 2600) });
            }
        } else if (name === 'fireworks') {
            for (var b = 0; b < 4; b++) {
                var cx = rand(width * 0.15, width * 0.85);
                var cy = rand(height * 0.12, Math.min(height * 0.5, 260));
                var color = pick(COLORS);
                var start = b * 380;
                for (i = 0; i < 36; i++) {
                    var a = (Math.PI * 2 * i) / 36 + rand(-0.05, 0.05);
                    var s = rand(2.2, 4.2);
                    list.push({ type: 'dot', x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.05, drag: 0.97, size: rand(2, 3.2), color: i % 5 === 0 ? '#ffffff' : color, delay: start, life: rand(900, 1300) });
                }
            }
        }
        return list;
    }

    function drawStar(ctx, x, y, r) {
        ctx.beginPath();
        for (var i = 0; i < 8; i++) {
            var radius = i % 2 === 0 ? r : r * 0.35;
            var angle = (Math.PI / 4) * i - Math.PI / 2;
            ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        }
        ctx.closePath();
        ctx.fill();
    }

    function stop() {
        if (!running) return;
        cancelAnimationFrame(running.frame);
        if (running.canvas.parentNode) running.canvas.parentNode.removeChild(running.canvas);
        running = null;
    }

    /** Plays an effect once. Returns false when nothing was played. */
    function play(name, options) {
        options = options || {};
        if (!name || reducedMotion() || !document.body) return false;
        stop();
        var width = window.innerWidth;
        var height = window.innerHeight;
        var particles = particlesFor(name, origin(options.anchor, width, height), width, height, options.glyph);
        if (!particles.length) return false;

        var ratio = window.devicePixelRatio || 1;
        var canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.position = 'fixed';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '2147483000';
        document.body.appendChild(canvas);
        var ctx = canvas.getContext('2d');
        if (!ctx) { canvas.remove(); return false; }
        ctx.scale(ratio, ratio);

        var begin = performance.now();
        var last = begin;
        running = { canvas: canvas, frame: 0 };
        function frame(now) {
            var step = Math.min(3, (now - last) / 16.7);
            last = now;
            var elapsed = now - begin;
            ctx.clearRect(0, 0, width, height);
            var alive = false;
            particles.forEach(function (p) {
                var age = elapsed - p.delay;
                if (age < 0) { alive = true; return; }
                if (age > p.life) return;
                alive = true;
                p.vy += p.g * step;
                if (p.drag) { p.vx *= Math.pow(p.drag, step); p.vy *= Math.pow(p.drag, step); }
                p.x += p.vx * step;
                p.y += p.vy * step;
                var fade = Math.min(1, (p.life - age) / 350);
                ctx.globalAlpha = Math.max(0, fade);
                if (p.type === 'rect') {
                    p.rot += p.vr * step;
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.rot);
                    ctx.fillStyle = p.color;
                    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                    ctx.restore();
                } else if (p.type === 'dot') {
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                } else if (p.type === 'star') {
                    var twinkle = Math.sin((age / p.life) * Math.PI);
                    ctx.globalAlpha = Math.max(0, twinkle);
                    ctx.fillStyle = p.color;
                    drawStar(ctx, p.x, p.y, p.size * (0.6 + twinkle * 0.6));
                } else if (p.type === 'glyph') {
                    p.sway += 0.05 * step;
                    ctx.font = p.size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(p.text, p.x + Math.sin(p.sway) * 8, p.y);
                }
            });
            ctx.globalAlpha = 1;
            if (alive && elapsed < 4000) running.frame = requestAnimationFrame(frame);
            else stop();
        }
        running.frame = requestAnimationFrame(frame);
        return true;
    }

    window.DevSnipEffects = { play: play, stop: stop };
})();
