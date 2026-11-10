/* ==========================================================================
   MDC — Links
   Vanilla JS: wind particles, avatar wave visualizer, music + beat map,
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
    high: { dpr: 2, wind: 42, vizFps: 60, nameSpeed: 150, bioSpeed: 20, beatMap: true, glow: true },
    mid: { dpr: 1.5, wind: 20, vizFps: 60, nameSpeed: 135, bioSpeed: 18, beatMap: true, glow: true },
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

  function updateIntensity(dt) {
    var playing = isPlaying() && audio.readyState >= 2;
    var time = audio ? audio.currentTime : 0;

    if (time + 0.05 < lastAudioTime) beatIndex = -1;
    lastAudioTime = time;

    var beat = 0;
    if (playing && beats.length) {
      while (beatIndex + 1 < beats.length && beats[beatIndex + 1].t <= time) beatIndex += 1;
      if (beatIndex >= 0) {
        var age = time - beats[beatIndex].t;
        if (age >= 0 && age < 0.6) beat = beats[beatIndex].e * Math.exp(-age * 6.5);
      }
    }

    var breath = 0.5 + 0.5 * Math.sin(performance.now() * 0.0016);
    var target = playing
      ? 0.12 + breath * 0.06 + beat * 0.86
      : 0.18 + breath * 0.14;

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

  function makeWindParticle(anywhere) {
    return {
      x: anywhere ? Math.random() * windW : -40 - Math.random() * 120,
      y: Math.random() * windH,
      speed: 7 + Math.random() * 22,
      length: 9 + Math.random() * 44,
      alpha: 0.05 + Math.random() * 0.11,
      width: 0.7 + Math.random() * 1,
      sway: Math.random() * TAU,
      swaySpeed: 0.4 + Math.random() * 0.9
    };
  }

  function seedWind() {
    windParticles = [];
    if (!windCtx || !SETTINGS.wind) return;
    var scale = Math.min(1.15, Math.max(0.5, windW / 900));
    var count = Math.round(SETTINGS.wind * scale);
    for (var i = 0; i < count; i += 1) windParticles.push(makeWindParticle(true));
  }

  function resizeWind() {
    if (!windCanvas || !windCtx) return;
    if (!SETTINGS.wind) {
      windCanvas.hidden = true;
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
    if (!windCtx || !windW || !windParticles.length) return;
    windCtx.clearRect(0, 0, windW, windH);
    windCtx.lineCap = "round";
    windCtx.strokeStyle = "#ffffff";

    var speedMul = 1 + intensity * 1.2;
    var alphaMul = 1 + intensity * 1.1;
    var lengthMul = 1 + intensity * 0.5;

    for (var i = 0; i < windParticles.length; i += 1) {
      var p = windParticles[i];
      p.x += p.speed * speedMul * (dt / 1000);
      p.sway += p.swaySpeed * (dt / 1000);

      if (p.x - p.length * 2 > windW) {
        windParticles[i] = makeWindParticle(false);
        continue;
      }

      var y = p.y + Math.sin(p.sway) * 2;
      windCtx.globalAlpha = Math.min(0.42, p.alpha * alphaMul);
      windCtx.lineWidth = p.width;
      windCtx.beginPath();
      windCtx.moveTo(p.x - p.length * lengthMul, y);
      windCtx.lineTo(p.x, y);
      windCtx.stroke();
    }
    windCtx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------------
     Avatar wave visualizer
     ------------------------------------------------------------------------ */

  var vizCanvas = document.getElementById("viz");
  var vizCtx = vizCanvas ? vizCanvas.getContext("2d", { alpha: true }) : null;
  var avatarWrap = document.querySelector(".avatar-wrap");
  var avatarRing = document.querySelector(".avatar-ring");
  var vizSize = 0;
  var vizRadius = 80;
  var vizGradient = null;
  var vizPhase = 0;
  var VIZ_POINTS = 64;
  var vizX = new Float32Array(VIZ_POINTS);
  var vizY = new Float32Array(VIZ_POINTS);

  function resizeViz() {
    if (!vizCanvas || !vizCtx || !avatarRing) return;
    var ringSize = avatarRing.getBoundingClientRect().width || 160;
    var size = Math.max(220, Math.round(ringSize * 1.75));
    var dpr = Math.min(window.devicePixelRatio || 1, SETTINGS.dpr);

    vizRadius = ringSize / 2;
    vizSize = size;
    vizCanvas.style.width = size + "px";
    vizCanvas.style.height = size + "px";
    vizCanvas.width = Math.max(1, Math.round(size * dpr));
    vizCanvas.height = Math.max(1, Math.round(size * dpr));
    vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    vizGradient = vizCtx.createLinearGradient(0, 0, size, size);
    vizGradient.addColorStop(0, "rgba(165, 243, 252, 0.95)");
    vizGradient.addColorStop(0.45, "rgba(34, 211, 238, 0.95)");
    vizGradient.addColorStop(1, "rgba(59, 130, 246, 0.95)");
  }

  function drawViz(dt) {
    if (!vizCtx || !vizSize || !vizGradient || !vizVisible) return;

    var center = vizSize / 2;
    var base = vizRadius + 7;
    var amp = 2.2 + intensity * 6.4;
    var push = intensity * 6;
    var i;
    var angle;

    for (i = 0; i < VIZ_POINTS; i += 1) {
      angle = (i / VIZ_POINTS) * TAU;
      var wobble =
        Math.sin(i * 0.55 + vizPhase) * amp +
        Math.sin(i * 1.73 - vizPhase * 0.62) * (amp * 0.55);
      var radius = base + wobble + push;
      vizX[i] = center + Math.cos(angle) * radius;
      vizY[i] = center + Math.sin(angle) * radius;
    }

    vizCtx.clearRect(0, 0, vizSize, vizSize);

    function trace() {
      vizCtx.beginPath();
      var last = VIZ_POINTS - 1;
      vizCtx.moveTo((vizX[last] + vizX[0]) / 2, (vizY[last] + vizY[0]) / 2);
      for (var j = 0; j < VIZ_POINTS; j += 1) {
        var next = (j + 1) % VIZ_POINTS;
        vizCtx.quadraticCurveTo(
          vizX[j],
          vizY[j],
          (vizX[j] + vizX[next]) / 2,
          (vizY[j] + vizY[next]) / 2
        );
      }
      vizCtx.closePath();
    }

    if (SETTINGS.glow) {
      vizCtx.save();
      vizCtx.globalCompositeOperation = "lighter";
      vizCtx.strokeStyle = "rgba(34, 211, 238, 0.32)";
      vizCtx.lineWidth = 5 + intensity * 9;
      vizCtx.shadowColor = "rgba(34, 211, 238, 0.7)";
      vizCtx.shadowBlur = 14 + intensity * 20;
      trace();
      vizCtx.stroke();
      vizCtx.restore();
    }

    vizCtx.strokeStyle = vizGradient;
    vizCtx.lineWidth = 1.3 + intensity * 1.3;
    vizCtx.lineJoin = "round";
    trace();
    vizCtx.stroke();

    vizCtx.beginPath();
    vizCtx.strokeStyle = "rgba(210, 245, 255, 0.12)";
    vizCtx.lineWidth = 1;
    vizCtx.arc(center, center, Math.max(1, base - 5), 0, TAU);
    vizCtx.stroke();

    vizPhase += dt * (0.0009 + intensity * 0.0024);
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

  function getAudioContext() {
    if (audioCtx) return audioCtx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC();
    } catch (err) {
      audioCtx = null;
    }
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
    if (!SETTINGS.beatMap || beatMapStarted || !audio) return;
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

  function syncAudioUI() {
    var playing = isPlaying();
    var muted = audio ? audio.muted : false;
    var volume = audio ? audio.volume : 0.8;

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
      if (!audio) return;
      if (audio.paused) {
        safePlay();
      } else {
        audio.pause();
      }
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener("click", function () {
      if (!audio) return;
      audio.muted = !audio.muted;
      if (!audio.muted && audio.volume === 0) {
        audio.volume = 0.6;
        if (volumeEl) volumeEl.value = "0.6";
      }
      syncAudioUI();
    });
  }

  if (volumeEl) {
    paintVolume(Number(volumeEl.value) || 0.8);
    volumeEl.addEventListener("input", function () {
      if (!audio) return;
      var next = Number(volumeEl.value);
      audio.volume = next;
      if (next > 0 && audio.muted) audio.muted = false;
      paintVolume(next);
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
    audio.volume = 0.8;
    var audioEvents = ["play", "playing", "pause", "ended", "waiting", "canplay", "volumechange", "error"];
    for (var ae = 0; ae < audioEvents.length; ae += 1) {
      audio.addEventListener(audioEvents[ae], syncAudioUI);
    }
  }

  /* ------------------------------------------------------------------------
     First-interaction audio unlock
     ------------------------------------------------------------------------ */

  var unlockEvents = ["pointerdown", "touchstart", "keydown", "scroll"];
  var awaitingUnlock = true;

  function onFirstInteraction() {
    if (!awaitingUnlock) return;
    awaitingUnlock = false;
    for (var i = 0; i < unlockEvents.length; i += 1) {
      window.removeEventListener(unlockEvents[i], onFirstInteraction, true);
    }
    unlockAudioContext();
    musicStarted = true;
    safePlay();
    syncAudioUI();
    scheduleBeatMap();
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
