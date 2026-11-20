/* Minimal OOXML workbook: one worksheet, inline strings, no external dependencies.
   ZIP uses the STORE method and CRC32; text is never emitted as an Excel formula. */
(function (root) {
  "use strict";
  const encoder = new TextEncoder();
  const xml = value => String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  function column(index) {
    let name = "";
    for (index++; index; index = Math.floor((index - 1) / 26)) {
      name = String.fromCharCode(65 + (index - 1) % 26) + name;
    }
    return name;
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function header(size, signature) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, signature, true);
    return { bytes, view };
  }
  function join(parts) {
    const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }
  function zip(files) {
    const local = [], central = [];
    let offset = 0;
    for (const [path, content] of Object.entries(files)) {
      const name = encoder.encode(path), data = encoder.encode(content), crc = crc32(data);
      const l = header(30, 0x04034b50), c = header(46, 0x02014b50);
      l.view.setUint16(4, 20, true);
      l.view.setUint16(12, 33, true); // 1980-01-01, valid DOS date
      l.view.setUint32(14, crc, true);
      l.view.setUint32(18, data.length, true); l.view.setUint32(22, data.length, true);
      l.view.setUint16(26, name.length, true);
      c.view.setUint16(4, 20, true); c.view.setUint16(6, 20, true);
      c.view.setUint16(14, 33, true);
      c.view.setUint32(16, crc, true);
      c.view.setUint32(20, data.length, true); c.view.setUint32(24, data.length, true);
      c.view.setUint16(28, name.length, true); c.view.setUint32(42, offset, true);
      local.push(l.bytes, name, data); central.push(c.bytes, name);
      offset += l.bytes.length + name.length + data.length;
    }
    const directory = join(central), end = header(22, 0x06054b50);
    end.view.setUint16(8, central.length / 2, true); end.view.setUint16(10, central.length / 2, true);
    end.view.setUint32(12, directory.length, true); end.view.setUint32(16, offset, true);
    return join([...local, directory, end.bytes]);
  }
  function build(rows) {
    if (!rows.length || rows.length > 100000) throw new Error("Unsupported worksheet size");
    const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const widths = [6, 34, 10, 16, 30, 18, 12, 20, 48, 24, 18, 18];
    const sheetRows = rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((value, c) => {
      const ref = column(c) + (r + 1), style = r === 0 ? 1 : (c === 11 ? 3 : 2);
      if (r > 0 && (c === 0 || c === 11) && typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("") + '</row>').join("");
    return zip({
      "[Content_Types].xml": declaration + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      "_rels/.rels": declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml": declaration + `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Список развозки" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      "xl/styles.xml": declaration + `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode='#,##0 "₸"'/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      "xl/worksheets/sheet1.xml": declaration + `<worksheet xmlns="${ns}"><dimension ref="A1:L${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="32"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:L${rows.length}"/></worksheet>`
    });
  }
  root.RazvozkaXlsx = { build };
  if (typeof module !== "undefined" && module.exports) module.exports = { build };
})(globalThis);
