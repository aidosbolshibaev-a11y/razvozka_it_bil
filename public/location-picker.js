(function (root) {
  "use strict";
  const BOUNDS = { south: 50.95, north: 51.40, west: 71.10, east: 71.90 };
  const DEFAULT = { lat: 51.16, lon: 71.43 };
  function valid(point) {
    return point && typeof point.lat === "number" && typeof point.lon === "number" && Number.isFinite(point.lat) && Number.isFinite(point.lon)
      && point.lat >= BOUNDS.south && point.lat <= BOUNDS.north && point.lon >= BOUNDS.west && point.lon <= BOUNDS.east;
  }
  function world(point, zoom) {
    const n = 256 * 2 ** zoom, rad = point.lat * Math.PI / 180;
    return { x: (point.lon + 180) / 360 * n, y: (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n };
  }
  function coordinates(pixel, zoom) {
    const n = 256 * 2 ** zoom;
    return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * pixel.y / n))) * 180 / Math.PI, lon: pixel.x / n * 360 - 180 };
  }
  function osmURL(point) {
    if (!valid(point)) return null;
    const url = new URL("https://www.openstreetmap.org/");
    url.searchParams.set("mlat", point.lat.toFixed(6)); url.searchParams.set("mlon", point.lon.toFixed(6));
    url.hash = `map=18/${point.lat.toFixed(6)}/${point.lon.toFixed(6)}`;
    return url.href;
  }
  const WORDS = {
    ru: { idle: "Откройте карту, приблизьте нужное здание и подтвердите метку.", local: "Для выбора метки откройте сайт через локальный сервер или опубликованный адрес. Инструкция запуска есть в README.", loading: "Загружаем карту…", failed: "Карта не загрузилась. Повторите загрузку; по пустой карте подтвердить новую метку нельзя.", ready: "Подведите центр карты к зданию. Подтвердите метку кнопкой ниже.", closer: "Приблизьте карту до здания кнопкой +, затем подтвердите метку.", saved: "Выбрана точка: ", unconfirmed: "Точка ещё не подтверждена. ", pending: "Метка показывает выбранное вами место, а не проверенный адрес здания." },
    kz: { idle: "Картаны ашып, ғимаратты жақындатыңыз және белгіні растаңыз.", local: "Белгіні таңдау үшін сайтты жергілікті сервер немесе жарияланған мекенжай арқылы ашыңыз. Нұсқаулық README ішінде.", loading: "Карта жүктелуде…", failed: "Карта жүктелмеді. Қайталаңыз; бос картада жаңа белгіні растауға болмайды.", ready: "Карта ортасын ғимаратқа апарып, төмендегі түймемен растаңыз.", closer: "+ түймесімен ғимаратты жақындатып, белгіні растаңыз.", saved: "Таңдалған нүкте: ", unconfirmed: "Нүкте әлі расталмаған. ", pending: "Белгі тек сіз таңдаған орынды көрсетеді, ғимарат мекенжайын растамайды." }
  };
  function mount(document, getLanguage, config = {}) {
    const $ = id => document.getElementById(id), viewport = $("location-map"), tiles = $("location-tiles");
    let center = { ...DEFAULT }, zoom = 13, selected = null, active = false, ready = false, generation = 0, pending = 0, failed = false, drag = null, timer, layoutWidth = 0;
    const t = key => (WORDS[getLanguage()] || WORDS.ru)[key];
    function message(key) { $("location-status").textContent = t(key); }
    function show() {
      $("location-confirm").disabled = !ready || zoom < 17;
      $("location-value").textContent = selected ? t("saved") + selected.lat.toFixed(6) + ", " + selected.lon.toFixed(6) + ". " + t("pending") : t("unconfirmed") + (zoom < 17 ? t("closer") : t("ready"));
    }
    function invalidate() { selected = null; show(); }
    function move(point) {
      center = { lat: Math.max(BOUNDS.south, Math.min(BOUNDS.north, point.lat)), lon: Math.max(BOUNDS.west, Math.min(BOUNDS.east, point.lon)) };
      invalidate(); render();
    }
    function render() {
      if (!active) { show(); return; }
      const operation = ++generation; root.clearTimeout(timer);
      tiles.replaceChildren(); ready = false; failed = false;
      const width = viewport.clientWidth || 320, height = viewport.clientHeight || 340, p = world(center, zoom);
      layoutWidth = viewport.clientWidth;
      const x0 = Math.floor((p.x - width / 2) / 256), x1 = Math.floor((p.x + width / 2) / 256);
      const y0 = Math.floor((p.y - height / 2) / 256), y1 = Math.floor((p.y + height / 2) / 256);
      pending = (x1 - x0 + 1) * (y1 - y0 + 1);
      message("loading"); show();
      timer = root.setTimeout(() => { if (operation === generation && pending) { failed = true; ready = false; message("failed"); show(); } }, 15000);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const image = document.createElement("img"); image.alt = ""; image.draggable = false;
        image.style.left = (x * 256 - p.x + width / 2) + "px"; image.style.top = (y * 256 - p.y + height / 2) + "px";
        image.addEventListener("load", () => {
          if (operation !== generation) return;
          pending--; if (!pending) { root.clearTimeout(timer); ready = !failed; message(failed ? "failed" : zoom < 17 ? "closer" : "ready"); show(); }
        });
        image.addEventListener("error", () => { if (operation === generation) { failed = true; ready = false; root.clearTimeout(timer); message("failed"); show(); } });
        image.src = (config.MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png").replace("{z}", zoom).replace("{x}", x).replace("{y}", y);
        tiles.append(image);
      }
    }
    function pan(dx, dy) { if (!active) return; const p = world(center, zoom); move(coordinates({ x: p.x + dx, y: p.y + dy }, zoom)); }
    function changeZoom(delta) { if (!active) return; zoom = Math.max(11, Math.min(19, zoom + delta)); render(); }
    $("location-load").addEventListener("click", () => {
      if (!/^https?:$/.test(root.location.protocol)) { message("local"); return; }
      active = true; $("location-map-panel").hidden = false; render();
    });
    $("location-in").addEventListener("click", () => changeZoom(1));
    $("location-out").addEventListener("click", () => changeZoom(-1));
    $("location-west").addEventListener("click", () => pan(-80, 0));
    $("location-east").addEventListener("click", () => pan(80, 0));
    $("location-north").addEventListener("click", () => pan(0, -80));
    $("location-south").addEventListener("click", () => pan(0, 80));
    $("location-confirm").addEventListener("click", () => {
      if (!active || !ready || zoom < 17 || !valid(center)) return;
      selected = { lat: Number(center.lat.toFixed(6)), lon: Number(center.lon.toFixed(6)) }; show();
    });
    viewport.addEventListener("keydown", event => {
      const arrows = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] };
      if (arrows[event.key]) { event.preventDefault(); pan(...arrows[event.key]); }
      else if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(1); }
      else if (event.key === "-") { event.preventDefault(); changeZoom(-1); }
    });
    viewport.addEventListener("pointerdown", event => {
      if (!active || (event.button !== undefined && event.button !== 0)) return;
      const p = world(center, zoom); drag = { x: event.clientX, y: event.clientY, p };
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener("pointermove", event => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) < 6) return;
      // Move only the existing layer during a gesture, then request the final view.
      tiles.style.transform = `translate(${dx}px,${dy}px)`;
      ready = false; if (selected) invalidate(); else show();
    });
    viewport.addEventListener("pointerup", event => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y, previous = drag; drag = null; tiles.style.transform = "";
      const rect = viewport.getBoundingClientRect();
      if (Math.hypot(dx, dy) < 6) move(coordinates({ x: previous.p.x + event.clientX - rect.left - rect.width / 2, y: previous.p.y + event.clientY - rect.top - rect.height / 2 }, zoom));
      else move(coordinates({ x: previous.p.x - dx, y: previous.p.y - dy }, zoom));
    });
    viewport.addEventListener("pointercancel", () => { drag = null; tiles.style.transform = ""; render(); });
    if (typeof root.ResizeObserver === "function") {
      const observer = new root.ResizeObserver(() => {
        if (active && viewport.clientWidth > 0 && viewport.clientWidth !== layoutWidth) render();
      });
      observer.observe(viewport);
    }
    show(); message("idle");
    return {
      value: () => selected ? { ...selected } : null,
      set(point) { generation++; root.clearTimeout(timer); center = valid(point) ? { lat: point.lat, lon: point.lon } : { ...DEFAULT }; selected = valid(point) ? { ...center } : null; zoom = selected ? 18 : 13; render(); },
      language() { show(); if (!active) message("idle"); }
    };
  }
  const api = { mount, valid, world, coordinates, osmURL, BOUNDS };
  root.RazvozkaLocation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
