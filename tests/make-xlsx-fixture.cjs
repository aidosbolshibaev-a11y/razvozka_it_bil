// Generates fictional data only. Never reads config.js or calls a server.
const fs = require('node:fs');
const { build } = require('../public/xlsx.js');
const { createStore, exportRows } = require('../public/organizer.js');
const rows = [
  { id: 'test-a', name: 'Учебный Ученик', cls: '7A', date: '2030-01-18', dir: 'fri', tr: 'car', time: '14:00', phone: '0000000001', addr: 'Учебная улица, дом А', addressDigest: 'a', price: 5500, poa: '', pin: 'EXCLUDED_SECRET' },
  { id: 'test-b', name: '=1+1', cls: '8B', date: '2030-01-18', dir: 'sun', tr: 'car', time: '16:00', phone: '0000000002', addr: 'Сынақ & «мекенжай»; <үй>\nЕкінші жол', addressDigest: 'b', price: 6500, poa: '' },
  { id: 'test-c', name: 'Вымышленный Пассажир', cls: '9C', date: '2030-01-18', dir: 'sun', tr: 'train', time: '10:10', phone: '0000000003', addr: '', addressDigest: 'c', price: 0, poa: 'Да' }
];
const store = createStore({ getItem: () => null, setItem() {} }, 'fixture', () => {});
store.set(rows[0], 'checked'); store.set(rows[1], 'missing');
const output = process.argv[2];
if (!output) throw Error('Pass an output .xlsx path');
fs.writeFileSync(output, build(exportRows(rows, store)));
console.log('Fictional XLSX fixture saved.');
