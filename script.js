/* ==========================================================================
   MDC — Links
   Vanilla JS: wind particles, circular avatar visualizer, music + beat map,
   typewriter, reveal-on-scroll, link send animations, bfcache recovery.
   ========================================================================== */

(function () {
  "use strict";

  var root = document.documentElement;

  /* ------------------------------------------------------------------------
     Performance tier
     ------------------------------------------------------------------------ */

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var cores = Number(navigator.hardwareConcurrency) || 2;
  var memory = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : 4;
  var tier = "low";

  if (!reduceMotion) {
    if (cores >= 8 && memory >= 8) tier = "high";
    else if (cores >= 4 && memory >= 4) tier = "mid";
  }

  root.classList.add("tier-" + tier);

  var SETTINGS = {
    high: { dpr: 2, wind: 56, vizFps: 60, nameSpeed: 150, bioSpeed: 20, beatMap: true, glow: true },
    mid: { dpr: 1.5, wind: 30, vizFps: 60, nameSpeed: 135, bioSpeed: 18, beatMap: true, glow: true },
    low: { dpr: 1.2, wind: 0, vizFps: 30, nameSpeed: 0, bioSpeed: 0, beatMap: false, glow: false }
  }[tier];

  var TAU = Math.PI * 2;
  var audio = document.getElementById("bg-music");
  var npBtn = document.getElementById("np-btn");
  var npSub = document.getElementById("np-sub");
  var musicPanel = document.getElementById("music-panel");
  var mpClose = document.getElementById("mp-close");
  var playBtn = document.getElementById("mp-play");
  var muteBtn = document.getElementById("mp-mute");
  var volumeEl = document.getElementById("mp-volume");
  var statusEl = document.getElementById("mp-status");

  var musicStarted = false;
  var panelOpen = false;
  var audioCtx = null;
  var analyser = null;
  var freqData = null;
  var volumeGain = null;
  var analyserSetup = false;
  var volumeLevel = 0.8;
  var mutedState = false;

  /* ------------------------------------------------------------------------
     Tiny helpers
     ------------------------------------------------------------------------ */

  function safePlay() {
    if (!audio) return Promise.resolve();
    try {
      var result = audio.play();
      return result && typeof result.catch === "function" ? result.catch(function () {}) : Promise.resolve();
    } catch (err) {
      return Promise.resolve();
    }
  }

  function isPlaying() {
    return !!audio && !audio.paused && !audio.ended;
  }

  function debounce(fn, wait) {
    var timer = 0;
    return function () {
      clearTimeout(timer);
      timer = window.setTimeout(fn, wait);
    };
  }

  /* ------------------------------------------------------------------------
     Avatar fallback
     ------------------------------------------------------------------------ */

  var avatarImg = document.getElementById("avatar-img");
  if (avatarImg) {
    avatarImg.addEventListener("error", function () {
      avatarImg.classList.add("is-broken");
    }, { once: true });
    if (avatarImg.complete && avatarImg.naturalWidth === 0) {
      avatarImg.classList.add("is-broken");
    }
  }

  /* ------------------------------------------------------------------------
     Typewriter
     ------------------------------------------------------------------------ */

  var nameEl = document.getElementById("typed-name");
  var bioEl = document.getElementById("typed-bio");
  var caret = document.querySelector(".caret");
  var typingTimers = [];

  function clearTypingTimers() {
    for (var i = 0; i < typingTimers.length; i += 1) clearTimeout(typingTimers[i]);
    typingTimers = [];
  }

  function typeInto(el, text, speed, done) {
    el.textContent = "";
    if (!speed) {
      el.textContent = text;
      if (done) done();
      return;
    }
    var index = 0;
    function step() {
      if (index < text.length) {
        el.textContent = text.slice(0, index + 1);
        index += 1;
        typingTimers.push(window.setTimeout(step, speed * (0.72 + Math.random() * 0.5)));
      } else if (done) {
        done();
      }
    }
    step();
  }

  function startTyping() {
    if (!nameEl || !bioEl) return;
    clearTypingTimers();
    var name = nameEl.getAttribute("data-text") || "MDC";
    var bio = bioEl.getAttribute("data-text") || "";
    if (caret) caret.classList.remove("is-done");
    nameEl.textContent = "";
    bioEl.textContent = "";

    if (!SETTINGS.nameSpeed) {
      nameEl.textContent = name;
      bioEl.textContent = bio;
      if (caret) caret.classList.add("is-done");
      return;
    }

    typeInto(nameEl, name, SETTINGS.nameSpeed, function () {
      typingTimers.push(window.setTimeout(function () {
        typeInto(bioEl, bio, SETTINGS.bioSpeed, function () {
          if (caret) caret.classList.add("is-done");
        });
      }, 240));
    });
  }

  var entranceEls = [
    document.querySelector(".avatar-wrap"),
    document.querySelector(".hero-name"),
    document.querySelector(".hero-bio"),
    document.querySelector(".scroll-hint")
  ].filter(Boolean);

  function restartEntrance() {
    for (var i = 0; i < entranceEls.length; i += 1) entranceEls[i].style.animation = "none";
    void document.body.offsetWidth;
    for (var j = 0; j < entranceEls.length; j += 1) entranceEls[j].style.animation = "";
    startTyping();
  }

  /* ------------------------------------------------------------------------
     Reveal on scroll
     ------------------------------------------------------------------------ */

  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  function revealAll() {
    for (var i = 0; i < revealEls.length; i += 1) revealEls[i].classList.add("is-visible");
  }

  function setupReveal() {
    if (!SETTINGS.nameSpeed || !("IntersectionObserver" in window)) {
      revealAll();
      return;
    }
    root.classList.add("reveal-ready");
    var observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i += 1) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add("is-visible");
          observer.unobserve(entries[i].target);
        }
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.08 });

    for (var j = 0; j < revealEls.length; j += 1) observer.observe(revealEls[j]);
  }

  /* ------------------------------------------------------------------------
     Shared intensity state
     ------------------------------------------------------------------------ */

  var intensity = 0.16;
  var beats = [];
  var beatIndex = -1;
  var lastAudioTime = 0;
  var vizVisible = true;
  var spectrumActive = false;

  function updateIntensity(dt) {
    var playing = isPlaying() && audio.readyState >= 2;
    var time = audio ? audio.currentTime : 0;
    var breath = 0.5 + 0.5 * Math.sin(performance.now() * 0.0016);
    var target = 0.18 + breath * 0.14;
    var i;
    spectrumActive = false;

    if (playing && analyser && freqData) {
      analyser.getByteFrequencyData(freqData);
      var bassEnd = Math.max(8, Math.round(freqData.length * 0.06));
      var bass = 0;
      var total = 0;
      for (i = 0; i < freqData.length; i += 1) {
        var value = freqData[i] / 255;
        total += value;
        if (i < bassEnd) bass += value;
      }
      bass /= bassEnd;
      total /= freqData.length;
      target = 0.18 + bass * 0.62 + total * 0.24;
      spectrumActive = true;
    } else if (playing && beats.length) {
      if (time + 0.05 < lastAudioTime) beatIndex = -1;
      lastAudioTime = time;
      var beat = 0;
      while (beatIndex + 1 < beats.length && beats[beatIndex + 1].t <= time) beatIndex += 1;
      if (beatIndex >= 0) {
        var age = time - beats[beatIndex].t;
        if (age >= 0 && age < 0.6) beat = beats[beatIndex].e * Math.exp(-age * 6.5);
      }
      target = 0.12 + breath * 0.06 + beat * 0.86;
    } else {
      lastAudioTime = time;
    }

    var smoothing = 1 - Math.exp(-Math.max(0.5, dt) / (target > intensity ? 60 : 180));
    intensity += (target - intensity) * smoothing;
    if (intensity < 0.02) intensity = 0.02;
    if (intensity > 1) intensity = 1;
  }

  /* ------------------------------------------------------------------------
     Wind particles
     ------------------------------------------------------------------------ */

  var windCanvas = document.getElementById("wind");
  var windCtx = windCanvas ? windCanvas.getContext("2d", { alpha: true }) : null;
  var windW = 0;
  var windH = 0;
  var windParticles = [];
  var windDust = [];
  var windStreakSprite = null;
  var windDotSprite = null;

  function buildWindSprites() {
    if (windStreakSprite) return;

    var streak = document.createElement("canvas");
    streak.width = 256;
    streak.height = 48;
    var sg = streak.getContext("2d");

    sg.save();
    sg.shadowColor = "rgba(170, 240, 255, 0.85)";
    sg.shadowBlur = 9;
    sg.fillStyle = "rgba(235, 252, 255, 0.5)";
    sg.beginPath();
    sg.moveTo(4, 24);
    sg.quadraticCurveTo(132, 18, 250, 22);
    sg.lineTo(250, 26);
    sg.quadraticCurveTo(132, 30, 4, 24);
    sg.closePath();
    sg.fill();
    sg.restore();

    var core = sg.createLinearGradient(0, 0, 256, 0);
    core.addColorStop(0, "rgba(190, 245, 255, 0)");
    core.addColorStop(0.45, "rgba(205, 246, 255, 0.18)");
    core.addColorStop(0.8, "rgba(235, 252, 255, 0.72)");
    core.addColorStop(1, "rgba(255, 255, 255, 0.95)");
    sg.fillStyle = core;
    sg.beginPath();
    sg.moveTo(3, 24);
    sg.quadraticCurveTo(134, 21.3, 250, 22.7);
    sg.lineTo(250, 25.3);
    sg.quadraticCurveTo(134, 26.7, 3, 24);
    sg.closePath();
    sg.fill();

    var head = sg.createRadialGradient(248, 24, 0, 248, 24, 8);
    head.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    head.addColorStop(0.5, "rgba(225, 252, 255, 0.5)");
    head.addColorStop(1, "rgba(190, 240, 255, 0)");
    sg.fillStyle = head;
    sg.fillRect(238, 14, 20, 20);

    windStreakSprite = streak;

    var dot = document.createElement("canvas");
    dot.width = 32;
    dot.height = 32;
    var dg = dot.getContext("2d");
    var halo = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    halo.addColorStop(0, "rgba(255, 255, 255, 1)");
    halo.addColorStop(0.22, "rgba(225, 252, 255, 0.7)");
    halo.addColorStop(0.55, "rgba(170, 240, 255, 0.2)");
    halo.addColorStop(1, "rgba(170, 240, 255, 0)");
    dg.fillStyle = halo;
    dg.beginPath();
    dg.arc(16, 16, 16, 0, TAU);
    dg.fill();
    windDotSprite = dot;
  }

  function makeWindParticle(anywhere) {
    var depth = Math.random();
    return {
      x: anywhere ? Math.random() * (windW + 160) - 80 : -100 - Math.random() * 260,
      y: Math.random() * windH,
      depth: depth,
      speed: 12 + depth * 46 + Math.random() * 24,
      length: 22 + depth * 82 + Math.random() * 58,
      width: 0.7 + depth * 2.3 + Math.random() * 0.9,
      alpha: 0.1 + depth * 0.24 + Math.random() * 0.1,
      sway: Math.random() * TAU,
      swaySpeed: 0.35 + Math.random() * 0.95,
      swayAmp: 0.8 + depth * 4.2,
      tilt: -0.03 + Math.random() * 0.06,
      vy: -5 + Math.random() * 10
    };
  }

  function makeDust(anywhere) {
    return {
      x: anywhere ? Math.random() * windW : -20 - Math.random() * 180,
      y: Math.random() * windH,
      size: 0.5 + Math.random() * 1.25,
      alpha: 0.08 + Math.random() * 0.2,
      speed: 3 + Math.random() * 15,
      vy: -3 + Math.random() * 6
    };
  }

  function seedWind() {
    windParticles = [];
    windDust = [];
    if (!windCtx || !SETTINGS.wind) return;
    buildWindSprites();
    var scale = Math.min(1.15, Math.max(0.5, windW / 1000));
    var count = Math.round(SETTINGS.wind * scale);
    var dustCount = Math.round((SETTINGS.wind >= 45 ? 18 : 9) * scale);
    for (var i = 0; i < count; i += 1) windParticles.push(makeWindParticle(true));
    for (var j = 0; j < dustCount; j += 1) windDust.push(makeDust(true));
  }

  function resizeWind() {
    if (!windCanvas || !windCtx) return;
    if (!SETTINGS.wind) {
      windCanvas.hidden = true;
      windW = 0;
      windH = 0;
      windParticles = [];
      windDust = [];
      return;
    }
    windCanvas.hidden = false;
    var dpr = Math.min(window.devicePixelRatio || 1, SETTINGS.dpr);
    windW = window.innerWidth;
    windH = window.innerHeight;
    windCanvas.width = Math.max(1, Math.round(windW * dpr));
    windCanvas.height = Math.max(1, Math.round(windH * dpr));
    windCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedWind();
  }

  function drawWind(dt) {
    if (!windCtx || !windW || !windH || !SETTINGS.wind) return;
    windCtx.clearRect(0, 0, windW, windH);
    if (!windParticles.length && !windDust.length) return;
    if (!windStreakSprite) buildWindSprites();

    var step = Math.min(dt, 48) / 1000;
    var speedMul = 1 + intensity * 1.35;
    var alphaMul = 0.85 + intensity * 1.15;
    var lengthMul = 1 + intensity * 0.25;
    var i;
    windCtx.globalCompositeOperation = "lighter";

    for (i = 0; i < windDust.length; i += 1) {
      var d = windDust[i];
      d.x += d.speed * speedMul * step;
      d.y += d.vy * step;
      if (d.x > windW + 30 || d.y < -30 || d.y > windH + 30) {
        windDust[i] = makeDust(false);
        continue;
      }
      var dotSize = d.size * 7;
      windCtx.globalAlpha = Math.min(0.38, d.alpha * alphaMul);
      windCtx.drawImage(windDotSprite, d.x - dotSize / 2, d.y - dotSize / 2, dotSize, dotSize);
    }

    windCtx.lineCap = "round";
    for (i = 0; i < windParticles.length; i += 1) {
      var p = windParticles[i];
      p.x += p.speed * speedMul * step;
      p.y += p.vy * step;
      p.sway += p.swaySpeed * step;

      if (p.x - p.length * lengthMul > windW + 40) {
        windParticles[i] = makeWindParticle(false);
        continue;
      }
      if (p.y < -40) p.y = windH + 40;
      else if (p.y > windH + 40) p.y = -40;

      var len = p.length * lengthMul;
      var h = 4.5 + p.width * 3.4;
      var y = p.y + Math.sin(p.sway) * p.swayAmp;
      var tilt = p.tilt + Math.sin(p.sway * 0.7) * 0.012;

      windCtx.save();
      windCtx.translate(p.x, y);
      windCtx.rotate(tilt);
      windCtx.globalAlpha = Math.min(0.62, p.alpha * alphaMul);
      windCtx.drawImage(windStreakSprite, -len, -h / 2, len, h);
      windCtx.restore();

      if (p.depth > 0.58) {
        windCtx.globalAlpha = Math.min(0.85, 0.18 + p.alpha * alphaMul);
        windCtx.fillStyle = "rgba(240, 253, 255, 1)";
        windCtx.beginPath();
        windCtx.ellipse(p.x, y, 0.8 + p.width * 0.42, 0.45 + p.width * 0.24, tilt, 0, TAU);
        windCtx.fill();
      }
    }

    windCtx.globalAlpha = 1;
    windCtx.globalCompositeOperation = "source-over";
  }

  /* ------------------------------------------------------------------------
     Circular avatar visualizer
     ------------------------------------------------------------------------ */

  var vizCanvas = document.getElementById("viz");
  var vizCtx = vizCanvas ? vizCanvas.getContext("2d", { alpha: true }) : null;
  var avatarWrap = document.querySelector(".avatar-wrap");
  var avatarRing = document.querySelector(".avatar-ring");
  var vizSize = 0;
  var vizRadius = 80;
  var vizGradient = null;
  var VIZ_BARS = 72;
  var spectrumLevels = new Float32Array(VIZ_BARS);

  function resizeViz() {
    if (!vizCanvas || !vizCtx || !avatarRing) return;
    var ringSize = avatarRing.getBoundingClientRect().width || 160;
    var size = Math.max(250, Math.round(ringSize * 2.2));
    var dpr = Math.min(window.devicePixelRatio || 1, SETTINGS.dpr);

    vizRadius = ringSize / 2;
    vizSize = size;
    vizCanvas.style.width = size + "px";
    vizCanvas.style.height = size + "px";
    vizCanvas.width = Math.max(1, Math.round(size * dpr));
    vizCanvas.height = Math.max(1, Math.round(size * dpr));
    vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    vizGradient = vizCtx.createLinearGradient(0, 0, size, size);
    vizGradient.addColorStop(0, "rgba(210, 250, 255, 0.92)");
    vizGradient.addColorStop(0.35, "rgba(103, 232, 249, 1)");
    vizGradient.addColorStop(0.72, "rgba(34, 211, 238, 0.95)");
    vizGradient.addColorStop(1, "rgba(59, 130, 246, 0.92)");
  }

  function drawViz(dt) {
    if (!vizCtx || !vizSize || !vizGradient || !vizVisible) return;

    var center = vizSize / 2;
    var base = vizRadius + 7;
    var pulse = Math.sin(performance.now() * 0.00135) * 0.5 + 0.5;
    var radius = base + intensity * 4.5 + pulse * 1.4;

    vizCtx.clearRect(0, 0, vizSize, vizSize);
    vizCtx.lineCap = "round";

    if (SETTINGS.glow) {
      vizCtx.save();
      vizCtx.globalCompositeOperation = "lighter";

      vizCtx.beginPath();
      vizCtx.arc(center, center, radius + 12 + intensity * 12, 0, TAU);
      vizCtx.strokeStyle = "rgba(34, 211, 238, " + (0.05 + intensity * 0.1) + ")";
      vizCtx.lineWidth = 14 + intensity * 22;
      vizCtx.shadowColor = "rgba(34, 211, 238, 0.55)";
      vizCtx.shadowBlur = 18 + intensity * 26;
      vizCtx.stroke();

      vizCtx.beginPath();
      vizCtx.arc(center, center, radius, 0, TAU);
      vizCtx.strokeStyle = "rgba(103, 232, 249, " + (0.16 + intensity * 0.25) + ")";
      vizCtx.lineWidth = 5 + intensity * 9;
      vizCtx.shadowColor = "rgba(34, 211, 238, 0.9)";
      vizCtx.shadowBlur = 12 + intensity * 22;
      vizCtx.stroke();
      vizCtx.restore();
    }

    vizCtx.beginPath();
    vizCtx.arc(center, center, radius, 0, TAU);
    vizCtx.strokeStyle = vizGradient;
    vizCtx.lineWidth = 1.5 + intensity * 1.5;
    vizCtx.globalAlpha = 0.75 + intensity * 0.25;
    vizCtx.stroke();
    vizCtx.globalAlpha = 1;

    var frame = Math.max(8, Math.min(48, dt || 16.7));
    var rise = 1 - Math.exp(-frame / 45);
    var fall = 1 - Math.exp(-frame / 130);
    var live = spectrumActive && analyser && freqData;
    var nyquist = live ? analyser.context.sampleRate / 2 : 22050;
    var minFreq = 40;
    var maxFreq = 16000;
    var range = maxFreq / minFreq;
    var barBase = radius + 4;
    var maxBar = Math.min(56, 32 + vizRadius * 0.25);
    var i;
    var j;

    for (i = 0; i < VIZ_BARS; i += 1) {
      var target = 0;
      if (live) {
        var t0 = i / VIZ_BARS;
        var t1 = (i + 1) / VIZ_BARS;
        var f0 = minFreq * Math.pow(range, t0);
        var f1 = minFreq * Math.pow(range, t1);
        var bin0 = Math.max(0, Math.min(freqData.length - 1, Math.floor(f0 / nyquist * freqData.length)));
        var bin1 = Math.max(bin0 + 1, Math.min(freqData.length, Math.ceil(f1 / nyquist * freqData.length)));
        var sum = 0;
        var peak = 0;
        for (j = bin0; j < bin1; j += 1) {
          var value = freqData[j];
          sum += value;
          if (value > peak) peak = value;
        }
        target = ((sum / (bin1 - bin0)) / 255) * 0.55 + (peak / 255) * 0.45;
        target *= 0.86 + t0 * 0.56;
        if (target > 1) target = 1;
      }
      var current = spectrumLevels[i];
      spectrumLevels[i] = current + (target - current) * (target > current ? rise : fall);
    }

    vizCtx.save();
    vizCtx.globalCompositeOperation = "lighter";
    var passes = SETTINGS.glow ? 2 : 1;
    for (var pass = 0; pass < passes; pass += 1) {
      var wide = pass === 0 && SETTINGS.glow;
      vizCtx.lineWidth = wide ? 7 : 2.3;
      var alphaBase = wide ? 0.16 : 0.78;
      for (i = 0; i < VIZ_BARS; i += 1) {
        var level = spectrumLevels[i];
        if (level < 0.01) continue;
        var angle = -Math.PI / 2 + (i / VIZ_BARS) * TAU;
        var inner = barBase + 1;
        var outer = barBase + 2 + level * maxBar;
        var mix = i / VIZ_BARS;
        var red = Math.round(103 + (147 - 103) * mix);
        var green = Math.round(232 + (197 - 232) * mix);
        var blue = Math.round(249 + (253 - 249) * mix);
        vizCtx.strokeStyle = "rgb(" + red + "," + green + "," + blue + ")";
        vizCtx.globalAlpha = alphaBase * (0.55 + level * 0.45);
        vizCtx.beginPath();
        vizCtx.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
        vizCtx.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
        vizCtx.stroke();
      }
    }
    vizCtx.restore();
    vizCtx.globalAlpha = 1;

    vizCtx.beginPath();
    vizCtx.arc(center, center, Math.max(1, base - 4), 0, TAU);
    vizCtx.strokeStyle = "rgba(210, 245, 255, " + (0.1 + intensity * 0.14) + ")";
    vizCtx.lineWidth = 1;
    vizCtx.stroke();
  }

  var resizeCanvases = debounce(function () {
    resizeWind();
    resizeViz();
  }, 120);

  window.addEventListener("resize", resizeCanvases, { passive: true });
  window.addEventListener("orientationchange", resizeCanvases, { passive: true });

  if (avatarRing && "ResizeObserver" in window) {
    new ResizeObserver(function () { resizeViz(); }).observe(avatarRing);
  }

  if (avatarWrap && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      vizVisible = entries[0].isIntersecting;
    }, { threshold: 0 }).observe(avatarWrap);
  }

  /* ------------------------------------------------------------------------
     Animation loop
     ------------------------------------------------------------------------ */

  var running = false;
  var rafId = 0;
  var lastTs = 0;
  var vizAccum = 0;

  function frame(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    var dt = ts - lastTs;
    lastTs = ts;
    if (dt > 80) dt = 16.7;

    updateIntensity(dt);
    drawWind(dt);

    if (SETTINGS.vizFps >= 60) {
      drawViz(dt);
    } else {
      vizAccum += dt;
      if (vizAccum >= 33) {
        drawViz(vizAccum);
        vizAccum = 0;
      }
    }
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ------------------------------------------------------------------------
     Audio context + beat map
     ------------------------------------------------------------------------ */

  function setupAnalyser(ctx) {
    if (!ctx || !audio || analyserSetup) return;
    analyserSetup = true;
    var source = null;
    try {
      var analysis = ctx.createAnalyser();
      analysis.fftSize = 2048;
      analysis.smoothingTimeConstant = 0.82;
      analysis.minDecibels = -90;
      analysis.maxDecibels = -12;

      var gain = ctx.createGain();
      gain.gain.value = mutedState ? 0 : volumeLevel;

      source = ctx.createMediaElementSource(audio);
      source.connect(analysis);
      analysis.connect(gain);
      gain.connect(ctx.destination);

      analyser = analysis;
      freqData = new Uint8Array(analysis.frequencyBinCount);
      volumeGain = gain;
      applyVolume();
    } catch (err) {
      if (source) {
        try { source.connect(ctx.destination); } catch (ignored) {}
      }
      analyser = null;
      freqData = null;
      volumeGain = null;
      applyVolume();
    }
  }

  function getAudioContext() {
    if (audioCtx) return audioCtx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC();
    } catch (err) {
      audioCtx = null;
    }
    if (audioCtx) setupAnalyser(audioCtx);
    return audioCtx;
  }

  function unlockAudioContext() {
    var ctx = getAudioContext();
    if (ctx && ctx.state === "suspended" && ctx.resume) {
      ctx.resume().catch(function () {});
    }
  }

  var beatMapStarted = false;

  function scheduleBeatMap() {
    if (!SETTINGS.beatMap || beatMapStarted || analyser || !audio) return;
    beatMapStarted = true;
    window.setTimeout(function () {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(buildBeatMap, { timeout: 4000 });
      } else {
        buildBeatMap();
      }
    }, 1400);
  }

  async function buildBeatMap() {
    if (!audio) return;
    try {
      var src = audio.currentSrc || audio.src;
      if (!src) return;
      var response = await fetch(src, { cache: "force-cache" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var raw = await response.arrayBuffer();

      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return;

      var decodeCtx = null;
      var rates = [8000, 16000, 22050, 44100];
      for (var r = 0; r < rates.length; r += 1) {
        try {
          decodeCtx = new OAC(1, 1, rates[r]);
        } catch (err) {
          decodeCtx = null;
        }
        if (decodeCtx) break;
      }
      if (!decodeCtx) return;

      var decoded = await decodeCtx.decodeAudioData(raw);
      var rate = decodeCtx.sampleRate;
      var seconds = Math.min(decoded.duration, 900);
      var length = Math.max(1, Math.ceil(seconds * rate));

      var renderCtx = new OAC(1, length, rate);
      var source = renderCtx.createBufferSource();
      source.buffer = decoded;

      var lowpass = renderCtx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 140;
      lowpass.Q.value = 0.7;

      source.connect(lowpass);
      lowpass.connect(renderCtx.destination);
      source.start(0);

      var rendered = await renderCtx.startRendering();
      var data = rendered.getChannelData(0);
      var hop = Math.max(1, Math.round(rate * 0.02));
      var frameCount = Math.floor(data.length / hop);
      if (!frameCount) return;

      var energy = new Float32Array(frameCount);
      var peak = 0;
      var f;
      for (f = 0; f < frameCount; f += 1) {
        var start = f * hop;
        var end = Math.min(data.length, start + hop);
        var sum = 0;
        for (var s = start; s < end; s += 1) {
          var value = data[s];
          sum += value * value;
        }
        energy[f] = Math.sqrt(sum / Math.max(1, end - start));
        if (energy[f] > peak) peak = energy[f];
      }
      if (peak <= 0) return;

      var floor = peak * 0.3;
      var found = [];
      var lastTime = -1;

      for (f = 1; f < frameCount - 1; f += 1) {
        var level = energy[f];
        if (level < floor) continue;
        if (level < energy[f - 1] || level < energy[f + 1]) continue;

        var time = (f * hop) / rate;
        if (time - lastTime < 0.22) {
          if (found.length && level > found[found.length - 1].raw) {
            found[found.length - 1] = {
              t: time,
              raw: level,
              e: Math.min(1, Math.pow(level / peak, 0.7))
            };
          }
          continue;
        }

        found.push({ t: time, raw: level, e: Math.min(1, Math.pow(level / peak, 0.7)) });
        lastTime = time;
      }

      beats = found.map(function (item) { return { t: item.t, e: item.e }; });
      beatIndex = -1;
    } catch (err) {
      /* No beat data: the sine breathing fallback keeps the visual alive. */
    }
  }

  /* ------------------------------------------------------------------------
     Audio UI
     ------------------------------------------------------------------------ */

  function paintVolume(value) {
    if (volumeEl) volumeEl.style.setProperty("--fill", Math.round(value * 100) + "%");
  }

  function applyVolume() {
    if (!audio) return;
    if (volumeGain) {
      audio.volume = 1;
      audio.muted = false;
      volumeGain.gain.value = mutedState ? 0 : volumeLevel;
    } else {
      audio.volume = volumeLevel;
      audio.muted = mutedState;
    }
  }

  function syncAudioUI() {
    var playing = isPlaying();
    var muted = mutedState;
    var volume = volumeLevel;

    if (npBtn) {
      npBtn.classList.toggle("is-playing", playing);
      npBtn.setAttribute("aria-expanded", panelOpen ? "true" : "false");
      npBtn.setAttribute("aria-label", panelOpen ? "Close music controls" : "Open music controls");
    }

    if (npSub) {
      if (playing) npSub.textContent = "Creo — Flow";
      else if (audio && musicStarted && audio.readyState < 3) npSub.textContent = "Loading…";
      else if (musicStarted) npSub.textContent = "Paused";
      else npSub.textContent = "Tap to start";
    }

    if (playBtn) {
      playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
      playBtn.setAttribute("aria-label", playing ? "Pause music" : "Play music");
    }

    if (muteBtn) {
      muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
      muteBtn.setAttribute("aria-label", muted ? "Unmute music" : "Mute music");
    }

    if (volumeEl && document.activeElement !== volumeEl) volumeEl.value = String(volume);
    paintVolume(muted ? 0 : volume);

    if (statusEl) {
      if (!audio || audio.error) statusEl.textContent = "Audio unavailable";
      else if (muted) statusEl.textContent = "Muted";
      else if (playing) statusEl.textContent = "Creo — Flow · " + Math.round(volume * 100) + "%";
      else if (musicStarted) statusEl.textContent = "Paused — tap play";
      else statusEl.textContent = "Tap play to start";
    }
  }

  function setPanel(open) {
    panelOpen = !!open;
    if (musicPanel) {
      musicPanel.classList.toggle("is-open", panelOpen);
      musicPanel.setAttribute("aria-hidden", panelOpen ? "false" : "true");
      if ("inert" in musicPanel) musicPanel.inert = !panelOpen;
    }
    syncAudioUI();
  }

  if (npBtn) {
    npBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      setPanel(!panelOpen);
    });
  }

  if (mpClose) {
    mpClose.addEventListener("click", function () {
      setPanel(false);
      if (npBtn) npBtn.focus();
    });
  }

  if (playBtn) {
    playBtn.addEventListener("click", function () {
      unlockAudioContext();
      musicStarted = true;
      awaitingUnlock = false;
      removeUnlockListeners();
      if (!audio) return;
      if (autoPlayPending) return;
      if (audio.paused) {
        safePlay().then(syncAudioUI);
      } else {
        audio.pause();
      }
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener("click", function () {
      if (!audio) return;
      mutedState = !mutedState;
      if (!mutedState && volumeLevel === 0) {
        volumeLevel = 0.6;
        if (volumeEl) volumeEl.value = "0.6";
      }
      applyVolume();
      syncAudioUI();
    });
  }

  if (volumeEl) {
    var initialVolume = Number(volumeEl.value);
    if (isFinite(initialVolume)) volumeLevel = initialVolume;
    paintVolume(mutedState ? 0 : volumeLevel);
    volumeEl.addEventListener("input", function () {
      if (!audio) return;
      volumeLevel = Number(volumeEl.value);
      if (volumeLevel > 0 && mutedState) mutedState = false;
      applyVolume();
      paintVolume(mutedState ? 0 : volumeLevel);
      syncAudioUI();
    });
  }

  document.addEventListener("pointerdown", function (event) {
    if (!panelOpen) return;
    if (musicPanel && musicPanel.contains(event.target)) return;
    if (npBtn && npBtn.contains(event.target)) return;
    setPanel(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && panelOpen) {
      setPanel(false);
      if (npBtn) npBtn.focus();
    }
  });

  if (audio) {
    applyVolume();
    var audioEvents = ["play", "playing", "pause", "ended", "waiting", "canplay", "volumechange", "error"];
    for (var ae = 0; ae < audioEvents.length; ae += 1) {
      audio.addEventListener(audioEvents[ae], syncAudioUI);
    }
    audio.addEventListener("playing", scheduleBeatMap);
  }

  /* ------------------------------------------------------------------------
     First-interaction audio unlock
     ------------------------------------------------------------------------ */

  var unlockEvents = ["pointerdown", "touchstart", "keydown", "click"];
  var awaitingUnlock = true;
  var autoPlayPending = false;

  function removeUnlockListeners() {
    for (var i = 0; i < unlockEvents.length; i += 1) {
      window.removeEventListener(unlockEvents[i], onFirstInteraction, true);
    }
  }

  function onFirstInteraction(event) {
    if (!awaitingUnlock || autoPlayPending || !audio) return;
    var target = event ? event.target : null;
    if (target && target.closest && target.closest("#music-panel")) return;

    autoPlayPending = true;
    musicStarted = true;
    unlockAudioContext();
    syncAudioUI();

    safePlay().then(function () {
      autoPlayPending = false;
      if (!audio.paused && !audio.ended) {
        awaitingUnlock = false;
        removeUnlockListeners();
        return;
      }
      /* The gesture was not accepted (or audio is still unavailable). Stay
         armed so the next real tap/click attempts playback again. */
      if (!audio.error) {
        musicStarted = false;
        syncAudioUI();
      }
    });
  }

  for (var ue = 0; ue < unlockEvents.length; ue += 1) {
    window.addEventListener(unlockEvents[ue], onFirstInteraction, { capture: true, passive: true });
  }

  /* ------------------------------------------------------------------------
     Link send animations
     ------------------------------------------------------------------------ */

  var sendOverlay = document.getElementById("send-overlay");
  var sendIcon = document.getElementById("send-icon");
  var sendLabel = document.getElementById("send-label");
  var sendTimer = 0;
  var sendWatchdog = 0;
  var sending = false;

  function stopSendTimers() {
    if (sendTimer) {
      clearTimeout(sendTimer);
      sendTimer = 0;
    }
    if (sendWatchdog) {
      clearTimeout(sendWatchdog);
      sendWatchdog = 0;
    }
  }

  function resetSend() {
    sending = false;
    stopSendTimers();
    if (sendOverlay) {
      sendOverlay.classList.remove("is-active");
      sendOverlay.setAttribute("aria-hidden", "true");
      sendOverlay.removeAttribute("data-anim");
    }
    document.body.classList.remove("is-sending");
  }

  function sendLink(card, event) {
    if (!sendOverlay || !sendIcon || !sendLabel) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

    var href = card.getAttribute("href");
    if (!href || href.charAt(0) === "#") return;
    event.preventDefault();

    if (sending) return;
    sending = true;
    stopSendTimers();

    var anim = card.getAttribute("data-anim") || "default";
    var label = card.getAttribute("data-label") || "link";
    var iconId = anim === "aistudio" ? "ai" : anim;

    sendOverlay.setAttribute("data-anim", anim);
    sendIcon.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-' + iconId + '"></use></svg>';
    sendLabel.textContent = "Opening " + label + "…";
    sendOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-sending");

    /* Force the overlay/icon animations to start from the beginning. */
    void sendOverlay.offsetWidth;
    sendOverlay.classList.add("is-active");

    sendTimer = window.setTimeout(function () {
      window.location.assign(href);
    }, reduceMotion ? 350 : 1000);

    sendWatchdog = window.setTimeout(function () {
      resetSend();
    }, reduceMotion ? 1200 : 2200);
  }

  document.addEventListener("click", function (event) {
    var card = event.target.closest ? event.target.closest(".link-card") : null;
    if (!card) return;
    sendLink(card, event);
  });

  /* ------------------------------------------------------------------------
     Lifecycle / bfcache safety
     ------------------------------------------------------------------------ */

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      stopLoop();
      return;
    }
    resetSend();
    setPanel(false);
    lastTs = 0;
    startLoop();
    resizeCanvases();
    syncAudioUI();
  });

  window.addEventListener("pagehide", resetSend);

  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    resetSend();
    setPanel(false);
    revealAll();
    restartEntrance();
    resizeCanvases();
    lastTs = 0;
    startLoop();
    syncAudioUI();
  });

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  resizeWind();
  resizeViz();
  startTyping();
  setupReveal();
  syncAudioUI();
  startLoop();
})();
