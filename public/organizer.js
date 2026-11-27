(function (root) {
  "use strict";
  const STATUSES = { unchecked: "Не проверено", checked: "Проверено", missing: "Не найдено" };
  const DIRS = { fri: "Щучинск → Астана", sun: "Астана → Щучинск" };
  const TRANSPORT = { car: "Машина" };
  const HEADERS = ["№", "ФИО", "Класс", "Дата поездки", "Направление", "Транспорт", "Время", "Телефон", "Адрес", "Статус проверки адреса", "Цена"];
  const needsCheck = row => row.tr === "car" && Boolean(row.addr && row.addr.trim());
  const fingerprint = row => {
    const fields = [row.date, row.dir, row.tr, row.time, row.addr];
    if (Number.isFinite(row.delivery_lat) && Number.isFinite(row.delivery_lon)) fields.push(row.delivery_lat,row.delivery_lon);
    return JSON.stringify(fields);
  };
  const formatDate = value => String(value).split("-").reverse().join(".");
  const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);

  // Save only record identifiers, a digest of the checked address/trip, and the status.
  async function digest(value) {
    const data = new TextEncoder().encode(value);
    const bytes = await root.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function createStore(storage, namespace, warn) {
    let entries = Object.create(null);
    try {
      const saved = storage.getItem(namespace);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Invalid storage");
        entries = Object.assign(Object.create(null), parsed);
      }
      // Probe even when no status has been changed yet.
      storage.setItem(namespace, JSON.stringify(entries));
    } catch (_) { warn(); }
    const save = () => {
      try { storage.setItem(namespace, JSON.stringify(entries)); }
      catch (_) { warn(); }
    };
    return {
      reconcile(rows) {
        for (const row of rows) {
          const entry = entries[row.id];
          if (entry && (entry.fingerprint !== row.addressDigest || !needsCheck(row))) delete entries[row.id];
        }
        save();
      },
      get(row) {
        if (!needsCheck(row)) return "not-required";
        const entry = entries[row.id];
        return entry && entry.fingerprint === row.addressDigest && Object.hasOwn(STATUSES, entry.status) ? entry.status : "unchecked";
      },
      set(row, status) {
        if (!needsCheck(row) || !Object.hasOwn(STATUSES, status)) return;
        if (status === "unchecked") delete entries[row.id];
        else entries[row.id] = { fingerprint: row.addressDigest, status };
        save();
      }
    };
  }
  const statusText = (row, store) => STATUSES[store.get(row)] || "Не требуется";
  function exportRows(rows, store) {
    return [HEADERS, ...rows.map((row, i) => [
      i + 1, row.name, row.cls, formatDate(row.date), DIRS[row.dir], TRANSPORT[row.tr],
      row.time, String(row.phone), row.addr + (row.delivery_note ? " · Примечание: " + row.delivery_note : ""), statusText(row, store),
      Number(row.price)
    ])];
  }
  function mount(document, config) {
    const $ = id => document.getElementById(id);
    let session = null, rows = [], store = null, generation = 0, timer = null, loadedDate = "", busy = false;
    const message = text => { $("message").textContent = text; };
    const warnStorage = () => { $("storage-warning").hidden = false; };
    $("trip-date").value = today();
    function setBusy(value) {
      busy = value;
      for (const id of ["login-button", "load", "export", "trip-date", "direction"]) $(id).disabled = value;
    }
    function clearList() {
      rows = []; loadedDate = "";
      $("records").replaceChildren(); $("count").textContent = "";
    }
    function clearSession(text) {
      root.RazvozkaOrganizerNavigation?.setAuthenticated(false);
      if(catalogAdmin)catalogAdmin.clear();
      if(dispatch)dispatch.clear();
      if(deadlineUI)deadlineUI.clear();
      generation++; clearTimeout(timer); timer = null; session = null; store = null;
      clearList(); setBusy(false);
      $("workspace").hidden = true; $("login-panel").hidden = false;
      $("password").value = ""; $("storage-warning").hidden = true;
      if (text) message(text);
    }
    function ensureSession() {
      if (session && session.expires > Date.now()) return true;
      clearSession("Войдите заново: сеанс завершён.");
      return false;
    }
    async function request(path, body, token) {
      let response;
      try {
        response = await root.fetch(config.URL + path, {
          method: "POST", headers: { apikey: config.KEY, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
          body: JSON.stringify(body), cache: "no-store"
        });
      } catch (_) { throw new Error("Нет связи с сервером. Повторите позже."); }
      if (response.status === 401 || response.status === 403) {
        const error = new Error("Нет доступа. Проверьте вход и право организатора у администратора.");
        error.denied = true; throw error;
      }
      if (path.startsWith("/auth/") && response.status === 400) {
        throw new Error("Не удалось войти. Проверьте почту и пароль. Учётная запись должна быть подтверждена в Supabase.");
      }
      if (response.status === 429) throw new Error("Слишком много попыток. Подождите и повторите вход позже.");
      if (path.startsWith("/rest/v1/rpc/") && response.status === 404) {
        throw new Error("Не настроена функция сервера: для списков нужна миграция 0003_organizer_lists.sql, для точек и времени — 0005_trip_catalog.sql, для водителей — 0006_drivers_groups.sql.");
      }
      if (!response.ok) throw new Error("Не удалось выполнить запрос. Проверьте настройки и повторите позже.");
      return response.json();
    }
    const catalogAdmin = root.RazvozkaCatalogAdmin?.mount(document,async(fn,args)=>{
      if(!ensureSession())throw Error("Войдите заново.");
      const auth=session;
      try{const result=await request("/rest/v1/rpc/"+fn,args,auth.token);
        if(session!==auth||!ensureSession())throw Error("Сеанс завершён.");return result;
      }catch(e){if(e.denied&&session===auth)clearSession(e.message);throw e;}
    });
    const dispatch=root.RazvozkaDispatch?.mount(document,async(fn,args)=>{
      if(!ensureSession())throw Error("Войдите заново.");
      const auth=session;
      try{const result=await request("/rest/v1/rpc/"+fn,args,auth.token);
        if(session!==auth||!ensureSession())throw Error("Сеанс завершён.");return result;
      }catch(e){if(e.denied&&session===auth)clearSession(e.message);throw e;}
    },()=>rows);
    const deadlineUI=root.RazvozkaDeadlineUI?.mount(document,async(fn,args)=>{
      if(!ensureSession())throw Error("Войдите заново.");
      const auth=session;
      try{const result=await request("/rest/v1/rpc/"+fn,args,auth.token);
        if(session!==auth||!ensureSession())throw Error("Сеанс завершён.");return result;
      }catch(e){if(e.denied&&session===auth)clearSession(e.message);throw e;}
    });
    async function readList(auth, filters) {
      const result = await request("/rest/v1/rpc/organizer_signups", filters, auth.token);
      if (!result || !Array.isArray(result.rows)) throw new Error("Сервер вернул некорректный список.");
      return Promise.all(result.rows.filter(row => row.tr === "car").map(async row => ({ ...row, addressDigest: await digest(fingerprint(row)) })));
    }
    function filters() {
      return { p_date: $("trip-date").value, p_dir: $("direction").value || null, p_tr: "car" };
    }
    function render() {
      $("records").replaceChildren();
      $("count").textContent = rows.length ? "Записей: " + rows.length + " · " + formatDate(loadedDate) : "Нет записей для выгрузки";
      rows.forEach((row, index) => {
        const item = document.createElement("li");
        item.className = "record";
        const heading = document.createElement("h3"); heading.textContent = (index + 1) + ". " + row.name + " · " + row.cls;
        const trip = document.createElement("p"); trip.textContent = formatDate(row.date) + " · " + DIRS[row.dir] + " · " + TRANSPORT[row.tr] + " · " + row.time;
        const contact = document.createElement("p"); contact.textContent = "Телефон: " + row.phone;
        const detail = document.createElement("p");
        detail.textContent = "Цена: " + Number(row.price).toLocaleString("ru-RU") + " ₸";
        const address = document.createElement("p"); address.className = "record-address"; address.textContent = "Адрес: " + (row.addr || "Не требуется");
        item.append(heading, trip, contact, detail, address);
        const location = root.RazvozkaLocation || (typeof require === "function" ? require("./location-picker.js") : null);
        const href = location?.osmURL({lat:row.delivery_lat,lon:row.delivery_lon});
        if (href) {
          const link = document.createElement("a");link.href=href;link.target="_blank";link.rel="noopener";link.textContent="Открыть точку, выбранную родителем ↗";item.append(link);
        }
        if (row.delivery_note) {const note=document.createElement("p");note.textContent="Примечание родителя: "+row.delivery_note;item.append(note);}

        if (needsCheck(row)) {
          const label = document.createElement("label"), select = document.createElement("select");
          select.id = "address-status-" + index;
          label.htmlFor = select.id; label.textContent = "Проверка адреса · запись " + (index + 1);
          for (const [value, text] of Object.entries(STATUSES)) {
            const option = document.createElement("option"); option.value = value; option.textContent = text; select.append(option);
          }
          select.value = store.get(row);
          item.classList.add("status-" + select.value);
          select.addEventListener("change", () => {
            if (!ensureSession()) return;
            store.set(row, select.value);
            item.className = "record status-" + store.get(row);
          });
          item.append(label, select);
        } else {
          const status = document.createElement("p"); status.textContent = "Проверка адреса: Не требуется"; item.append(status);
        }
        $("records").append(item);
      });
    }
    $("login-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (busy) return;
      const password = $("password").value;
      clearSession();
      const operation = ++generation;
      setBusy(true); message("Вход…");
      try {
        if (!config.URL || !config.KEY) throw new Error("Не настроена публичная конфигурация Supabase.");
        const result = await request("/auth/v1/token?grant_type=password", { email: $("email").value.trim(), password });
        if (!result.access_token || !result.user || !result.user.id || !Number.isFinite(result.expires_in)) throw new Error("Не удалось подтвердить вход.");
        const auth = { token: result.access_token, user: result.user.id, expires: Date.now() + result.expires_in * 1000 };
        const selected = filters();
        const list = await readList(auth, selected); // Role is checked by SQL, including for an empty list.
        if (operation !== generation) return;
        session = auth;
        if (!ensureSession()) return;
        let storage;
        try { storage = root.localStorage; } catch (_) { warnStorage(); }
        store = createStore(storage, "razvozka.address-status.v1:" + config.URL + ":" + auth.user, warnStorage);
        rows = list; loadedDate = selected.p_date; store.reconcile(rows);
        $("workspace").hidden = false; $("login-panel").hidden = true;
        timer = setTimeout(() => clearSession("Войдите заново: сеанс завершён."), Math.min(auth.expires - Date.now(), 2147483647));
        root.RazvozkaOrganizerNavigation?.setAuthenticated(true);
        render(); message("Вход выполнен. Отметки проверки — ручные.");
        if(catalogAdmin)catalogAdmin.open();
        if(dispatch)dispatch.open();
      } catch (error) { if (operation === generation) clearSession(error.message); }
      finally { if (operation === generation) setBusy(false); }
    });
    $("filters").addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !ensureSession()) return;
      const operation = ++generation, selected = filters();
      clearList(); setBusy(true); message("Загрузка списка…");
      try {
        const list = await readList(session, selected);
        if (operation !== generation || !ensureSession()) return;
        rows = list; loadedDate = selected.p_date; store.reconcile(rows); render(); message("Список обновлён.");
      } catch (error) {
        if (operation !== generation) return;
        if (error.denied) clearSession(error.message); else message(error.message);
      } finally { if (operation === generation) setBusy(false); }
    });
    $("filters").addEventListener("change", () => { clearList(); message("Фильтры изменены. Нажмите «Показать список»."); });
    $("logout").addEventListener("click", () => clearSession("Вы вышли. Список очищен с экрана."));
    $("export").addEventListener("click", () => {
      if (busy || !ensureSession()) return;
      if (!rows.length) { message("Нет записей для выгрузки"); return; }
      try {
        const bytes = root.RazvozkaXlsx.build(exportRows(rows, store));
        const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = "razvozka-" + loadedDate + ".xlsx";
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message("Файл XLSX подготовлен для скачивания.");
      } catch (_) { message("Не удалось создать XLSX. Повторите попытку."); }
    });
    root.addEventListener("pagehide", () => clearSession());
  }
  const api = { createStore, exportRows, fingerprint, statusText, needsCheck, digest, mount };
  root.RazvozkaOrganizer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined") mount(document, root.CFG || {});
})(globalThis);
