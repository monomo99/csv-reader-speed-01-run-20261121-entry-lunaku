// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answer as csv-reader on every input {text, header} -> {columns, rows, errors},
// but built for speed: the text is scanned by native regex search (one pass, no
// per-character loop), fields are cut out with slice() instead of built up a
// character at a time, and the common paths (plain field, plain quoted field)
// never allocate beyond the field string itself.
//
// Semantics (csv-reader's broken-row policy, verbatim):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside is one quote; each CRLF or lone CR inside reads as LF; what follows
//   the closing quote, up to the next comma or line break, is appended as it
//   stands (quote_junk when the field ends); a quote that never closes is a
//   literal character and the text after it is read again as unquoted
//   (unterminated_quote).
// - A quote inside an unquoted field is a literal character. Fields stay
//   strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows are the
//   records after it, each padded with "" (short_row, with fields: its count)
//   or cut (long_row, with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on (every LF, CRLF and lone CR inside quotes
//   counted), row its record's index in rows, null for the header.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Ended codes: 0 = comma, 1 = line break, 2 = end of text.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Delimiters while unquoted (a quote there is literal, so it is skipped and
  // stays inside the slice); interesting characters inside a quoted field.
  const unq = /[",\r\n]/g;
  const quo = /["\r\n]/g;

  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field from pos, starting from the prefix `pre` ('' in
  // the normal case, the quoted content for quote junk, '"' for an
  // unterminated quote). Returns {value, ended, added}; `added` counts only
  // the characters this call kept, which is what the quote_junk check needs.
  function readUnquoted(pre) {
    let parts = null;
    let start = pos;
    let added = 0;
    for (;;) {
      unq.lastIndex = pos;
      const m = unq.exec(text);
      if (m === null) {
        const tail = text.slice(start);
        added += tail.length;
        pos = n;
        return { value: parts ? pre + parts.join('') + tail : pre + tail, ended: 2, added };
      }
      const i = m.index;
      const ch = m[0];
      if (ch === '"') {
        pos = i + 1;
        continue;
      }
      if (ch === ',') {
        const seg = text.slice(start, i);
        added += seg.length;
        pos = i + 1;
        return { value: parts ? pre + parts.join('') + seg : pre + seg, ended: 0, added };
      }
      if (ch === '\n') {
        const seg = text.slice(start, i);
        added += seg.length;
        pos = i + 1;
        line += 1;
        return { value: parts ? pre + parts.join('') + seg : pre + seg, ended: 1, added };
      }
      // ch === '\r'
      if (text.charCodeAt(i + 1) === 10) {
        const seg = text.slice(start, i);
        added += seg.length;
        pos = i + 2;
        line += 1;
        return { value: parts ? pre + parts.join('') + seg : pre + seg, ended: 1, added };
      }
      // Lone CR outside quotes: dropped, error recorded, field goes on.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      const seg = text.slice(start, i);
      added += seg.length;
      if (parts) parts.push(seg);
      else parts = [seg];
      pos = i + 1;
      start = i + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let parts = null;
    let start = pos + 1;
    let value = '';
    pos = pos + 1;
    let closed = false;
    for (;;) {
      quo.lastIndex = pos;
      const m = quo.exec(text);
      if (m === null) break;
      const i = m.index;
      const ch = m[0];
      if (ch === '"') {
        if (text.charCodeAt(i + 1) === 34) {
          // Doubled quote: one literal quote.
          const seg = text.slice(start, i);
          if (parts) parts.push(seg, '"');
          else parts = [seg, '"'];
          pos = i + 2;
          start = i + 2;
          continue;
        }
        const seg = text.slice(start, i);
        value = parts ? parts.join('') + seg : seg;
        pos = i + 1;
        closed = true;
        break;
      }
      if (ch === '\r') {
        // CRLF and a lone CR inside quotes are each one LF.
        const seg = text.slice(start, i);
        if (parts) parts.push(seg, '\n');
        else parts = [seg, '\n'];
        line += 1;
        pos = text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
        start = pos;
        continue;
      }
      // '\n' inside quotes: one LF, line counted.
      const seg = text.slice(start, i);
      if (parts) parts.push(seg, '\n');
      else parts = [seg, '\n'];
      line += 1;
      pos = i + 1;
      start = i + 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    if (pos >= n) return { value, ended: 2 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: 0 };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: 1 };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: 1 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
