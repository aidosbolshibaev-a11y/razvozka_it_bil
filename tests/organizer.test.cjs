const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const organizer = require('../public/organizer.js');
const { build } = require('../public/xlsx.js');

const row = (overrides = {}) => ({
  id: 'fictional-record-1', name: 'Учебный Ученик', cls: '7A', date: '2030-01-18',
  dir: 'fri', tr: 'car', time: '14:00', phone: '0000000001',
  addr: 'Учебная улица, дом А', price: 5500, poa: '', addressDigest: 'digest-a', ...overrides
});
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data };
}
test('status survives reload, stays isolated by record and user, contains no personal text', () => {
  const memory = storage(), store = organizer.createStore(memory, 'project:user-a', assert.fail);
  store.set(row(), 'checked');
  assert.equal(store.get(row({ id: 'fictional-record-2' })), 'unchecked');
  assert.equal(organizer.createStore(memory, 'project:user-a', assert.fail).get(row()), 'checked');
  assert.equal(organizer.createStore(memory, 'project:user-b', assert.fail).get(row()), 'unchecked');
  assert.equal(memory.getItem('project:user-a').includes('Учебная'), false);
  assert.equal(memory.getItem('project:user-a').includes('0000000001'), false);
});
test('changed address invalidates status permanently, including return to previous address', () => {
  const store = organizer.createStore(storage(), 'test', assert.fail);
  store.set(row(), 'checked');
  const changed = row({ addr: 'Учебная улица, дом Б', addressDigest: 'digest-b' });
  store.reconcile([changed]);
  assert.equal(store.get(changed), 'unchecked');
  store.reconcile([row()]);
  assert.equal(store.get(row()), 'unchecked');
  store.set(row(), 'missing'); assert.equal(store.get(row()), 'missing');
  store.set(row(), 'unchecked'); assert.equal(store.get(row()), 'unchecked');
});
test('fingerprint includes trip, address, date and direction; train needs no check', () => {
  for (const override of [{ addr: 'Б' }, { date: '2030-01-20' }, { dir: 'sun' }, { tr: 'train' }, { time: '16:00' }]) {
    assert.notEqual(organizer.fingerprint(row()), organizer.fingerprint(row(override)));
  }
  const store = organizer.createStore(storage(), 'test', assert.fail);
  const train = row({ tr: 'train', addr: '' });
  store.set(train, 'checked');
  assert.equal(organizer.statusText(train, store), 'Не требуется');
});
test('storage errors and corrupt content warn instead of claiming persistence', () => {
  let warnings = 0;
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  const store = organizer.createStore(broken, 'test', () => warnings++);
  store.set(row(), 'checked');
  assert.equal(store.get(row()), 'checked');
  assert.equal(warnings, 2);
  organizer.createStore({ getItem: () => '{broken', setItem() {} }, 'test', () => warnings++);
  assert.equal(warnings, 3);
});
test('export allowlists columns and preserves text telephone, price and statuses', () => {
  const store = organizer.createStore(storage(), 'test', assert.fail);
  store.set(row(), 'missing');
  const table = organizer.exportRows([row({ pin: 'SECRET_PIN', pin_hash: 'SECRET_HASH' })], store);
  assert.equal(table[0].length, 12);
  assert.deepEqual(table[0].slice(8, 10), ['Адрес', 'Статус проверки адреса']);
  assert.equal(table[1][7], '0000000001'); assert.equal(table[1][9], 'Не найдено');
  assert.equal(table[1][11], 5500);
  assert.equal(JSON.stringify(table).includes('SECRET'), false);
  const zip = build(table); assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4b);
});

class Element {
  constructor() { this.children = []; this.handlers = {}; this.value = ''; this.hidden = false; this.textContent = ''; this.disabled = false; this.className = ''; this.classList = { add: value => { this.className += ' ' + value; } }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  async fire(name) { return this.handlers[name]?.({ preventDefault() {} }); }
  click() { this.clicked = true; }
  remove() {}
}
function harness() {
  const ids = ['trip-date','message','storage-warning','login-form','login-panel','email','password','login-button','workspace','filters','direction','transport','load','logout','export','records','count'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  nodes.workspace.hidden = true; nodes['storage-warning'].hidden = true;
  nodes.email.value = 'organizer@example.invalid'; nodes.password.value = 'fictional-password';
  const body = new Element(), calls = [], responses = [], timers = new Map();
  let id = 0, downloads = 0;
  const context = vm.createContext({
    TextEncoder, Uint8Array, crypto: webcrypto, Blob,
    document: { getElementById: id => nodes[id], createElement: () => new Element(), body },
    CFG: { URL: 'https://fictional.invalid', KEY: 'public-test-key' },
    localStorage: storage(),
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: id => timers.delete(id),
    addEventListener() {},
    URL: { createObjectURL() { downloads++; return 'blob:test'; }, revokeObjectURL() {} },
    RazvozkaXlsx: { build },
    fetch: async (path, options) => { calls.push({ path, options }); const reply = responses.shift(); assert.ok(reply, 'unexpected network call'); return typeof reply === 'function' ? reply() : reply; }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../public/organizer.js'), 'utf8'), context);
  const response = (value, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => value });
  const login = async (list = [row()]) => {
    responses.push(response({ access_token: 'fictional-token', user: { id: 'fictional-organizer' }, expires_in: 3600 }), response({ rows: list }));
    await nodes['login-form'].fire('submit');
  };
  return { nodes, calls, responses, response, login, timers, context, downloads: () => downloads };
}
test('UI: login, role-checked list, local status change, safe XLSX download and logout', async () => {
  const h = harness(); await h.login();
  assert.equal(h.nodes.workspace.hidden, false);
  assert.equal(h.calls.length, 2);
  assert.equal(JSON.parse(h.calls[0].options.body).password, 'fictional-password');
  assert.equal(h.calls[1].options.headers.Authorization, 'Bearer fictional-token');
  const record = h.nodes.records.children[0];
  const select = record.children.find(child => child.id === 'address-status-0');
  select.value = 'checked'; await select.fire('change');
  assert.equal(h.calls.length, 2, 'status must not send network requests');
  await h.nodes.export.fire('click');
  assert.equal(h.downloads(), 1);
  assert.match(h.nodes.message.textContent, /XLSX/);
  assert.equal(h.nodes.password.value, '');
  await h.nodes.logout.fire('click');
  assert.equal(h.nodes.workspace.hidden, true); assert.equal(h.nodes.records.children.length, 0);
});
test('UI: valid user without organizer role cannot reveal workspace or download', async () => {
  const h = harness();
  h.responses.push(h.response({ access_token: 'ordinary-user-token', user: { id: 'ordinary-user' }, expires_in: 3600 }), h.response({}, 403));
  await h.nodes['login-form'].fire('submit');
  assert.equal(h.nodes.workspace.hidden, true); assert.equal(h.nodes.records.children.length, 0);
  assert.match(h.nodes.message.textContent, /Нет доступа/);
  await h.nodes.export.fire('click'); assert.equal(h.downloads(), 0);
});
test('UI: incorrect credentials explain login failure and clear the password field', async () => {
  const h = harness();
  h.responses.push(h.response({}, 400));
  await h.nodes['login-form'].fire('submit');
  assert.match(h.nodes.message.textContent, /Проверьте почту и пароль/);
  assert.equal(h.nodes.password.value, '');
  assert.equal(h.nodes.workspace.hidden, true);
  assert.equal(h.nodes['login-button'].disabled, false);
});
test('UI: missing organizer RPC explains that migration 0003 is required', async () => {
  const h = harness();
  h.responses.push(h.response({ access_token: 'fictional-token', user: { id: 'fictional-organizer' }, expires_in: 3600 }), h.response({}, 404));
  await h.nodes['login-form'].fire('submit');
  assert.match(h.nodes.message.textContent, /0003_organizer_lists.sql/);
  assert.equal(h.nodes.workspace.hidden, true);
  assert.equal(h.nodes['login-button'].disabled, false);
});
test('UI: empty list, filter changes and failed reload never export stale records', async () => {
  const h = harness(); await h.login([]);
  await h.nodes.export.fire('click');
  assert.equal(h.nodes.message.textContent, 'Нет записей для выгрузки'); assert.equal(h.downloads(), 0);
  h.responses.push(h.response({ rows: [row()] })); await h.nodes.filters.fire('submit');
  assert.equal(h.nodes.records.children.length, 1);
  await h.nodes.filters.fire('change'); assert.equal(h.nodes.records.children.length, 0);
  h.responses.push(h.response({}, 500)); await h.nodes.filters.fire('submit');
  await h.nodes.export.fire('click'); assert.equal(h.downloads(), 0);
});
test('UI: logout during pending response prevents late restoration of private list', async () => {
  const h = harness(); await h.login();
  let release;
  h.responses.push(() => new Promise(resolve => { release = resolve; }));
  const pending = h.nodes.filters.fire('submit');
  await h.nodes.logout.fire('click'); release(h.response({ rows: [row()] })); await pending;
  assert.equal(h.nodes.workspace.hidden, true); assert.equal(h.nodes.records.children.length, 0);
});
test('UI: session timeout clears list, expired login cannot export', async () => {
  const h = harness(); await h.login();
  const expire = Array.from(h.timers.values())[0]; expire();
  assert.equal(h.nodes.records.children.length, 0); assert.equal(h.nodes.workspace.hidden, true);
  await h.nodes.export.fire('click'); assert.equal(h.downloads(), 0);
});
