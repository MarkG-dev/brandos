// Brand OS — Spacecadet starfield.
// Lightweight canvas particle field: 120 dots, slow drift, subtle twinkle.
// Respects prefers-reduced-motion (dots stay static, twinkle disabled).

(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'sc-starfield';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DENSITY = 0.00012; // stars per pixel
  const MAX = 220;
  let stars = [];
  let w = 0, h = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth = window.innerWidth;
    h = canvas.clientHeight = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const target = Math.min(MAX, Math.floor(w * h * DENSITY));
    stars = new Array(target).fill(0).map(() => makeStar());
  }

  function makeStar() {
    const size = Math.random();
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: size < 0.85 ? 0.4 + Math.random() * 0.6 : 1.0 + Math.random() * 0.7,
      // Slow drift, mostly vertical downward with slight horizontal
      vx: (Math.random() - 0.5) * 0.03,
      vy: 0.02 + Math.random() * 0.06,
      // Twinkle phase & speed
      phase: Math.random() * Math.PI * 2,
      pspd: 0.006 + Math.random() * 0.012,
      base: 0.35 + Math.random() * 0.5,
    };
  }

  function step(t) {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (!REDUCED) {
        s.x += s.vx; s.y += s.vy;
        if (s.y - s.r > h) { s.y = -s.r; s.x = Math.random() * w; }
        if (s.x - s.r > w) s.x = -s.r;
        if (s.x + s.r < 0) s.x = w + s.r;
        s.phase += s.pspd;
      }
      const flicker = REDUCED ? s.base : s.base + Math.sin(s.phase) * 0.35;
      const alpha = Math.max(0.05, Math.min(1, flicker));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(244, 244, 245, ${alpha})`;
      ctx.fill();
      // Occasional bright pinprick with subtle halo
      if (s.r > 1.3) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(244, 244, 245, ${alpha * 0.08})`;
        ctx.fill();
      }
    }
    if (!REDUCED) requestAnimationFrame(step);
  }

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(step);

  // Live clock — updates every second, targets any .sc-clock elements
  function fmtTime() {
    const d = new Date();
    const p = n => n.toString().padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function tickClock() {
    document.querySelectorAll('.sc-clock').forEach(el => el.textContent = fmtTime());
  }
  tickClock();
  setInterval(tickClock, 1000);
})();
