(() => {
  'use strict';

  // --- Réglages ---------------------------------------------------------
  const W = 600;               // largeur logique du terrain
  const H = 900;               // hauteur logique du terrain
  const WIN_SCORE = 11;
  const PADDLE_W = 110;
  const PADDLE_H = 14;
  const PADDLE_MARGIN = 40;    // distance raquette / bord
  const PADDLE_SPEED = 650;    // px/s
  const BALL_R = 9;
  const BALL_START_SPEED = 420;
  const BALL_ACCEL = 1.06;     // +6 % à chaque renvoi
  const BALL_MAX_SPEED = 1150;
  const SERVE_DELAY = 1.0;     // secondes avant l'engagement
  const COLORS = { p1: '#ff2bd6', p2: '#19f0ff', ball: '#ffffff', line: 'rgba(232,230,255,.25)' };

  // --- DOM --------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const overlayMsg = document.getElementById('overlay-msg');
  const overlayStats = document.getElementById('overlay-stats');

  // --- État -------------------------------------------------------------
  const p1 = { x: (W - PADDLE_W) / 2, y: PADDLE_MARGIN, score: 0, color: COLORS.p1 };
  const p2 = { x: (W - PADDLE_W) / 2, y: H - PADDLE_MARGIN - PADDLE_H, score: 0, color: COLORS.p2 };
  const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: BALL_START_SPEED, trail: [] };
  const keys = { p1Left: false, p1Right: false, p2Left: false, p2Right: false };

  let state = 'menu';          // menu | serve | play | paused | over
  let pausedFrom = null;
  let serveTimer = 0;
  let serveDir = 1;            // 1 = vers le bas (joueur 2), -1 = vers le haut (joueur 1)
  let lastTime = performance.now();
  let rally = 0;               // renvois dans l'échange en cours
  let longestRally = 0;        // plus long échange de la partie

  // --- Mise à l'échelle -------------------------------------------------
  function resize() {
    const scale = Math.min(window.innerWidth * 0.96 / W, window.innerHeight * 0.96 / H);
    const cssW = Math.floor(W * scale);
    const cssH = Math.floor(H * scale);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- Clavier ----------------------------------------------------------
  function setKey(e, down) {
    const k = e.key.toLowerCase();
    if (k === 'q') keys.p1Left = down;
    else if (k === 'd') keys.p1Right = down;
    // e.code pour le pavé numérique : fonctionne que Verr. Num soit actif ou non
    else if (e.code === 'Numpad4') keys.p2Left = down;
    else if (e.code === 'Numpad6') keys.p2Right = down;
    else return false;
    return true;
  }

  window.addEventListener('keydown', (e) => {
    if (setKey(e, true)) { e.preventDefault(); return; }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (state === 'menu' || state === 'over') startGame();
      else if (state === 'paused') resume();
    } else if (e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      if (state === 'play' || state === 'serve') pause();
      else if (state === 'paused') resume();
    }
  });
  window.addEventListener('keyup', (e) => { if (setKey(e, false)) e.preventDefault(); });
  // Évite les touches « collées » si la fenêtre perd le focus
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    if (state === 'play' || state === 'serve') pause();
  });

  // --- Overlay ----------------------------------------------------------
  function showOverlay(msg, color, stats) {
    overlayMsg.textContent = msg;
    overlayMsg.style.color = color || '';
    overlayStats.textContent = stats || '';
    overlay.classList.remove('hidden');
  }
  function hideOverlay() { overlay.classList.add('hidden'); }

  // --- Déroulement de la partie ----------------------------------------
  function startGame() {
    p1.score = 0;
    p2.score = 0;
    longestRally = 0;
    p1.x = p2.x = (W - PADDLE_W) / 2;
    serveDir = Math.random() < 0.5 ? 1 : -1;
    prepareServe();
    hideOverlay();
  }

  function prepareServe() {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = ball.vy = 0;
    ball.speed = BALL_START_SPEED;
    ball.trail.length = 0;
    rally = 0;
    serveTimer = SERVE_DELAY;
    state = 'serve';
  }

  function launchBall() {
    // Angle aléatoire entre 15° et 40° par rapport à la verticale
    const angle = (15 + Math.random() * 25) * Math.PI / 180 * (Math.random() < 0.5 ? -1 : 1);
    ball.vx = Math.sin(angle) * ball.speed;
    ball.vy = Math.cos(angle) * ball.speed * serveDir;
    state = 'play';
  }

  function pause() {
    pausedFrom = state;
    state = 'paused';
    showOverlay('Pause — Espace / Échap / Entrée pour reprendre');
  }

  function resume() {
    state = pausedFrom;
    hideOverlay();
  }

  function scorePoint(player) {
    player.score++;
    if (player.score >= WIN_SCORE) {
      state = 'over';
      const name = player === p1 ? 'Joueur 1' : 'Joueur 2';
      const s = longestRally > 1 ? 's' : '';
      showOverlay(`${name} gagne ${p1.score} – ${p2.score} ! Entrée pour rejouer`, player.color,
        `Plus long échange : ${longestRally} renvoi${s}`);
      return;
    }
    // Le perdant du point reçoit l'engagement
    serveDir = player === p1 ? 1 : -1;
    prepareServe();
  }

  // --- Mise à jour ------------------------------------------------------
  function movePaddle(p, left, right, dt) {
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    p.x = Math.max(0, Math.min(W - PADDLE_W, p.x + dir * PADDLE_SPEED * dt));
  }

  function hitsPaddle(p) {
    return ball.x + BALL_R >= p.x && ball.x - BALL_R <= p.x + PADDLE_W &&
           ball.y + BALL_R >= p.y && ball.y - BALL_R <= p.y + PADDLE_H;
  }

  function bounceOffPaddle(p, goingDown) {
    rally++;
    longestRally = Math.max(longestRally, rally);
    ball.speed = Math.min(ball.speed * BALL_ACCEL, BALL_MAX_SPEED);
    const ratio = ball.speed / Math.hypot(ball.vx, ball.vy);
    ball.vx *= ratio;
    ball.vy = -ball.vy * ratio;
    // Replace la balle hors de la raquette pour éviter un double contact
    ball.y = goingDown ? p.y - BALL_R : p.y + PADDLE_H + BALL_R;
  }

  function stepBall(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Murs latéraux
    if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
    else if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); }

    // Raquettes (uniquement si la balle se dirige vers elles)
    if (ball.vy < 0 && hitsPaddle(p1)) bounceOffPaddle(p1, false);
    else if (ball.vy > 0 && hitsPaddle(p2)) bounceOffPaddle(p2, true);

    // Buts
    if (ball.y + BALL_R < 0) { scorePoint(p2); return false; }
    if (ball.y - BALL_R > H) { scorePoint(p1); return false; }
    return true;
  }

  function update(dt) {
    if (state === 'serve' || state === 'play') {
      movePaddle(p1, keys.p1Left, keys.p1Right, dt);
      movePaddle(p2, keys.p2Left, keys.p2Right, dt);
    }

    if (state === 'serve') {
      serveTimer -= dt;
      if (serveTimer <= 0) launchBall();
    } else if (state === 'play') {
      // Sous-pas pour éviter que la balle traverse une raquette à grande vitesse
      const steps = Math.ceil(ball.speed * dt / (BALL_R * 0.8));
      for (let i = 0; i < steps; i++) {
        if (!stepBall(dt / steps)) break;
      }
      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 14) ball.trail.shift();
    }
  }

  // --- Rendu ------------------------------------------------------------
  function glow(color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  function drawField() {
    ctx.fillStyle = '#07021a';
    ctx.fillRect(0, 0, W, H);

    // Ligne médiane pointillée
    ctx.save();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 16]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.restore();

    // Bordures néon (haut = joueur 1, bas = joueur 2)
    ctx.save();
    ctx.lineWidth = 3;
    glow(COLORS.p1, 14);
    ctx.strokeStyle = COLORS.p1;
    ctx.strokeRect(1.5, 1.5, W - 3, H / 2 - 1.5);
    glow(COLORS.p2, 14);
    ctx.strokeStyle = COLORS.p2;
    ctx.strokeRect(1.5, H / 2, W - 3, H / 2 - 1.5);
    ctx.restore();
  }

  function drawScores() {
    ctx.save();
    ctx.font = 'bold 96px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.35;
    glow(COLORS.p1, 20);
    ctx.fillStyle = COLORS.p1;
    ctx.fillText(p1.score, W / 2, H / 4);
    glow(COLORS.p2, 20);
    ctx.fillStyle = COLORS.p2;
    ctx.fillText(p2.score, W / 2, H * 3 / 4);
    ctx.restore();
  }

  function drawRally() {
    if (state === 'menu' || rally === 0) return;
    ctx.save();
    ctx.font = '18px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(232,230,255,.4)';
    ctx.fillText(`échange ${rally}`, W - 16, H / 2 - 8);
    ctx.restore();
  }

  function drawPaddle(p) {
    ctx.save();
    glow(p.color, 25);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, PADDLE_W, PADDLE_H, PADDLE_H / 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBall() {
    ctx.save();
    // Traînée
    const n = ball.trail.length;
    for (let i = 0; i < n; i++) {
      const t = ball.trail[i];
      const a = (i + 1) / n;
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = ball.vy < 0 ? COLORS.p2 : COLORS.p1;
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * a, 0, Math.PI * 2);
      ctx.fill();
    }
    // Balle (clignote pendant l'engagement)
    ctx.globalAlpha = state === 'serve' ? 0.5 + 0.5 * Math.sin(serveTimer * 20) : 1;
    glow('#ffffff', 22);
    ctx.fillStyle = COLORS.ball;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawServeArrow() {
    if (state !== 'serve') return;
    ctx.save();
    const color = serveDir > 0 ? COLORS.p2 : COLORS.p1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    glow(color, 12);
    const y = H / 2 + serveDir * 40;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 14, y - serveDir * 10);
    ctx.lineTo(W / 2, y);
    ctx.lineTo(W / 2 + 14, y - serveDir * 10);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    drawField();
    drawScores();
    drawRally();
    drawPaddle(p1);
    drawPaddle(p2);
    drawServeArrow();
    if (state !== 'menu') drawBall();
  }

  // --- Boucle principale ------------------------------------------------
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05); // plafonné si l'onglet a été inactif
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  showOverlay(`Premier à ${WIN_SCORE} points`);
  requestAnimationFrame(loop);
})();
