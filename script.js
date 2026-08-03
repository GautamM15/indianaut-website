/*
  Indianaut — Deep Space
  Shared motion system: living starfield (canvas), scroll reveals, count-ups,
  nav tint, and small progressive-enhancement utilities. Vanilla JS, no deps.
  Everything here is additive: if this file fails to load or throws, the page
  (see style.css) already shows all content in its final, visible state.
*/
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EASE_OUT_EXPO = function (p) { return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p); };

  /* Shared 0..1 loudness of the Indianaut theme, published by the theme
     player's analyser and consumed by the starfield so the stars breathe
     with the music. Stays 0 whenever the theme is not playing. */
  var audioLevel = 0;

  /* ---------------------------------------------------------------------
     Starfield: three depth layers of drifting, twinkling stars behind the
     hero, parallaxed to the pointer / device tilt, joined by thin cosmic-
     blue constellation lines. Paused when hidden or scrolled out of view.
  --------------------------------------------------------------------- */
  function StarField(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = Object.assign({ densityScale: 1, nebula: null }, options);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = 0;
    this.height = 0;
    this.stars = [];
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.running = false;
    this.visible = true;
    this.raf = null;
    this.resizeTimer = null;

    /* Warp: scroll velocity stretches stars into streaks, then settles. */
    this.warp = 0;
    this.warpTarget = 0;
    this.warpDir = 1;
    this.lastScrollY = window.scrollY || 0;

    /* Intro: 1 -> 0 while the field converges into place on first load. */
    this.intro = this.opts.intro ? 1 : 0;
    this.introStart = 0;

    this.layers = [
      { key: 'far', share: 0.5, size: [0.6, 1.3], alpha: [0.2, 0.5], speed: [0.006, 0.016], parallax: 6, link: false },
      { key: 'mid', share: 0.32, size: [1.0, 1.9], alpha: [0.32, 0.68], speed: [0.012, 0.03], parallax: 15, link: true },
      { key: 'near', share: 0.18, size: [1.6, 2.6], alpha: [0.5, 0.9], speed: [0.026, 0.055], parallax: 28, link: true }
    ];

    this._onResize = this._onResize.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onOrientation = this._onOrientation.bind(this);
    this._onScroll = this._onScroll.bind(this);
    this._loop = this._loop.bind(this);

    this._bind();
    this._resize();

    if (reduced) {
      this._drawStatic();
    } else {
      this.start();
    }
  }

  StarField.prototype._bind = function () {
    window.addEventListener('resize', this._onResize, { passive: true });
    if (!reduced) {
      window.addEventListener('pointermove', this._onPointerMove, { passive: true });
      window.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
      if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', this._onOrientation, { passive: true });
      }
      window.addEventListener('scroll', this._onScroll, { passive: true });
    }
  };

  /* Scroll velocity -> warp. Capped so a flick can't blow the effect out. */
  StarField.prototype._onScroll = function () {
    var y = window.scrollY || 0;
    var delta = y - this.lastScrollY;
    this.lastScrollY = y;
    if (delta === 0) return;
    this.warpDir = delta > 0 ? 1 : -1;
    var mag = Math.min(1, Math.abs(delta) / 55);
    if (mag > this.warpTarget) this.warpTarget = mag;
  };

  StarField.prototype._onResize = function () {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(function () {
      this._resize();
      if (reduced) this._drawStatic();
    }.bind(this), 150);
  };

  StarField.prototype._onPointerMove = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    var ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    this.pointer.tx = Math.max(-1, Math.min(1, nx));
    this.pointer.ty = Math.max(-1, Math.min(1, ny));
  };

  StarField.prototype._onPointerLeave = function () {
    this.pointer.tx = 0;
    this.pointer.ty = 0;
  };

  StarField.prototype._onOrientation = function (e) {
    if (e.gamma === null || e.beta === null) return;
    this.pointer.tx = Math.max(-1, Math.min(1, e.gamma / 45));
    this.pointer.ty = Math.max(-1, Math.min(1, (e.beta - 90) / 45));
  };

  StarField.prototype._resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._makeStars();
  };

  StarField.prototype._makeStars = function () {
    var area = this.width * this.height;
    var total = Math.round(Math.max(90, Math.min(160, area / 9000)) * this.opts.densityScale);
    this.stars = [];
    for (var l = 0; l < this.layers.length; l++) {
      var layer = this.layers[l];
      var count = Math.max(4, Math.round(total * layer.share));
      for (var i = 0; i < count; i++) {
        var angle = Math.random() * Math.PI * 2;
        var speed = layer.speed[0] + Math.random() * (layer.speed[1] - layer.speed[0]);
        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          r: layer.size[0] + Math.random() * (layer.size[1] - layer.size[0]),
          baseAlpha: layer.alpha[0] + Math.random() * (layer.alpha[1] - layer.alpha[0]),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          twinkleSpeed: 0.5 + Math.random() * 1.2,
          twinklePhase: Math.random() * Math.PI * 2,
          layer: l,
          parallax: layer.parallax,
          link: layer.link
        });
      }
    }
  };

  StarField.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this._loop);
  };

  StarField.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  };

  StarField.prototype.setVisible = function (isVisible) {
    this.visible = isVisible;
    if (reduced) return;
    if (isVisible && !document.hidden) this.start();
    else this.stop();
  };

  StarField.prototype._loop = function (t) {
    if (!this.running) return;
    this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.06;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.06;

    /* Warp eases toward the latest scroll burst, and the burst itself
       bleeds away, so streaks appear on fast scroll and settle on stop. */
    this.warpTarget *= 0.88;
    if (this.warpTarget < 0.002) this.warpTarget = 0;
    this.warp += (this.warpTarget - this.warp) * 0.16;
    if (this.warp < 0.002) this.warp = 0;

    if (this.intro > 0) {
      if (!this.introStart) this.introStart = t;
      var p = Math.min(1, (t - this.introStart) / 1100);
      this.intro = 1 - EASE_OUT_EXPO(p);
      if (p >= 1) this.intro = 0;
    }

    if (this.opts.nebula) {
      this.opts.nebula.style.setProperty('--nx', (this.pointer.x * 18).toFixed(2) + 'px');
      this.opts.nebula.style.setProperty('--ny', (this.pointer.y * 12).toFixed(2) + 'px');
    }

    this._update(t);
    this._draw();
    this.raf = requestAnimationFrame(this._loop);
  };

  StarField.prototype._update = function (t) {
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      s.x += s.vx;
      s.y += s.vy;
      if (s.x < -10) s.x = this.width + 10;
      if (s.x > this.width + 10) s.x = -10;
      if (s.y < -10) s.y = this.height + 10;
      if (s.y > this.height + 10) s.y = -10;
      s.alpha = s.baseAlpha + Math.sin(t * 0.001 * s.twinkleSpeed + s.twinklePhase) * s.baseAlpha * 0.35;
    }
  };

  /* Per-star offset shared by stars and lines: pointer parallax, plus the
     intro push that lets the field converge inward on first load. */
  StarField.prototype._offset = function (s, axis) {
    var base = (axis === 'x' ? this.pointer.x : this.pointer.y) * s.parallax;
    if (this.intro <= 0) return base;
    var centre = (axis === 'x' ? this.width : this.height) / 2;
    var from = (axis === 'x' ? s.x : s.y) - centre;
    return base + from * this.intro * 0.55;
  };

  StarField.prototype._drawStars = function (ctx) {
    /* Near layers pulse hardest with the music so depth still reads. */
    var pulse = audioLevel;
    var warp = this.warp;
    var fade = 1 - this.intro * 0.75;

    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      var x = s.x + this._offset(s, 'x');
      var y = s.y + this._offset(s, 'y');
      var depth = 0.45 + (s.layer / (this.layers.length - 1)) * 0.55;
      var r = s.r * (1 + pulse * 0.55 * depth);
      var a = Math.max(0, s.alpha * (1 + pulse * 0.5 * depth) * fade);
      if (a <= 0) continue;

      if (warp > 0.03) {
        /* Stretch into a streak along the scroll axis. */
        var len = warp * 46 * depth;
        ctx.strokeStyle = 'rgba(255,255,255,' + Math.min(1, a).toFixed(3) + ')';
        ctx.lineWidth = r * 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - this.warpDir * len);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, a).toFixed(3) + ')';
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  StarField.prototype._drawLines = function (ctx) {
    var linkStars = [];
    for (var i = 0; i < this.stars.length; i++) {
      if (this.stars[i].link) linkStars.push(this.stars[i]);
    }
    var maxDist = 118;
    /* Lines dissolve while warping (they would smear) and while the field
       is still converging; they brighten a little with the music. */
    var gain = (1 - Math.min(1, this.warp * 1.6)) * (1 - this.intro) * (1 + audioLevel * 0.6);
    if (gain <= 0.01) return;

    var i, j, a, b, ax, ay, bx, by, dx, dy, dist, op;
    for (i = 0; i < linkStars.length; i++) {
      a = linkStars[i];
      ax = a.x + this._offset(a, 'x');
      ay = a.y + this._offset(a, 'y');
      for (j = i + 1; j < linkStars.length; j++) {
        b = linkStars[j];
        bx = b.x + this._offset(b, 'x');
        by = b.y + this._offset(b, 'y');
        dx = ax - bx; dy = ay - by;
        dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist) {
          op = (1 - dist / maxDist) * 0.32 * gain;
          ctx.strokeStyle = 'rgba(137,166,255,' + op.toFixed(3) + ')';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
    }

    if (this.pointer.tx !== 0 || this.pointer.ty !== 0) {
      var px = ((this.pointer.x + 1) / 2) * this.width;
      var py = ((this.pointer.y + 1) / 2) * this.height;
      var cursorRadius = 200;
      for (i = 0; i < linkStars.length; i++) {
        var s = linkStars[i];
        var sx = s.x + this._offset(s, 'x');
        var sy = s.y + this._offset(s, 'y');
        var cdx = sx - px, cdy = sy - py;
        var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
        if (cdist < cursorRadius) {
          var cop = (1 - cdist / cursorRadius) * 0.55 * gain;
          ctx.strokeStyle = 'rgba(175,195,255,' + cop.toFixed(3) + ')';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
      }
    }
  };

  StarField.prototype._draw = function () {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this._drawLines(ctx);
    this._drawStars(ctx);
  };

  StarField.prototype._drawStatic = function () {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    for (var i = 0; i < this.stars.length; i++) this.stars[i].alpha = this.stars[i].baseAlpha;
    this._drawLines(ctx);
    this._drawStars(ctx);
  };

  /* ---------------------------------------------------------------------
     Carousels
     Two behaviours, chosen per content type:
       marquee  - continuous drift. Slides are cloned once so the loop is
                  seamless. Used for episode thumbnails (cheap images).
       advance  - a native scroll-snap scroller stepped on a timer. Used for
                  the Substack embeds, because cloning four third-party
                  iframes would double the network and DOM cost.
     Both pause on hover/focus/touch and stop entirely when off-screen.
  --------------------------------------------------------------------- */
  function initCarousel(root) {
    var track = root.querySelector('[data-carousel-track]');
    if (!track) return;
    var mode = root.getAttribute('data-carousel');
    var paused = false;
    var visible = true;

    var hold = function () { paused = true; };
    var release = function () { paused = false; };
    root.addEventListener('mouseenter', hold);
    root.addEventListener('mouseleave', release);
    root.addEventListener('focusin', hold);
    root.addEventListener('focusout', release);
    root.addEventListener('touchstart', hold, { passive: true });
    root.addEventListener('touchend', release, { passive: true });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { visible = e.isIntersecting; });
      }, { threshold: 0 }).observe(root);
    }

    if (mode === 'marquee') {
      if (reduced) { track.style.overflowX = 'auto'; return; }
      var originals = [].slice.call(track.children);
      if (!originals.length) return;
      // Clone once for a seamless wrap. Clones are inert for assistive tech.
      originals.forEach(function (node) {
        var c = node.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        c.setAttribute('tabindex', '-1');
        track.appendChild(c);
      });
      var speed = parseFloat(root.getAttribute('data-speed')) || 40; // px/sec
      var offset = 0;
      var last = 0;
      var half = 0;
      var measure = function () {
        half = track.scrollWidth / 2;
      };
      measure();
      window.addEventListener('resize', measure);
      // Images arrive late and change the width; re-measure when they do.
      track.querySelectorAll('img').forEach(function (img) {
        if (!img.complete) img.addEventListener('load', measure, { once: true });
      });

      var step = function (now) {
        if (!last) last = now;
        var dt = (now - last) / 1000;
        last = now;
        if (!paused && visible && half > 0) {
          offset += speed * dt;
          if (offset >= half) offset -= half;
          track.style.transform = 'translate3d(' + (-offset) + 'px,0,0)';
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      return;
    }

    if (mode === 'advance') {
      var slides = [].slice.call(track.children);
      if (slides.length < 2) return;

      // Progress dots double as manual controls.
      var dots = document.createElement('div');
      dots.className = 'carousel-dots';
      slides.forEach(function (_, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'carousel-dot' + (i === 0 ? ' is-active' : '');
        b.setAttribute('aria-label', 'Show article ' + (i + 1) + ' of ' + slides.length);
        b.addEventListener('click', function () { goTo(i); });
        dots.appendChild(b);
      });
      root.appendChild(dots);

      var index = 0;
      var syncDots = function () {
        [].forEach.call(dots.children, function (d, i) {
          d.classList.toggle('is-active', i === index);
        });
      };
      var goTo = function (i) {
        index = (i + slides.length) % slides.length;
        var target = slides[index];
        track.scrollTo({
          left: target.offsetLeft - (track.clientWidth - target.clientWidth) / 2,
          behavior: reduced ? 'auto' : 'smooth'
        });
        syncDots();
      };
      // Keep dots honest when the visitor swipes manually.
      var settle;
      track.addEventListener('scroll', function () {
        clearTimeout(settle);
        settle = setTimeout(function () {
          var mid = track.scrollLeft + track.clientWidth / 2;
          var nearest = 0;
          var best = Infinity;
          slides.forEach(function (s, i) {
            var d = Math.abs(s.offsetLeft + s.clientWidth / 2 - mid);
            if (d < best) { best = d; nearest = i; }
          });
          index = nearest;
          syncDots();
        }, 140);
      }, { passive: true });

      if (reduced) return; // manual only
      var interval = parseInt(root.getAttribute('data-interval'), 10) || 5000;
      setInterval(function () {
        if (!paused && visible && !document.hidden) goTo(index + 1);
      }, interval);
    }
  }

  /* ---------------------------------------------------------------------
     Theme player
     Browsers block audio-with-sound until the visitor interacts with the
     page, so autoplay is attempted and, if refused, armed to start on the
     first gesture instead. Playback position and paused state ride in
     sessionStorage so the theme continues across the two pages.
  --------------------------------------------------------------------- */
  function initThemePlayer() {
    var KEY_TIME = 'indianaut:themeTime';
    var KEY_OFF = 'indianaut:themeOff';
    var store = null;
    try { store = window.sessionStorage; } catch (e) { store = null; }
    var read = function (k) { try { return store && store.getItem(k); } catch (e) { return null; } };
    var write = function (k, v) { try { store && store.setItem(k, v); } catch (e) {} };

    var audio = new Audio('theme.mp3');
    audio.loop = true;
    audio.preload = 'auto';
    var resumeAt = parseFloat(read(KEY_TIME));
    if (!isNaN(resumeAt) && resumeAt > 0) {
      audio.addEventListener('loadedmetadata', function () {
        if (resumeAt < audio.duration) audio.currentTime = resumeAt;
      }, { once: true });
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-player';
    btn.innerHTML =
      '<span class="theme-player-icon" aria-hidden="true">' +
        '<svg class="theme-glyph theme-glyph--play" viewBox="0 0 12 12"><path d="M4 2.5 L9 6 L4 9.5 Z" fill="currentColor"/></svg>' +
        '<svg class="theme-glyph theme-glyph--pause" viewBox="0 0 12 12"><rect x="3.5" y="2.5" width="2" height="7" fill="currentColor"/><rect x="6.5" y="2.5" width="2" height="7" fill="currentColor"/></svg>' +
        '<span class="theme-eq"><span></span><span></span><span></span></span>' +
      '</span>' +
      '<span class="theme-player-label"></span>';
    var label = btn.querySelector('.theme-player-label');

    var paint = function (playing, awaiting) {
      btn.classList.toggle('is-playing', playing);
      btn.classList.toggle('is-awaiting', !!awaiting);
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      var text = playing ? 'Pause theme' : 'Play theme';
      btn.setAttribute('aria-label', text);
      btn.title = text;
      // Standard, constant label; the icon (triangle vs bars) carries state.
      label.textContent = 'Theme';
    };
    paint(false, false);
    document.body.appendChild(btn);

    /* Web Audio analyser -> audioLevel, so the starfield breathes with the
       theme. Built lazily on first play (an AudioContext created before a
       gesture starts suspended) and wired through to the speakers, since a
       MediaElementSource re-routes the element's output. */
    var analyser = null;
    var bins = null;
    var meterRaf = null;
    function buildAnalyser() {
      if (analyser) return;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        var actx = new Ctx();
        var src = actx.createMediaElementSource(audio);
        analyser = actx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;
        src.connect(analyser);
        analyser.connect(actx.destination);
        bins = new Uint8Array(analyser.frequencyBinCount);
        if (actx.state === 'suspended') actx.resume();
      } catch (e) {
        analyser = null; // unsupported or already-tapped element: fail quiet
      }
    }
    function meter() {
      if (!analyser || audio.paused) { audioLevel = 0; meterRaf = null; return; }
      analyser.getByteFrequencyData(bins);
      var sum = 0;
      for (var i = 0; i < bins.length; i++) sum += bins[i];
      var avg = (sum / bins.length) / 255;
      audioLevel += (Math.min(1, avg * 1.6) - audioLevel) * 0.25;
      meterRaf = requestAnimationFrame(meter);
    }

    audio.addEventListener('timeupdate', function () {
      write(KEY_TIME, String(audio.currentTime));
    });
    audio.addEventListener('play', function () {
      paint(true, false);
      buildAnalyser();
      if (!meterRaf) meterRaf = requestAnimationFrame(meter);
    });
    audio.addEventListener('pause', function () {
      paint(false, false);
      audioLevel = 0;
    });

    /* Autoplay is armed to start on the first page gesture. The button
       handles its OWN taps (via click), so armGo ignores gestures that
       originate on it — otherwise a tap would both arm-play and then
       toggle-pause on the same interaction (the mobile "does nothing" bug). */
    var armEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    var armGo = function (e) {
      if (e && e.target && btn.contains(e.target)) return;
      startPlaying();
    };
    function arm() { armEvents.forEach(function (ev) { window.addEventListener(ev, armGo, { passive: true }); }); }
    function disarm() { armEvents.forEach(function (ev) { window.removeEventListener(ev, armGo); }); }

    function startPlaying() {
      write(KEY_OFF, '0');
      disarm();
      var pr = audio.play();
      if (pr && typeof pr.then === 'function') {
        pr.then(function () { paint(true, false); })
          .catch(function () { paint(false, true); arm(); });
      }
    }
    function stopPlaying() {
      write(KEY_OFF, '1');
      disarm();
      audio.pause();
      paint(false, false);
    }

    btn.addEventListener('click', function () {
      if (audio.paused) startPlaying(); else stopPlaying();
    });

    // Honour an explicit pause from a previous page; otherwise try to start.
    if (read(KEY_OFF) === '1') {
      paint(false, false);
      return;
    }
    var attempt = audio.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(function () {
        paint(true, false);
      }).catch(function () {
        paint(false, true); // blocked by autoplay policy — wait for a gesture
        arm();
      });
    } else {
      arm();
    }
  }

  /* ---------------------------------------------------------------------
     Rocket scroll-progress: the logo's rocket climbs a hairline rail as the
     page advances, trailing the distance already covered.
  --------------------------------------------------------------------- */
  function initScrollRocket() {
    var rail = document.createElement('div');
    rail.className = 'scroll-rail';
    rail.setAttribute('aria-hidden', 'true');
    rail.innerHTML =
      '<span class="scroll-rail-trail"></span>' +
      '<span class="scroll-rail-rocket">' +
        '<svg viewBox="0 0 16 22">' +
          '<path d="M8 0c2.6 2.4 4 5.6 4 9v6H4V9c0-3.4 1.4-6.6 4-9z" fill="currentColor"/>' +
          '<circle cx="8" cy="7" r="1.9" fill="var(--space)"/>' +
          '<path d="M4 10 1 14v3l3-2zM12 10l3 4v3l-3-2z" fill="currentColor" opacity=".75"/>' +
          '<path class="scroll-rail-flame" d="M6.4 15h3.2l-1.6 4z" fill="var(--saffron)"/>' +
        '</svg>' +
      '</span>';
    document.body.appendChild(rail);

    var trail = rail.querySelector('.scroll-rail-trail');
    var rocket = rail.querySelector('.scroll-rail-rocket');
    var ticking = false;

    function paint() {
      ticking = false;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      // 0% = bottom of the rail, 100% = top: the rocket ascends as you read.
      trail.style.transform = 'scaleY(' + p.toFixed(4) + ')';
      rocket.style.transform = 'translateY(' + (-p * 100).toFixed(2) + '%)';
      rail.classList.toggle('is-lit', p > 0.01);
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(paint); }
    }, { passive: true });
    window.addEventListener('resize', paint, { passive: true });
    paint();
  }

  /* ---------------------------------------------------------------------
     Cursor torch + film grain. Torch is pointer-driven, so it is skipped on
     touch/coarse pointers and when motion is reduced.
  --------------------------------------------------------------------- */
  function initAtmosphere() {
    var grain = document.createElement('div');
    grain.className = 'grain';
    grain.setAttribute('aria-hidden', 'true');
    document.body.appendChild(grain);

    var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!fine || reduced) return;

    var torch = document.createElement('div');
    torch.className = 'torch';
    torch.setAttribute('aria-hidden', 'true');
    document.body.appendChild(torch);

    var tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    var cx = tx, cy = ty, queued = false;
    window.addEventListener('pointermove', function (e) {
      tx = e.clientX; ty = e.clientY;
      if (!queued) { queued = true; requestAnimationFrame(follow); }
    }, { passive: true });
    function follow() {
      queued = false;
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      torch.style.transform = 'translate3d(' + (cx - 260) + 'px,' + (cy - 260) + 'px,0)';
      if (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) {
        queued = true;
        requestAnimationFrame(follow);
      }
    }
    follow();
  }

  /* ---------------------------------------------------------------------
     Boot
  --------------------------------------------------------------------- */
  function init() {
    /* Marks the document as JS-enabled. CSS only hides .reveal elements
       inside .js, so if this script fails to load or throws, content
       (already opacity:1 by default) stays fully visible. */
    document.documentElement.classList.add('js');

    /* Carousels and the theme player are set up before any reduced-motion
       early-return below: audio is not motion, and the carousels stay
       usable (manually scrollable) even when motion is reduced. */
    document.querySelectorAll('[data-carousel]').forEach(initCarousel);
    initThemePlayer();
    initScrollRocket();
    initAtmosphere();

    /* Cinematic arrival: the field converges and the logo resolves, once per
       session. Any input cuts it short, and reduced motion skips it. */
    var firstVisit = false;
    try {
      firstVisit = !reduced && !window.sessionStorage.getItem('indianaut:arrived');
      if (firstVisit) window.sessionStorage.setItem('indianaut:arrived', '1');
    } catch (e) { firstVisit = false; }
    if (firstVisit) {
      var root = document.documentElement;
      root.classList.add('is-arriving');
      var endIntro = function () { root.classList.remove('is-arriving'); };
      window.setTimeout(endIntro, 1300);
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
        window.addEventListener(ev, endIntro, { once: true, passive: true });
      });
    }

    /* Nav tint on scroll */
    var nav = document.querySelector('.site-nav');
    if (nav) {
      var onScroll = function () {
        nav.classList.toggle('is-scrolled', window.scrollY > 20);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    /* Starfield */
    var canvas = document.querySelector('[data-starfield]');
    var hero = document.querySelector('.hero');
    var field = null;
    if (canvas && hero) {
      field = new StarField(canvas, {
        densityScale: canvas.getAttribute('data-density-scale') ? parseFloat(canvas.getAttribute('data-density-scale')) : 1,
        nebula: document.querySelector('.nebula'),
        intro: firstVisit
      });

      /* The field is a page-wide fixed backdrop now, so it stays running for
         the whole document and only stops when the tab is hidden. */
      document.addEventListener('visibilitychange', function () {
        field.setVisible(!document.hidden);
      });
    }

    /* Hero scene parallax: nebula + starfield drift slower than the page
       as the visitor scrolls past the hero, fading gently underneath it. */
    var heroScene = document.querySelector('.hero-scene');
    if (heroScene && hero && !reduced) {
      var sceneTicking = false;
      var updateHeroParallax = function () {
        var y = window.scrollY;
        var heroHeight = hero.offsetHeight || window.innerHeight;
        var progress = Math.min(y / heroHeight, 1);
        /* Bounded drift: the backdrop is fixed, so the offset settles instead
           of running off-screen. It also dims to a floor behind content. */
        heroScene.style.transform = 'translate3d(0,' + (progress * 60).toFixed(1) + 'px,0)';
        heroScene.style.opacity = String(1 - progress * 0.55);
        sceneTicking = false;
      };
      window.addEventListener('scroll', function () {
        if (!sceneTicking) {
          sceneTicking = true;
          requestAnimationFrame(updateHeroParallax);
        }
      }, { passive: true });
      updateHeroParallax();
    }

    /* Video thumbnail fallback (maxresdefault -> hqdefault) */
    var thumbs = document.querySelectorAll('img[data-fallback]');
    thumbs.forEach(function (img) {
      img.addEventListener('error', function onError() {
        img.removeEventListener('error', onError);
        img.src = img.getAttribute('data-fallback');
      });
    });

    /* Count-up */
    function paintCount(el, value) {
      el.textContent = value.toLocaleString('en-US') + (el.getAttribute('data-suffix') || '');
    }

    function animateCount(el) {
      var target = parseInt(el.getAttribute('data-count-to'), 10);
      if (isNaN(target)) return;
      var duration = 1500;
      var start = null;
      function tick(now) {
        if (start === null) start = now;
        var p = Math.min((now - start) / duration, 1);
        paintCount(el, Math.round(target * EASE_OUT_EXPO(p)));
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    /* Scroll reveal */
    var revealEls = document.querySelectorAll('.reveal');

    if (reduced) {
      revealEls.forEach(function (el) { el.classList.add('in-view'); });
      document.querySelectorAll('[data-count-to]').forEach(function (el) {
        paintCount(el, parseInt(el.getAttribute('data-count-to'), 10));
      });
      return;
    }

    document.querySelectorAll('[data-count-to]').forEach(function (el) { paintCount(el, 0); });

    if (!('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('in-view'); });
      document.querySelectorAll('[data-count-to]').forEach(function (el) { animateCount(el); });
      return;
    }

    /* Counters that live outside a .reveal (the hero stats, which enter via
       CSS keyframes) are never visited by the observer below, so they would
       stay painted at 0. Animate them on load, timed to land with the hero. */
    [].filter.call(document.querySelectorAll('[data-count-to]'), function (el) {
      return !el.closest('.reveal');
    }).forEach(function (el) {
      window.setTimeout(function () { animateCount(el); }, 700);
    });

    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in-view');
        revealObserver.unobserve(entry.target);
        var counters = entry.target.hasAttribute('data-count-to')
          ? [entry.target]
          : entry.target.querySelectorAll('[data-count-to]');
        counters.forEach(function (el) { animateCount(el); });
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });

    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
