// A Clawd on the right edge that falls down the page as you scroll (and flies back up), drawn with farm.js's own
// sprites. It springs after the scroll, so it lags, flails and lands with a squash. Runs only while it moves.
(() => {
  if (typeof critterSprite !== "function") return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const box = document.createElement("div"), cv = document.createElement("canvas"), say = document.createElement("span");
  box.className = "faller";
  box.setAttribute("aria-hidden", "true");
  say.className = "faller-say";
  cv.width = 24; cv.height = 34;            // the 16 x 18 critter, room to tilt, and speed lines above or below
  box.append(say, cv);
  document.body.append(box);
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;

  const COLOR = "#d2a21d";
  let y = null, v = 0, t = 0, squash = 0, raf = 0, last = 0;
  const range = () => {
    const h = cv.getBoundingClientRect().height || 136;
    return [96, Math.max(96, innerHeight - h - 18)];
  };
  const target = () => {
    const [top, bottom] = range();
    const max = document.documentElement.scrollHeight - innerHeight;
    return top + (max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0) * (bottom - top);
  };

  function draw(moving) {
    g.clearRect(0, 0, cv.width, cv.height);
    const flail = Math.floor(t / 110) % 2 ? 1 : -1;
    const sprite = critterSprite("straw", COLOR, moving
      ? { arms: 1, legs: flail }
      : { arms: 0, legs: 0, blink: t % 3200 < 140 });
    g.save();
    g.translate(12, 26);                    // feet
    if (moving) g.rotate(Math.sin(t / 90) * 0.14);
    if (squash > 0) g.scale(1 + squash * 0.25, 1 - squash * 0.25);
    g.drawImage(sprite, -8, -18);
    g.restore();
    if (moving && Math.abs(v) > 1.2) {       // speed lines trail behind the fall
      g.fillStyle = "rgba(255,255,255,.85)";
      const down = v > 0, n = Math.min(6, Math.round(Math.abs(v) / 2));
      for (const [x, k] of [[5, 0], [12, 2], [19, 1]]) {
        const y0 = down ? (t / 40 + k * 3) % 4 : 28 + ((t / 40 + k * 3) % 3);
        g.fillRect(x, y0, 1, Math.max(2, Math.min(down ? 7 : 5, n)));
      }
    }
  }

  function frame(now) {
    const dt = Math.min(48, now - (last || now)) / 16.7;
    last = now; t += dt * 16.7;
    const goal = target();
    const before = v;
    v += (goal - y) * 0.06 * dt;            // spring toward where the scroll says it should be
    v *= Math.pow(0.84, dt);
    y += v * dt;
    if (before > 2 && v <= 0 && goal - y < 30) squash = Math.min(1, before / 12); // it hit the bottom of the fall
    squash = Math.max(0, squash - 0.08 * dt);
    const moving = Math.abs(v) > 0.35 || Math.abs(goal - y) > 1.5;
    say.textContent = v < 0 ? "UP UP!" : "WHEEE!";
    box.classList.toggle("moving", Math.abs(v) > 2.5);
    box.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    draw(moving);
    if (moving || squash > 0) raf = requestAnimationFrame(frame);
    else { raf = 0; last = 0; y = goal; v = 0; draw(false); }
  }

  const kick = () => {
    if (reduced) { y = target(); box.style.transform = `translate3d(0, ${y}px, 0)`; draw(false); return; }
    if (!raf) raf = requestAnimationFrame(frame);
  };
  y = target();
  box.style.transform = `translate3d(0, ${y}px, 0)`;
  draw(false);
  addEventListener("scroll", kick, { passive: true });
  addEventListener("resize", kick);
  // a blink now and then while it stands still
  if (!reduced) setInterval(() => { if (!raf) { t += 3200 - (t % 3200); draw(false); setTimeout(() => { t += 200; draw(false); }, 140); } }, 3600);
})();
