(function (root) {
  "use strict";
  const EMBED = "https://www.openstreetmap.org/export/embed.html?bbox=71.20%2C51.03%2C71.65%2C51.28&layer=mapnik";
  const CITY = "https://www.openstreetmap.org/#map=12/51.16/71.43";
  function searchURL(value) {
    let address = String(value || "").trim().replace(/\s+/g, " ");
    address = address.replace(/^астана\s*[,;:]?\s*/i, "");
    if (address.length < 2 || address.length > 160) throw new Error("Укажите улицу и номер здания (от 2 до 160 символов).");
    const url = new URL("https://www.openstreetmap.org/search");
    url.searchParams.set("query", "Астана, " + address);
    return url.href;
  }
  function mount(document) {
    const $ = id => document.getElementById(id);
    const container = $("astana-map"), status = $("map-status");
    let timer = null, generation = 0;
    function load() {
      const operation = ++generation;
      root.clearTimeout(timer);
      status.textContent = "Загружаем карту Астаны… Если карта недоступна, откройте её по ссылке ниже.";
      const frame = document.createElement("iframe");
      frame.title = "Интерактивная карта Астаны — OpenStreetMap";
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      frame.addEventListener("load", () => {
        if (operation !== generation) return;
        root.clearTimeout(timer);
        status.textContent = "Масштаб и перемещение доступны на карте. Если подложка пустая, используйте ссылку «Открыть карту в отдельной вкладке».";
      });
      frame.addEventListener("error", () => {
        if (operation !== generation) return;
        root.clearTimeout(timer);
        status.textContent = "Не удалось открыть карту. Проверьте интернет или откройте её в отдельной вкладке. Список и Excel доступны независимо от карты.";
      });
      timer = root.setTimeout(() => {
        if (operation === generation) status.textContent = "Карта отвечает дольше обычного. Можно повторить загрузку или открыть её в отдельной вкладке.";
      }, 15000);
      frame.src = EMBED;
      container.replaceChildren(frame);
      $("map-load").textContent = "Обновить карту / вернуться к Астане";
    }
    $("map-load").addEventListener("click", load);
    const updateSearch = () => {
      $("map-search-result").hidden = true;
      $("map-search-result").removeAttribute("href");
      $("map-search-status").textContent = "";
    };
    $("map-address").addEventListener("input", updateSearch);
    $("map-search-form").addEventListener("submit", event => {
      event.preventDefault();
      try {
        const href = searchURL($("map-address").value);
        $("map-search-result").href = href;
        $("map-search-result").hidden = false;
        $("map-search-result").focus();
        $("map-search-status").textContent = "Ссылка готова. Откройте результаты OSM и проверьте улицу и номер здания. Само создание ссылки не подтверждает адрес.";
      } catch (error) { updateSearch(); $("map-search-status").textContent = error.message; }
    });
    return { destroy() { generation++; root.clearTimeout(timer); container.replaceChildren(); } };
  }
  const api = { searchURL, mount, EMBED, CITY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RazvozkaMapSupport = api;
  if (typeof document !== "undefined") mount(document);
})(globalThis);
