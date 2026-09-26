(() => {
  'use strict';

  // --- Réglages ---------------------------------------------------------
  const W = 600;               // largeur logique du terrain
  const H = 900;               // hauteur logique du terrain
  const WIN_SCORE = 11;
  const PADDLE_W = 110;        // largeur à 100 %
  const PADDLE_H = 14;
  const PADDLE_MARGIN = 40;    // distance raquette / bord
  const PADDLE_SPEED = 650;    // px/s
  const SIZE_MIN = 50, SIZE_MAX = 175, SIZE_STEP = 25;   // taille des raquettes en %
  const BALL_R = 9;
  const BALL_START_SPEED = 420;
  const BALL_ACCEL = 1.06;     // +6 % à chaque renvoi
  const BALL_MAX_SPEED = 1150;
  const MAX_BALLS = 3;
  const SERVE_DELAY = 1.0;     // secondes avant l'engagement
  const TRAIL_TIME = 0.23;     // durée de la traînée, en secondes
  const SHIELD_Y = 14, SHIELD_H = 8;   // bouclier : bande entre le bord et la raquette
  const MISSILE_W = 8, MISSILE_H = 22, MISSILE_SPEED = 700, MAX_MISSILES = 3;
  const GIFT_SIZE = 30, GIFT_SPEED = 230;
  const GIFT_DELAY_MIN = 2, GIFT_DELAY_MAX = 5;          // secondes de jeu entre deux cadeaux
  const EFFECT_TIME = 6;       // durée des effets vitesse / tortue
  const SPEED_FACTOR = { fast: 1.5, slow: 0.6 };
  const MAX_PIXEL_HEIGHT = 1600; // plafond de résolution du canvas (fluidité sur écrans 4K)
  const COLORS = { p1: '#ff2bd6', p2: '#19f0ff', ball: '#ffffff', text: '#e8e6ff', field: '#07021a' };

  // Cadeaux : poids du tirage (sur 100), couleur et symbole
  const GIFTS = {
    missile: { weight: 35, color: '#ff4b4b', icon: '🚀' },
    grow:    { weight: 13, color: '#2bff88', icon: '⟷' },
    shield:  { weight: 13, color: '#3b8bff', icon: '🛡' },
    big:     { weight: 9,  color: '#b04bff', icon: '●' },
    fast:    { weight: 10, color: '#ffd23b', icon: '⚡' },
    slow:    { weight: 10, color: '#ff9a3b', icon: '🐢' },
    multi:   { weight: 10, color: '#e8e6ff', icon: '×' },
  };

  // --- DOM --------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const overlayMsg = document.getElementById('overlay-msg');
  const overlayStats = document.getElementById('overlay-stats');
  const muteBtn = document.getElementById('mute');

  // --- État -------------------------------------------------------------
  const newPlayer = (y, color, dir) => ({
    cx: W / 2, y, color, dir,  // dir : sens de tir (1 = vers le bas)
    score: 0, size: 100, missiles: 0, shield: false, flash: 0,
  });
  const p1 = newPlayer(PADDLE_MARGIN, COLORS.p1, 1);
  const p2 = newPlayer(H - PADDLE_MARGIN - PADDLE_H, COLORS.p2, -1);
  const keys = { p1Left: false, p1Right: false, p2Left: false, p2Right: false };

  let balls = [];              // { x, y, vx, vy, speed, trail }
  let missiles = [];           // { x, y, vy, owner }
  let gifts = [];              // { x, y, dir, type, mult }
  let state = 'menu';          // menu | serve | play | paused | over
  let pausedFrom = null;
  let serveTimer = 0;
  let serveDir = 1;            // 1 = vers le bas (joueur 2), -1 = vers le haut (joueur 1)
  let pendingBalls = 1;        // balles à lancer à l'engagement
  let bigBall = false;         // cadeau violet actif jusqu'à la fin du point
  let effect = null;           // { kind: 'fast' | 'slow', t }
  let giftTimer = 0;
  let rally = 0, longestRally = 0;
  let clock = 0;               // temps de jeu écoulé (traînées)
  let lastTime = performance.now();

  const paddleW = p => PADDLE_W * p.size / 100;
  const ballR = () => BALL_R * (bigBall ? 2 : 1);
  const rand = (a, b) => a + Math.random() * (b - a);

  // --- Sons (Web Audio, synthétisés) -----------------------------------
  let audio = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('pong-muted') === '1'; } catch (e) { /* stockage indisponible */ }

  function ensureAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(gain, t, attack, dur, vol) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function osc(type, f0, f1, t, dur, vol, attack = 0.005) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, attack, dur, vol);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(filterType, f0, f1, t, dur, vol, attack = 0.01) {
    const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    src.buffer = noiseBuf;
    f.type = filterType;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, attack, dur, vol);
    src.connect(f).connect(g).connect(audio.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    pong:      t => osc('square', 490, 490, t, 0.07, 0.12),
    missile:   t => { osc('sawtooth', 300, 1400, t, 0.4, 0.06, 0.02); noise('bandpass', 800, 3000, t, 0.4, 0.15, 0.02); },
    explosion: t => { noise('lowpass', 3000, 150, t, 0.8, 0.6); osc('sine', 70, 40, t, 0.7, 0.35); },
    flop:      t => osc('sine', 380, 90, t, 0.45, 0.25, 0.02),
    bonus:     t => { osc('sine', 880, 880, t, 0.06, 0.2); osc('sine', 1320, 1320, t + 0.06, 0.1, 0.2); },
    fin:       t => [523, 659, 784, 1047].forEach((f, i) =>
                 osc('triangle', f, f, t + i * 0.13, i === 3 ? 0.5 : 0.13, 0.25)),
  };

  function play(name) {
    if (muted || !audio) return;
    SOUNDS[name](audio.currentTime);
  }

  function setMuted(m) {
    muted = m;
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', m ? 'Remettre le son' : 'Couper le son');
    try { localStorage.setItem('pong-muted', m ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
  }
  setMuted(muted);
  muteBtn.addEventListener('click', () => { ensureAudio(); setMuted(!muted); muteBtn.blur(); });

  // --- Mise à l'échelle et images en cache ------------------------------
  // Les halos (shadowBlur, très coûteux) sont dessinés une seule fois dans des
  // images hors écran, puis simplement recopiées à chaque image.
  let S = 1;                   // pixels du canvas par unité logique
  let sprites = new Map();
  let background = null;

  function resize() {
    const scale = Math.min(window.innerWidth * 0.96 / W, window.innerHeight * 0.96 / H);
    const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_HEIGHT / cssH);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    S = canvas.height / H;
    sprites = new Map();
    background = null;
  }
  window.addEventListener('resize', resize);
  resize();

  // Image en cache de taille logique w x h, dessinée par draw(c) en coordonnées logiques
  function sprite(key, w, h, draw) {
    let img = sprites.get(key);
    if (!img) {
      img = document.createElement('canvas');
      img.width = Math.ceil(w * S);
      img.height = Math.ceil(h * S);
      const c = img.getContext('2d');
      c.scale(S, S);
      draw(c);
      sprites.set(key, img);
    }
    return img;
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
  }

  const GLOW = 18;             // marge autour des objets pour leur halo

  function paddleSprite(p) {
    const w = paddleW(p);
    return sprite(`pad${p.color}${p.size}`, w + 2 * GLOW, PADDLE_H + 2 * GLOW, c => {
      c.shadowColor = p.color; c.shadowBlur = 16; c.fillStyle = p.color;
      roundRect(c, GLOW, GLOW, w, PADDLE_H, PADDLE_H / 2); c.fill(); c.fill();
    });
  }

  function ballSprite(r) {
    return sprite(`ball${r}`, 2 * (r + GLOW), 2 * (r + GLOW), c => {
      c.shadowColor = '#fff'; c.shadowBlur = 16; c.fillStyle = COLORS.ball;
      c.beginPath(); c.arc(r + GLOW, r + GLOW, r, 0, Math.PI * 2); c.fill();
    });
  }

  function shieldSprite() {
    const color = GIFTS.shield.color;
    return sprite('shield', W + 2 * GLOW, SHIELD_H + 2 * GLOW, c => {
      c.shadowColor = color; c.shadowBlur = 14; c.fillStyle = color;
      c.globalAlpha = 0.85;
      roundRect(c, GLOW + 4, GLOW, W - 8, SHIELD_H, SHIELD_H / 2); c.fill();
    });
  }

  function missileSprite(owner) {
    return sprite(`missile${owner.color}`, MISSILE_W + 2 * GLOW, MISSILE_H + 2 * GLOW, c => {
      c.translate(GLOW, GLOW);
      if (owner.dir > 0) { c.translate(MISSILE_W, MISSILE_H); c.rotate(Math.PI); } // pointe vers le bas
      c.shadowColor = owner.color; c.shadowBlur = 10;
      c.fillStyle = '#ffb02e';                                   // flamme
      c.beginPath(); c.moveTo(2.5, 17); c.lineTo(4, 22); c.lineTo(5.5, 17); c.fill();
      c.fillStyle = owner.color;                                 // ailerons
      c.beginPath(); c.moveTo(0, 18); c.lineTo(2.5, 12); c.lineTo(2.5, 18); c.fill();
      c.beginPath(); c.moveTo(8, 18); c.lineTo(5.5, 12); c.lineTo(5.5, 18); c.fill();
      c.fillStyle = COLORS.text; c.fillRect(2.5, 6, 3, 12);      // corps
      c.fillStyle = owner.color;                                 // ogive
      c.beginPath(); c.moveTo(2.5, 6); c.lineTo(4, 0); c.lineTo(5.5, 6); c.fill();
    });
  }

  function giftSprite(g) {
    const def = GIFTS[g.type];
    const label = g.type === 'multi' ? `×${g.mult}` : def.icon;
    return sprite(`gift${g.type}${g.mult}`, GIFT_SIZE + 2 * GLOW, GIFT_SIZE + 2 * GLOW, c => {
      c.shadowColor = def.color; c.shadowBlur = 14; c.fillStyle = def.color;
      roundRect(c, GLOW, GLOW, GIFT_SIZE, GIFT_SIZE, 7); c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#05010f';
      c.font = `bold ${g.type === 'multi' ? 16 : 18}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(label, GLOW + GIFT_SIZE / 2, GLOW + GIFT_SIZE / 2 + 1);
    });
  }

  function drawBackground() {
    if (!background) {
      background = sprite('background', W, H, c => {
        c.fillStyle = COLORS.field;
        c.fillRect(0, 0, W, H);
        // Ligne médiane pointillée
        c.strokeStyle = 'rgba(232,230,255,.25)';
        c.lineWidth = 4;
        c.setLineDash([18, 16]);
        c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
        c.setLineDash([]);
        // Bordures néon (haut = joueur 1, bas = joueur 2)
        c.lineWidth = 3;
        c.shadowBlur = 14;
        c.shadowColor = c.strokeStyle = COLORS.p1;
        c.strokeRect(1.5, 1.5, W - 3, H / 2 - 1.5);
        c.shadowColor = c.strokeStyle = COLORS.p2;
        c.strokeRect(1.5, H / 2, W - 3, H / 2 - 1.5);
      });
    }
    ctx.drawImage(background, 0, 0, W, H);
  }

  // Recopie une image en cache centrée sur (x, y)
  function blit(img, x, y) {
    ctx.drawImage(img, x - img.width / S / 2, y - img.height / S / 2, img.width / S, img.height / S);
  }

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
    ensureAudio();
    if (setKey(e, true)) { e.preventDefault(); return; }
    const k = e.key.toLowerCase();

    if (k === 's' || e.code === 'Numpad8') {
      e.preventDefault();
      if (!e.repeat && (state === 'play' || state === 'serve')) fire(k === 's' ? p1 : p2);
    } else if (k === 'm') {
      setMuted(!muted);
    } else if (e.key === 'Enter') {
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
    for (const p of [p1, p2]) Object.assign(p, { cx: W / 2, score: 0, size: 100, missiles: 0, shield: false, flash: 0 });
    missiles = [];
    gifts = [];
    effect = null;
    longestRally = 0;
    giftTimer = rand(GIFT_DELAY_MIN, GIFT_DELAY_MAX);
    serveDir = Math.random() < 0.5 ? 1 : -1;
    prepareServe();
    hideOverlay();
  }

  function prepareServe() {
    balls = [];
    pendingBalls = 1;
    bigBall = false;           // fin de point : la balle reprend sa taille normale
    rally = 0;
    serveTimer = SERVE_DELAY;
    state = 'serve';
  }

  function newBall(x, y, speed, dirY) {
    // Angle aléatoire entre 15° et 40° par rapport à la verticale
    const angle = rand(15, 40) * Math.PI / 180 * (Math.random() < 0.5 ? -1 : 1);
    return { x, y, speed, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed * dirY, trail: [] };
  }

  function launchBalls() {
    for (let i = 0; i < pendingBalls; i++) {
      // Balles supplémentaires : un coup vers chaque joueur à tour de rôle
      balls.push(newBall(W / 2, H / 2, BALL_START_SPEED, i % 2 === 0 ? serveDir : -serveDir));
    }
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

  function scorePoint(player, ball) {
    player.score++;
    balls.splice(balls.indexOf(ball), 1);
    if (player.score >= WIN_SCORE) {
      state = 'over';
      play('fin');
      const name = player === p1 ? 'Joueur 1' : 'Joueur 2';
      const s = longestRally > 1 ? 's' : '';
      showOverlay(`${name} gagne ${p1.score} – ${p2.score} ! Entrée pour rejouer`, player.color,
        `Plus long échange : ${longestRally} renvoi${s}`);
      return;
    }
    // Plus aucune balle : le perdant du dernier point reçoit l'engagement
    if (balls.length === 0) {
      serveDir = player === p1 ? 1 : -1;
      prepareServe();
    }
  }

  // --- Missiles ---------------------------------------------------------
  // Position des missiles posés sur la raquette (répartis sur sa largeur)
  function missileSlots(p) {
    const w = paddleW(p) * 0.7;
    return Array.from({ length: p.missiles }, (_, i) =>
      p.cx + (p.missiles === 1 ? 0 : -w / 2 + w * i / (p.missiles - 1)));
  }

  function missileRestY(p) {
    return p.dir > 0 ? p.y + PADDLE_H + MISSILE_H / 2 + 2 : p.y - MISSILE_H / 2 - 2;
  }

  function fire(p) {
    if (p.missiles === 0) return;
    const y = missileRestY(p);
    for (const x of missileSlots(p)) missiles.push({ x, y, vy: p.dir * MISSILE_SPEED, owner: p });
    p.missiles = 0;
    play('missile');
  }

  function updateMissiles(dt) {
    let sound = null;          // un seul son par image, même pour une salve de 3
    missiles = missiles.filter(m => {
      m.y += m.vy * dt;
      const target = m.owner === p1 ? p2 : p1;
      const top = m.y - MISSILE_H / 2, bottom = m.y + MISSILE_H / 2;
      // Raquette adverse : elle rétrécit
      const w = paddleW(target);
      if (Math.abs(m.x - target.cx) < w / 2 + MISSILE_W / 2 && bottom >= target.y && top <= target.y + PADDLE_H) {
        target.size = Math.max(SIZE_MIN, target.size - SIZE_STEP);
        target.flash = 0.4;
        sound = 'explosion';
        return false;
      }
      // Bouclier adverse : il absorbe le missile et disparaît
      const sy = target === p1 ? SHIELD_Y : H - SHIELD_Y - SHIELD_H;
      if (target.shield && bottom >= sy && top <= sy + SHIELD_H) {
        target.shield = false;
        sound = 'explosion';
        return false;
      }
      if (bottom < 0 || top > H) {
        if (!sound) sound = 'flop';
        return false;
      }
      return true;
    });
    if (sound) play(sound);
  }

  // --- Cadeaux ----------------------------------------------------------
  function pickGiftType() {
    let r = Math.random() * 100;
    for (const [type, def] of Object.entries(GIFTS)) {
      if ((r -= def.weight) < 0) return type;
    }
    return 'missile';
  }

  function spawnGift() {
    const type = pickGiftType();
    gifts.push({
      x: rand(40, W - 40), y: H / 2,
      dir: Math.random() < 0.5 ? -1 : 1,     // -1 = vers le joueur 1 (haut)
      type, mult: type === 'multi' ? (Math.random() < 0.6 ? 2 : 3) : 0,
    });
  }

  function applyGift(p, g) {
    switch (g.type) {
      case 'missile': p.missiles = Math.min(MAX_MISSILES, p.missiles + 1); break;
      case 'grow': p.size = Math.min(SIZE_MAX, p.size + SIZE_STEP); break;
      case 'shield': p.shield = true; break;
      case 'big': bigBall = true; break;
      case 'fast':
      case 'slow': effect = { kind: g.type, t: EFFECT_TIME }; break;
      case 'multi': addBalls(g.mult - 1); break;
    }
    play('bonus');
  }

  function addBalls(n) {
    if (state === 'serve') {
      pendingBalls = Math.min(MAX_BALLS, pendingBalls + n);
      return;
    }
    const ref = balls[0];
    for (let i = 0; i < n && balls.length < MAX_BALLS; i++) {
      balls.push(ref ? newBall(ref.x, ref.y, ref.speed, i % 2 === 0 ? -Math.sign(ref.vy) : Math.sign(ref.vy))
                     : newBall(W / 2, H / 2, BALL_START_SPEED, i % 2 === 0 ? 1 : -1));
    }
  }

  function updateGifts(dt) {
    giftTimer -= dt;
    if (giftTimer <= 0) {
      spawnGift();
      giftTimer = rand(GIFT_DELAY_MIN, GIFT_DELAY_MAX);
    }
    const h = GIFT_SIZE / 2;
    gifts = gifts.filter(g => {
      g.y += g.dir * GIFT_SPEED * dt;
      const p = g.dir < 0 ? p1 : p2;
      if (Math.abs(g.x - p.cx) < paddleW(p) / 2 + h && g.y + h >= p.y && g.y - h <= p.y + PADDLE_H) {
        applyGift(p, g);
        return false;
      }
      return g.y > -h && g.y < H + h;
    });
  }

  // --- Balles -----------------------------------------------------------
  function movePaddle(p, left, right, dt) {
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    const half = paddleW(p) / 2;
    p.cx = Math.max(half, Math.min(W - half, p.cx + dir * PADDLE_SPEED * dt));
  }

  function hitsPaddle(b, p, r) {
    const half = paddleW(p) / 2;
    return b.x + r >= p.cx - half && b.x - r <= p.cx + half &&
           b.y + r >= p.y && b.y - r <= p.y + PADDLE_H;
  }

  function bounceOffPaddle(b, p, goingDown, r) {
    rally++;
    longestRally = Math.max(longestRally, rally);
    b.speed = Math.min(b.speed * BALL_ACCEL, BALL_MAX_SPEED);
    const ratio = b.speed / Math.hypot(b.vx, b.vy);
    b.vx *= ratio;
    b.vy = -b.vy * ratio;
    // Replace la balle hors de la raquette pour éviter un double contact
    b.y = goingDown ? p.y - r : p.y + PADDLE_H + r;
    play('pong');
  }

  // Avance une balle d'un sous-pas ; renvoie false si elle est sortie (point marqué)
  function stepBall(b, dt) {
    const r = ballR();
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Murs latéraux
    if (b.x - r < 0) { b.x = r; b.vx = Math.abs(b.vx); play('pong'); }
    else if (b.x + r > W) { b.x = W - r; b.vx = -Math.abs(b.vx); play('pong'); }

    // Raquettes (uniquement si la balle se dirige vers elles)
    if (b.vy < 0 && hitsPaddle(b, p1, r)) bounceOffPaddle(b, p1, false, r);
    else if (b.vy > 0 && hitsPaddle(b, p2, r)) bounceOffPaddle(b, p2, true, r);

    // Boucliers : renvoient la balle une fois puis disparaissent
    if (b.vy < 0 && p1.shield && b.y - r <= SHIELD_Y + SHIELD_H) {
      b.vy = Math.abs(b.vy); b.y = SHIELD_Y + SHIELD_H + r; p1.shield = false; play('pong');
    } else if (b.vy > 0 && p2.shield && b.y + r >= H - SHIELD_Y - SHIELD_H) {
      b.vy = -Math.abs(b.vy); b.y = H - SHIELD_Y - SHIELD_H - r; p2.shield = false; play('pong');
    }

    // Buts
    if (b.y + r < 0) { scorePoint(p2, b); return false; }
    if (b.y - r > H) { scorePoint(p1, b); return false; }
    return true;
  }

  function updateBalls(dt) {
    const factor = effect ? SPEED_FACTOR[effect.kind] : 1;
    for (const b of balls.slice()) {
      const move = dt * factor;
      // Sous-pas pour éviter que la balle traverse une raquette à grande vitesse
      const steps = Math.ceil(b.speed * move / (ballR() * 0.8));
      for (let i = 0; i < steps; i++) {
        if (!stepBall(b, move / steps)) break;
        if (state !== 'play') return;          // fin de partie ou nouvel engagement
      }
      b.trail.push({ x: b.x, y: b.y, t: clock });
      while (b.trail.length && clock - b.trail[0].t > TRAIL_TIME) b.trail.shift();
    }
  }

  function update(dt) {
    if (state !== 'serve' && state !== 'play') return;
    clock += dt;
    movePaddle(p1, keys.p1Left, keys.p1Right, dt);
    movePaddle(p2, keys.p2Left, keys.p2Right, dt);
    for (const p of [p1, p2]) p.flash = Math.max(0, p.flash - dt);
    if (effect && (effect.t -= dt) <= 0) effect = null;

    updateGifts(dt);
    updateMissiles(dt);

    if (state === 'serve') {
      serveTimer -= dt;
      if (serveTimer <= 0) launchBalls();
    } else {
      updateBalls(dt);
    }
  }

  // --- Rendu ------------------------------------------------------------
  function drawScores() {
    ctx.font = 'bold 96px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = COLORS.p1;
    ctx.fillText(p1.score, W / 2, H / 4);
    ctx.fillStyle = COLORS.p2;
    ctx.fillText(p2.score, W / 2, H * 3 / 4);
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    ctx.font = '18px "Courier New", monospace';
    ctx.textBaseline = 'bottom';
    if (rally > 0 && state !== 'menu') {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(232,230,255,.4)';
      ctx.fillText(`échange ${rally}`, W - 16, H / 2 - 8);
    }
    if (effect) {
      const def = GIFTS[effect.kind];
      ctx.textAlign = 'left';
      ctx.fillStyle = def.color;
      ctx.fillText(`${def.icon} ${effect.kind === 'fast' ? 'rapide' : 'lent'} ${Math.ceil(effect.t)} s`, 16, H / 2 - 8);
    }
  }

  function drawPlayer(p) {
    if (p.shield) blit(shieldSprite(), W / 2, p === p1 ? SHIELD_Y + SHIELD_H / 2 : H - SHIELD_Y - SHIELD_H / 2);
    // Clignote quand un missile la touche
    ctx.globalAlpha = p.flash > 0 && Math.floor(p.flash * 20) % 2 === 0 ? 0.3 : 1;
    blit(paddleSprite(p), p.cx, p.y + PADDLE_H / 2);
    ctx.globalAlpha = 1;
    const y = missileRestY(p);
    for (const x of missileSlots(p)) blit(missileSprite(p), x, y);
  }

  function drawBalls() {
    const r = ballR();
    for (const b of balls) {
      const trailColor = b.vy < 0 ? COLORS.p2 : COLORS.p1;
      const n = b.trail.length;
      ctx.fillStyle = trailColor;
      for (let i = 0; i < n; i++) {
        const a = (i + 1) / n;
        ctx.globalAlpha = a * 0.35;
        ctx.beginPath();
        ctx.arc(b.trail[i].x, b.trail[i].y, r * a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      blit(ballSprite(r), b.x, b.y);
    }
  }

  function drawServe() {
    if (state !== 'serve' && !(state === 'paused' && pausedFrom === 'serve')) return;
    // Balle qui clignote au centre et flèche vers le joueur qui reçoit
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(serveTimer * 20);
    blit(ballSprite(ballR()), W / 2, H / 2);
    ctx.globalAlpha = 1;
    const color = serveDir > 0 ? COLORS.p2 : COLORS.p1;
    const y = H / 2 + serveDir * 40;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W / 2 - 14, y - serveDir * 10);
    ctx.lineTo(W / 2, y);
    ctx.lineTo(W / 2 + 14, y - serveDir * 10);
    ctx.stroke();
    if (pendingBalls > 1) {
      ctx.font = 'bold 20px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`×${pendingBalls}`, W / 2 + 40, H / 2);
    }
  }

  function draw() {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    drawBackground();
    drawScores();
    drawHud();
    drawPlayer(p1);
    drawPlayer(p2);
    for (const g of gifts) blit(giftSprite(g), g.x, g.y);
    for (const m of missiles) blit(missileSprite(m.owner), m.x, m.y);
    drawServe();
    drawBalls();
  }

  // --- Boucle principale ------------------------------------------------
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05); // plafonné si l'onglet a été inactif
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // Accès pour les tests automatisés (uniquement avec ?debug dans l'adresse)
  if (/[?&]debug\b/.test(location.search)) {
    window.__pong = {
      get state() { return state; }, p1, p2,
      get balls() { return balls; }, get missiles() { return missiles; }, get gifts() { return gifts; },
      get effect() { return effect; }, get bigBall() { return bigBall; }, get pendingBalls() { return pendingBalls; },
      give: (p, type, mult = 2) => applyGift(p, { type, mult }),
      spawnGift: (type, dir, x = W / 2, mult = 2) => gifts.push({ x, y: H / 2, dir, type, mult }),
      fire, played: [],
      // Avance le jeu de n images de 1/60 s, sans attendre l'écran
      step: (n = 1) => { for (let i = 0; i < n; i++) update(1 / 60); draw(); },
    };
    const orig = play;
    play = name => { window.__pong.played.push(name); orig(name); }; // eslint-disable-line no-func-assign
  }

  showOverlay(`Premier à ${WIN_SCORE} points`);
  requestAnimationFrame(loop);
})();
