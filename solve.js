// solve.js - a faster drop-in for csv-reader 1.0.0 (csv-reader-speed-01).
//
// Same answer as readCsv() for every input, but it never steps a field one character at a time: each field is
// found with indexOf() and taken with slice(), one call for the whole span. The three stops a field can end at
// (comma, LF, CR) are tracked in caches that only ever move forward, so the whole read stays one pass over the
// text and the per-field work is a handful of comparisons.
//
// Speed notes: the unquoted field path is inlined in the record loop (no call per field); a field that is one
// span is returned as a single slice() with no concatenation; only a field split by a stray CR (unquoted) or a
// doubled quote (quoted) ever builds a string. spanValue() returns a segment untouched when it holds no CR and
// no LF (no line counting to do).

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

  // The next ',' , '\n' and '\r' at or after p, or n when there is none left (a cache at n is never
  // recomputed again).
  let nextComma = text.indexOf(',', pos);
  let nextLF = text.indexOf('\n', pos);
  let nextCR = text.indexOf('\r', pos);
  if (nextComma < 0) nextComma = n;
  if (nextLF < 0) nextLF = n;
  if (nextCR < 0) nextCR = n;

  let recordLine = 1;
  let recordRow = null;

  const error = (code) => {
    errors.push({ code, line: recordLine, row: recordRow });
  };

  // The value of a raw span found inside quotes: every CRLF and every lone CR read as LF, and line counted for
  // each of them and for each LF (a quoted CRLF is one line).
  const spanValue = (seg) => {
    // Fast path: no CR and no LF in the span means nothing to convert and no line to count.
    if (seg.indexOf('\r') < 0) {
      if (seg.indexOf('\n') < 0) return seg;
      let i = -1;
      while ((i = seg.indexOf('\n', i + 1)) >= 0) line += 1;
      return seg;
    }
    let out = '';
    let last = 0;
    let i = seg.indexOf('\r');
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

  // What a quoted field read hands back, kept here so a quoted field costs no object.
  let outValue = '';
  let outEnd = END;
  let outAdded = 0;

  // Reads unquoted characters up to the next comma or line break, starting with `head` already in the field
  // ('' normally, '"' when re-reading after an unterminated quote, or a quoted value for quote junk). A CR not
  // followed by LF is dropped (stray_cr). Hands the field back through outValue/outEnd/outAdded. A field that
  // is one span is returned as a single slice() with no concatenation; only a field split by a stray CR builds
  // a string.
  const readUnquoted = (head) => {
    let start = pos;
    let acc = null; // appended segments once a stray CR splits the field
    let added = 0; // characters kept
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
        if (p < n) added += n - start;
        outValue = acc !== null ? acc + text.slice(start, n) : head === '' ? text.slice(start, n) : head + text.slice(start, n);
        pos = n;
        outEnd = END;
        outAdded = added;
        return;
      }
      if (kind === CH_CR) {
        if (text.charCodeAt(t + 1) === CH_LF) {
          added += t - start;
          outValue = acc !== null ? acc + text.slice(start, t) : head === '' ? text.slice(start, t) : head + text.slice(start, t);
          pos = t + 2;
          line += 1;
          outEnd = LINE_BREAK;
          outAdded = added;
          return;
        }
        added += t - start;
        acc = acc !== null ? acc + text.slice(start, t) : head === '' ? text.slice(start, t) : head + text.slice(start, t);
        head = '';
        error('stray_cr');
        pos = t + 1;
        start = pos;
        continue;
      }
      added += t - start;
      outValue = acc !== null ? acc + text.slice(start, t) : head === '' ? text.slice(start, t) : head + text.slice(start, t);
      pos = t + 1;
      if (kind === COMMA) {
        outEnd = COMMA;
        outAdded = added;
        return;
      }
      line += 1;
      outEnd = LINE_BREAK;
      outAdded = added;
      return;
    }
  };

  // Reads a quoted field whose opening quote is at pos: jumps from quote to quote, doubling being one quote.
  // A field that is one span is returned as a single spanValue() result with no concatenation; only a field
  // split by a doubled quote builds a string.
  const readQuoted = () => {
    const open = pos;
    const openLine = line;
    let start = pos + 1;
    let acc = null; // appended segments once a doubled quote splits the field
    let value;
    let closed = false;
    for (;;) {
      const q = text.indexOf('"', start);
      if (q < 0) {
        const tail = spanValue(text.slice(start, n));
        value = acc !== null ? acc + tail : tail;
        pos = n;
        break;
      }
      if (text.charCodeAt(q + 1) === CH_QUOTE) {
        const seg = spanValue(text.slice(start, q));
        acc = acc !== null ? acc + seg + '"' : seg + '"';
        start = q + 2;
        continue;
      }
      const seg = spanValue(text.slice(start, q));
      value = acc !== null ? acc + seg : seg;
      pos = q + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      nextComma = text.indexOf(',', pos);
      nextLF = text.indexOf('\n', pos);
      nextCR = text.indexOf('\r', pos);
      if (nextComma < 0) nextComma = n;
      if (nextLF < 0) nextLF = n;
      if (nextCR < 0) nextCR = n;
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
    let quoted = false;
    let fieldEnd = END;
    for (;;) {
      if (text.charCodeAt(pos) === CH_QUOTE) {
        quoted = true;
        readQuoted();
        fields.push(outValue);
        fieldEnd = outEnd;
      } else {
        // Inline unquoted field: the common path, no call. A field that is one span is a single slice();
        // only a field split by a stray CR builds a string. (No `added` count here: quote_junk only
        // applies to what follows a closing quote, handled by readUnquoted.)
        quoted = false;
        let start = pos;
        let acc = null;
        let value;
        let end;
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
            value = acc !== null ? acc + text.slice(start, n) : text.slice(start, n);
            pos = n;
            end = END;
            break;
          }
          if (kind === CH_CR) {
            if (text.charCodeAt(t + 1) === CH_LF) {
              value = acc !== null ? acc + text.slice(start, t) : text.slice(start, t);
              pos = t + 2;
              line += 1;
              end = LINE_BREAK;
              break;
            }
            acc = acc !== null ? acc + text.slice(start, t) : text.slice(start, t);
            error('stray_cr');
            pos = t + 1;
            start = pos;
            continue;
          }
          value = acc !== null ? acc + text.slice(start, t) : text.slice(start, t);
          pos = t + 1;
          if (kind === COMMA) {
            end = COMMA;
            break;
          }
          line += 1;
          end = LINE_BREAK;
          break;
        }
        fields.push(value);
        fieldEnd = end;
      }
      if (fieldEnd !== COMMA) break;
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
