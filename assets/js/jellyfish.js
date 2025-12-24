/* ==========================================================================
   Jellyfish background canvas animation (wander + buoyancy, stateful)
   ========================================================================== */
(function() {
  'use strict';

  var storageKey = 'jellyfish-state-v1';
  var seedKey = 'jellyfish-seed';
  var imgSrc = '/images/jellyfish.svg';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion && reduceMotion.matches) {
    return;
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seedStr) {
    var state = hashString(seedStr) || 1;
    return function() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) / 4294967296);
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveState(data) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (e) {
      // ignore
    }
  }

  function getSeed() {
    try {
      var stored = localStorage.getItem(seedKey);
      if (stored) return stored;
      var s = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(seedKey, s);
      return s;
    } catch (e) {
      return Math.random().toString(36).slice(2, 10);
    }
  }

  var SPRITE_UP_OFFSET = Math.PI / 2; // align image "up" to motion direction

  function Jelly(rng, state, sizeOverride, variant) {
    this.rng = rng;
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.sizePx = typeof sizeOverride === 'number' ? sizeOverride : (70 + rng() * 80);
    this.maxSpeed = 12 + rng() * 10; // slower
    this.maxForce = 3.5 + rng() * 1.5;
    this.maxTurn = 0.45; // rad/s
    this.minSpeed = 4 + rng() * 3;
    this.wrapPadding = 80; // smaller so re-entry is faster
    this.lastAngle = 0;
    this.targetAngle = 0;
    this.targetSpeed = 0;
    this.courseTimer = 0;
    this.courseDuration = 0;
    this.swimPhase = 0;
    this.swimSpeed = 0.5 + rng() * 0.35;
    this.swayAmp = 0.05;   // lateral sway
    this.rollAmp = 0.03;   // roll amount
    this.pulsePhase = rng() * Math.PI * 2;
    this.pulseFreq = 0.3 + rng() * 0.5; // Hz
    this.tentaclePhase = rng() * Math.PI * 2;
    this.tentacleFreq = 0.8 + rng() * 0.4;

    // Variant tweaks to diversify two jellies
    if (variant === 1) {
      this.swimSpeed *= 0.9;
      this.pulseFreq *= 1.1;
    }

    if (state) {
      this.pos.x = state.x;
      this.pos.y = state.y;
      this.vel.x = state.vx;
      this.vel.y = state.vy;
      this.lastAngle = state.angle || 0;
      this.targetAngle = typeof state.targetAngle === 'number' ? state.targetAngle : this.lastAngle;
      this.targetSpeed = typeof state.targetSpeed === 'number' ? state.targetSpeed : this.maxSpeed * 0.6;
      this.courseTimer = typeof state.courseTimer === 'number' ? state.courseTimer : 0;
      this.courseDuration = typeof state.courseDuration === 'number' ? state.courseDuration : 0;
      this.swimPhase = state.swimPhase || 0;
      this.pulsePhase = state.pulsePhase || this.pulsePhase;
      this.tentaclePhase = state.tentaclePhase || this.tentaclePhase;
    } else {
      this.spawn();
      this.pickCourse(true);
    }
  }

  Jelly.prototype.spawn = function() {
    var side = Math.floor(this.rng() * 4);
    switch (side) {
      case 0:
        this.pos.x = -this.wrapPadding;
        this.pos.y = this.rng() * window.innerHeight;
        break;
      case 1:
        this.pos.x = window.innerWidth + this.wrapPadding;
        this.pos.y = this.rng() * window.innerHeight;
        break;
      case 2:
        this.pos.x = this.rng() * window.innerWidth;
        this.pos.y = window.innerHeight + this.wrapPadding;
        break;
      default:
        this.pos.x = this.rng() * window.innerWidth;
        this.pos.y = -this.wrapPadding;
        break;
    }
    // random heading for entry
    var heading = this.rng() * Math.PI * 2;
    this.vel.x = Math.cos(heading);
    this.vel.y = Math.sin(heading);
    this.setSpeed(this.maxSpeed * 0.6); // slightly higher entry speed to reappear sooner
    this.lastAngle = heading;
  };

  Jelly.prototype.setSpeed = function(speed) {
    var len = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y) || 1;
    this.vel.x = (this.vel.x / len) * speed;
    this.vel.y = (this.vel.y / len) * speed;
  };

  Jelly.prototype.pickCourse = function(force) {
    var baseDirections = Math.floor(this.rng() * 8); // 8-way base directions
    var baseAngle = baseDirections * (Math.PI / 4);
    var jitter = (this.rng() - 0.5) * (Math.PI / 3);
    this.targetAngle = baseAngle + jitter;
    var speedRange = this.maxSpeed - this.minSpeed;
    this.targetSpeed = this.minSpeed + speedRange * this.rng();
    this.targetSpeed = Math.max(this.minSpeed, Math.min(this.maxSpeed, this.targetSpeed));
    // longer courses make turning feel more leisurely
    this.courseDuration = 10 + this.rng() * 6; // seconds
    this.courseTimer = 0;
    if (force) {
      this.lastAngle = this.targetAngle;
      this.vel.x = Math.cos(this.targetAngle) * this.targetSpeed;
      this.vel.y = Math.sin(this.targetAngle) * this.targetSpeed;
    }
  };

  Jelly.prototype.update = function(dt, bounds) {
    this.courseTimer += dt;
    if (!this.courseDuration || this.courseTimer >= this.courseDuration) {
      this.pickCourse();
    }

    var desired = this.targetAngle;
    var diff = desired - this.lastAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    var maxStep = this.maxTurn * dt;
    if (diff > maxStep) diff = maxStep;
    if (diff < -maxStep) diff = -maxStep;
    this.lastAngle += diff;

    var currentSpeed = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
    if (!currentSpeed || currentSpeed < 0.01) currentSpeed = this.minSpeed;
    var speedDiff = this.targetSpeed - currentSpeed;
    var speedStep = this.maxForce * dt;
    if (speedDiff > speedStep) speedDiff = speedStep;
    if (speedDiff < -speedStep) speedDiff = -speedStep;
    currentSpeed = Math.max(this.minSpeed, Math.min(this.maxSpeed, currentSpeed + speedDiff));

    this.vel.x = Math.cos(this.lastAngle) * currentSpeed;
    this.vel.y = Math.sin(this.lastAngle) * currentSpeed;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    var pad = this.wrapPadding;
    if (this.pos.x < -pad) this.pos.x = bounds.width + pad;
    if (this.pos.x > bounds.width + pad) this.pos.x = -pad;
    if (this.pos.y < -pad) this.pos.y = bounds.height + pad;
    if (this.pos.y > bounds.height + pad) this.pos.y = -pad;

    this.swimPhase += dt * this.swimSpeed * Math.PI * 2;
    this.pulsePhase += dt * this.pulseFreq * Math.PI * 2;
    this.tentaclePhase += dt * this.tentacleFreq * Math.PI * 2;
  };

  Jelly.prototype.draw = function(ctx, img) {
    if (!img.complete) return;
    var w = this.sizePx;
    var h = this.sizePx * (img.naturalHeight / img.naturalWidth || 1.0);
    var sway = Math.sin(this.swimPhase) * this.swayAmp;
    var roll = 1 + Math.sin(this.swimPhase * 2) * this.rollAmp;
    var pulseMag = Math.sin(this.pulsePhase) * 0.10; // 脉动幅度，偏纵向
    var scaleX = roll * (1 + pulseMag * 0.3);
    var scaleY = (1 / roll) * (1 + pulseMag);
    var tentacleShear = Math.sin(this.tentaclePhase) * 0.06;

    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.lastAngle + sway + SPRITE_UP_OFFSET);
    ctx.scale(scaleX, scaleY);
    ctx.transform(1, tentacleShear, 0, 1, 0, 0); // slight shear to mimic tentacle sway
    ctx.drawImage(img, -w * 0.5, -h * 0.5, w, h);
    ctx.restore();
  };

  function init() {
    var canvas = document.getElementById('jelly-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'jelly-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(canvas, document.body.firstChild);
    }

    var ctx = canvas.getContext('2d');
    var img = new Image();
    img.src = imgSrc;

    function resize() {
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    var baseSeed = getSeed();
    var saved = loadState();

    var jellyCount = 1;

    var savedArray = Array.isArray(saved) ? saved : (saved ? [saved] : []);
    var jellies = [];
    var sharedSizeRng = makeRng(baseSeed + '-size');
    var sharedSize = 70 + sharedSizeRng() * 80;
    for (var i = 0; i < jellyCount; i++) {
      var jellyRng = makeRng(baseSeed + '-' + i);
      jellies.push(new Jelly(jellyRng, savedArray[i], sharedSize, i % 2));
    }

    function persist() {
      var data = jellies.map(function(j) {
        return {
          x: j.pos.x,
          y: j.pos.y,
          vx: j.vel.x,
          vy: j.vel.y,
          angle: j.lastAngle,
          targetAngle: j.targetAngle,
          targetSpeed: j.targetSpeed,
          courseTimer: j.courseTimer,
          courseDuration: j.courseDuration,
          swimPhase: j.swimPhase,
          pulsePhase: j.pulsePhase,
          tentaclePhase: j.tentaclePhase
        };
      });
      saveState(data);
    }

    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        persist();
      }
    });
    window.addEventListener('beforeunload', persist);

    var last = performance.now();
    function frame(now) {
      var dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var i = 0; i < jellies.length; i++) {
        jellies[i].update(dt, { width: window.innerWidth, height: window.innerHeight });
        jellies[i].draw(ctx, img);
      }
      requestAnimationFrame(frame);
    }

    if (img.complete) {
      requestAnimationFrame(frame);
    } else {
      img.onload = function() {
        requestAnimationFrame(frame);
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
