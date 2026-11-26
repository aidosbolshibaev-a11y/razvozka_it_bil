(function (root) {
  "use strict";
  const ROUTES = ["info", "form", "mine"];
  function mount(document, browser) {
    const panels = ROUTES.map(id => document.getElementById(id));
    const links = [...document.querySelectorAll("[data-parent-route]")];
    const menuLinks = [...document.querySelectorAll(".parent-nav [data-parent-route]")];
    const headingIds = { info: "info-title", form: "formTitle", mine: "mine-title" };
    function show(id, { history = true, focus = true } = {}) {
      if (!ROUTES.includes(id)) id = "info";
      panels.forEach(panel => { panel.hidden = panel.id !== id; });
      menuLinks.forEach(link => {
        if (link.dataset.parentRoute === id) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
      if (history && browser.location.hash !== "#" + id) browser.history.pushState(null, "", "#" + id);
      if (focus) {
        const heading = document.getElementById(headingIds[id]);
        heading.focus({ preventScroll: true });
        browser.scrollTo({ top: 0, behavior: "auto" });
      }
    }
    links.forEach(link => link.addEventListener("click", event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); show(link.dataset.parentRoute);
    }));
    const restore = () => show(browser.location.hash.slice(1), { history: false, focus: false });
    browser.addEventListener("hashchange", restore);
    browser.addEventListener("popstate", restore);
    restore();
    return { show };
  }
  const api = { mount, show() {} };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RazvozkaParentNavigation = api;
  if (typeof document !== "undefined") api.show = mount(document, root).show;
})(globalThis);
