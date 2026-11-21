// solve.js - a faster drop-in for csv-reader 1.0.0 (csv-reader-speed-01).
//
// Same answer as readCsv() for every input, but it never steps a field one character at a time: each field is
// found with indexOf() and taken with slice(), one call for the whole span. The four stops a field can end at
// (comma, LF, CR, end of text) are tracked in caches that only ever move forward, so the whole read stays one
// pass over the text and the per-field work is a handful of comparisons.

const CH_LF = 10;
const CH_CR = 13;
const CH_QUOTE = 34;

// How a field ended.
const END = 0;
const COMMA = 1;
const LINE_BREAK = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The next ',' , '\n' and '\r' at or after p, or -1 when there is none left; n marks "none left" for the
  // field scan (a cache at n is never recomputed again).
  const resetCaches = (p) => {
    nextComma = text.indexOf(',', p);
    nextLF = text.indexOf('\n', p);
    nextCR = text.indexOf('\r', p);
  };

  let nextComma;
  let nextLF;
  let nextCR;
  resetCaches(pos);

  // What readUnquoted() hands back, kept here so a field costs no object.
  let outValue = '';
  let outEnd = END;
  let outAdded = 0;

  let recordLine = 1;
  let recordRow = null;

  const error = (code) => {
    errors.push({ code, line: recordLine, row: recordRow });
  };

  // The value of a raw span found inside quotes: every CRLF and every lone CR read as LF, and line counted for
  // each of them and for each LF (a quoted CRLF is one line).
  const spanValue = (seg) => {
    const j = seg.indexOf('\r');
    if (j < 0) {
      let i = -1;
      while ((i = seg.indexOf('\n', i + 1)) >= 0) line += 1;
      return seg;
    }
    let out = '';
    let last = 0;
    let i = j;
    let crs = 0;
    let crlf = 0;
    while (i >= 0) {
      out += seg.slice(last, i) + '\n';
      if (seg.charCodeAt(i + 1) === CH_LF) {
        crlf += 1;
        i += 2;
      } else {
        i += 1;
      }
      crs += 1;
      last = i;
      i = seg.indexOf('\r', i);
    }
    out += seg.slice(last);
    let k = -1;
    let lfs = 0;
    while ((k = seg.indexOf('\n', k + 1)) >= 0) lfs += 1;
    line += crs + lfs - crlf;
    return out;
  };

  // Reads unquoted characters onto `value` up to the next comma or line break. A CR not followed by LF is
  // dropped (stray_cr). Returns the field and how it ended through outValue/outEnd/outAdded.
  const readUnquoted = (value) => {
    let start = pos;
    let added = 0;
    for (;;) {
      const p = pos;
      let t;
      let kind;
      if (nextComma < p) {
        nextComma = text.indexOf(',', p);
        if (nextComma < 0) nextComma = n;
      }
      if (nextLF < p) {
        nextLF = text.indexOf('\n', p);
        if (nextLF < 0) nextLF = n;
      }
      if (nextCR < p) {
        nextCR = text.indexOf('\r', p);
        if (nextCR < 0) nextCR = n;
      }
      t = nextComma;
      kind = COMMA;
      if (nextLF < t) {
        t = nextLF;
        kind = LINE_BREAK;
      }
      if (nextCR < t) {
        t = nextCR;
        kind = CH_CR;
      }
      if (t === n) {
        if (p < n) {
          value += text.slice(start, n);
          added += n - start;
        }
        pos = n;
        outValue = value;
        outEnd = END;
        outAdded = added;
        return;
      }
      if (kind === CH_CR) {
        if (text.charCodeAt(t + 1) === CH_LF) {
          value += text.slice(start, t);
          added += t - start;
          pos = t + 2;
          line += 1;
          outValue = value;
          outEnd = LINE_BREAK;
          outAdded = added;
          return;
        }
        value += text.slice(start, t);
        added += t - start;
        error('stray_cr');
        pos = t + 1;
        start = pos;
        continue;
      }
      value += text.slice(start, t);
      added += t - start;
      pos = t + 1;
      if (kind === COMMA) {
        outValue = value;
        outEnd = COMMA;
        outAdded = added;
        return;
      }
      line += 1;
      outValue = value;
      outEnd = LINE_BREAK;
      outAdded = added;
      return;
    }
  };

  // Reads a quoted field whose opening quote is at pos: jumps from quote to quote, doubling being one quote.
  const readQuoted = () => {
    const open = pos;
    const openLine = line;
    let value = '';
    let start = pos + 1;
    let closed = false;
    for (;;) {
      const q = text.indexOf('"', start);
      if (q < 0) {
        value += spanValue(text.slice(start, n));
        pos = n;
        break;
      }
      if (text.charCodeAt(q + 1) === CH_QUOTE) {
        value += spanValue(text.slice(start, q)) + '"';
        start = q + 2;
        continue;
      }
      value += spanValue(text.slice(start, q));
      pos = q + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      resetCaches(pos);
      error('unterminated_quote');
      readUnquoted('"');
      return;
    }
    if (pos >= n) {
      outValue = value;
      outEnd = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      outValue = value;
      outEnd = COMMA;
      return;
    }
    if (c === CH_LF) {
      pos += 1;
      line += 1;
      outValue = value;
      outEnd = LINE_BREAK;
      return;
    }
    if (c === CH_CR && text.charCodeAt(pos + 1) === CH_LF) {
      pos += 2;
      line += 1;
      outValue = value;
      outEnd = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(value);
    if (outAdded > 0) error('quote_junk');
  };

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === CH_LF) {
        pos += 1;
        line += 1;
      } else if (c === CH_CR && text.charCodeAt(pos + 1) === CH_LF) {
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
    let quoted;
    for (;;) {
      quoted = text.charCodeAt(pos) === CH_QUOTE;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(outValue);
      if (outEnd !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
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
