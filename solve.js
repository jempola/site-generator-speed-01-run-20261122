// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// Byte-identical output, built for CPU time: fused single-pass Markdown,
// bulk-run inline scanner, cached slugs, compiled templates (new Function),
// allocation-light pipeline. Written fresh in this session from the kit's
// README + reference code (baseline/makefun-site/vendor/makefun-site/).

const ESC_BY_CODE = [];
ESC_BY_CODE[38] = '&amp;';
ESC_BY_CODE[60] = '&lt;';
ESC_BY_CODE[62] = '&gt;';
ESC_BY_CODE[34] = '&quot;';
ESC_BY_CODE[39] = '&#39;';
export function escapeHtml(text) {
  let out = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const e = ESC_BY_CODE[text.charCodeAt(i)];
    if (e !== undefined) {
      if (out === null) out = text.slice(0, i);
      else out += text.slice(start, i);
      out += e;
      start = i + 1;
    }
  }
  if (out === null) return text;
  return out + text.slice(start);
}

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SLUG_MAX = 64;

// ---------------------------------------------------------------- text
// slugify with a per-run cache (cache lives in a Map passed around via `cx`).
function slugify(text, cache) {
  let out = cache.get(text);
  if (out !== undefined) return out;
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let s = '';
  let gap = false;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    let keep = -1;
    if (cp >= 65 && cp <= 90) keep = cp + 32;
    else if ((cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57)) keep = cp;
    if (keep === -1) {
      gap = s.length > 0;
      continue;
    }
    if (gap) s += '-';
    gap = false;
    s += String.fromCharCode(keep);
  }
  s = s.slice(0, SLUG_MAX).replace(/-+$/, '');
  out = s === '' ? 'untitled' : s;
  cache.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const LONG_DATE_CACHE = new Map();
function longDate(date) {
  let out = LONG_DATE_CACHE.get(date);
  if (out !== undefined) return out;
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  out = `${d} ${MONTHS[m - 1]} ${y}`;
  LONG_DATE_CACHE.set(date, out);
  return out;
}

// words: runs of non-whitespace (\S), counted per line (a word never spans '\n').
const WS_ASCII = new Uint8Array(128);
WS_ASCII[9] = 1;
WS_ASCII[10] = 1;
WS_ASCII[11] = 1;
WS_ASCII[12] = 1;
WS_ASCII[13] = 1;
WS_ASCII[32] = 1;
function wordsOf(lines) {
  let n = 0;
  for (const line of lines) {
    let inWord = false;
    for (let i = 0; i < line.length; i++) {
      if (isWsChar(line.charCodeAt(i))) inWord = false;
      else if (!inWord) {
        inWord = true;
        n++;
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------- front matter
const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return line.slice(a, b);
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    // quoted
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      let ok = false;
      let y = 0;
      let mo = 0;
      let d = 0;
      if (raw.length === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45) {
        let digits = true;
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          const c = raw.charCodeAt(i);
          if (c < 48 || c > 57) { digits = false; break; }
        }
        if (digits) {
          y = Number(raw.slice(0, 4));
          mo = Number(raw.slice(5, 7));
          d = Number(raw.slice(8, 10));
          ok = y >= 1970 && y <= 2099 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo);
        }
      }
      if (!ok) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) if (t === '' || !TAG_RE.test(t)) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlankLine(line) || line.charCodeAt(0) === 35) continue; // blank or '#...'
    const colon = line.indexOf(':');
    if (colon === -1) return { error: `line ${i + 1} is not "key: value"` };
    const key = line.slice(0, colon);
    let keyOk = key.length > 0;
    for (let k = 0; keyOk && k < key.length; k++) {
      const c = key.charCodeAt(k);
      if (!((c >= 97 && c <= 122) || c === 95)) keyOk = false;
    }
    if (!keyOk) return { error: `line ${i + 1} is not "key: value"` };
    let raw;
    const rest = line.slice(colon + 1);
    if (rest === '') raw = '';
    else if (rest.charCodeAt(0) === 32) raw = rest.slice(1);
    else return { error: `line ${i + 1} is not "key: value"` };
    // trailing spaces/tabs dropped
    let e = raw.length;
    while (e > 0 && (raw.charCodeAt(e - 1) === 32 || raw.charCodeAt(e - 1) === 9)) e--;
    raw = raw.slice(0, e);
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, bodyLines: lines.slice(close + 1) };
}

// ---------------------------------------------------------------- markdown
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** Whether the `what` at `j` is escaped: the run of backslashes right before it is odd. */
function isEscapedAt(s, j) {
  let k = j - 1;
  let n = 0;
  while (k >= 0 && s.charCodeAt(k) === 92) {
    n++;
    k--;
  }
  return (n & 1) === 1;
}

function findUnescaped(s, what, from) {
  let j = s.indexOf(what, from);
  while (j !== -1 && isEscapedAt(s, j)) j = s.indexOf(what, j + 1);
  return j;
}

function findSingleStar(s, from) {
  let j = s.indexOf('*', from);
  while (j !== -1) {
    if (isEscapedAt(s, j)) {
      j = s.indexOf('*', j + 1);
      continue;
    }
    if (s[j + 1] === '*') {
      j = s.indexOf('*', j + 2);
      continue;
    }
    return j;
  }
  return -1;
}

function isWsChar(c) {
  if (c < 128) return WS_ASCII[c] === 1;
  return c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

function hasWhitespace(s) {
  for (let i = 0; i < s.length; i++) if (isWsChar(s.charCodeAt(i))) return true;
  return false;
}

// Inline renderer, single pass: one char-class table drives plain runs,
// HTML escaping and construct starts together; pieces joined once at the end.
const CLS = new Uint8Array(128);
CLS[38] = 1; CLS[60] = 1; CLS[62] = 1; CLS[34] = 1; CLS[39] = 1; // & < > " ' -> escape
CLS[92] = 2; CLS[96] = 2; CLS[42] = 2; CLS[91] = 2; // \ ` * [ -> construct
function inline(s, link) {
  const out = [];
  let i = 0;
  let seg = 0;
  const n = s.length;
  while (i < n) {
    const cc = s.charCodeAt(i);
    const k = cc < 128 ? CLS[cc] : 0;
    if (k === 0) {
      i++;
      continue;
    }
    if (k === 1) {
      if (i > seg) out.push(s.slice(seg, i));
      out.push(ESC_BY_CODE[cc]);
      i++;
      seg = i;
      continue;
    }
    // construct starter at i
    if (i > seg) out.push(s.slice(seg, i));
    const c = s[i];
    if (c === '\\') {
      if (i + 1 < n && ESCAPABLE.has(s[i + 1])) {
        out.push(s[i + 1]);
        i += 2;
      } else {
        out.push('\\');
        i++;
      }
      seg = i;
      continue;
    }
    if (c === '`') {
      const kk = s.indexOf('`', i + 1);
      if (kk > i + 1) {
        out.push('<code>', escapeHtml(s.slice(i + 1, kk)), '</code>');
        i = kk + 1;
      } else {
        out.push('`');
        i++;
      }
      seg = i;
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const kk = findUnescaped(s, '**', i + 2);
        if (kk > i + 2) {
          const inner = s.slice(i + 2, kk);
          out.push('<strong>', inner.indexOf('\\') === -1 && inner.indexOf('`') === -1 && inner.indexOf('*') === -1 && inner.indexOf('[') === -1 ? escapeHtml(inner) : inline(inner, link), '</strong>');
          i = kk + 2;
        } else {
          out.push('**');
          i += 2;
        }
      } else {
        const kk = findSingleStar(s, i + 1);
        if (kk > i + 1) {
          const inner = s.slice(i + 1, kk);
          out.push('<em>', inner.indexOf('\\') === -1 && inner.indexOf('`') === -1 && inner.indexOf('*') === -1 && inner.indexOf('[') === -1 ? escapeHtml(inner) : inline(inner, link), '</em>');
          i = kk + 1;
        } else {
          out.push('*');
          i++;
        }
      }
      seg = i;
      continue;
    }
    // '['
    const kk = findUnescaped(s, ']', i + 1);
    const m = kk !== -1 && s[kk + 1] === '(' ? s.indexOf(')', kk + 2) : -1;
    const target = m === -1 ? '' : s.slice(kk + 2, m);
    if (target !== '' && !hasWhitespace(target)) {
      const inner = s.slice(i + 1, kk);
      out.push('<a href="', escapeHtml(link(target)), '">', inner.indexOf('\\') === -1 && inner.indexOf('`') === -1 && inner.indexOf('*') === -1 && inner.indexOf('[') === -1 ? escapeHtml(inner) : inline(inner, link), '</a>');
      i = m + 1;
    } else {
      out.push('[');
      i++;
    }
    seg = i;
  }
  if (seg < n) out.push(s.slice(seg));
  return out.join('');
}

// Block classification helpers (manual, no regex in the hot loop).
function fenceOpenOf(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  const start = i;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = line.slice(start, i);
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  return i === line.length ? lang : null;
}

function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function headingOf(line) {
  let h = 0;
  while (h < line.length && line.charCodeAt(h) === 35) h++;
  if (h === 0 || h > 6) return null;
  let s = h;
  while (s < line.length && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  if (s === h) return null;
  let e = line.length;
  while (e > s && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  const text = line.slice(s, e);
  return text === '' ? null : { depth: h, text };
}

// Classify a line once: 0 paragraph, 1 blank, 2 fence, 3 heading, 4 hr, 5 quote, 6 bullet, 7 ordered.
function classifyLine(line) {
  const L = line.length;
  if (L === 0) return 1;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) {
    for (let i = 1; i < L; i++) {
      const c = line.charCodeAt(i);
      if (c !== 32 && c !== 9) return 0;
    }
    return 1;
  }
  if (c0 === 96) {
    if (L >= 3 && line.charCodeAt(1) === 96 && line.charCodeAt(2) === 96 && fenceOpenOf(line) !== null) return 2;
    return 0;
  }
  if (c0 === 35) return headingOf(line) !== null ? 3 : 0;
  if (c0 === 45 || c0 === 42) {
    if (L >= 3 && line.charCodeAt(1) === c0 && line.charCodeAt(2) === c0) {
      let ok = true;
      for (let i = 3; i < L; i++) {
        const c = line.charCodeAt(i);
        if (c !== 32 && c !== 9) {
          ok = false;
          break;
        }
      }
      if (ok) return 4;
    }
    if (line.charCodeAt(1) === 32) return 6;
    return 0;
  }
  if (c0 === 62) return 5;
  if (c0 >= 48 && c0 <= 57) return orderedOf(line) !== null ? 7 : 0;
  return 0;
}

/** An ordered-list marker: { num, text } or null. */
function orderedOf(line) {
  let d = 0;
  let v = 0;
  while (d < 9 && d < line.length && line.charCodeAt(d) >= 48 && line.charCodeAt(d) <= 57) {
    v = v * 10 + (line.charCodeAt(d) - 48);
    d++;
  }
  if (d >= 1 && line.charCodeAt(d) === 46 && line.charCodeAt(d + 1) === 32) return { num: v, text: line.slice(d + 2) };
  return null;
}

// Whether `line` ends a paragraph: blank, fence, heading or hr.
function endsParagraph(line) {
  const L = line.length;
  if (L === 0) return true;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) {
    for (let i = 1; i < L; i++) {
      const c = line.charCodeAt(i);
      if (c !== 32 && c !== 9) return false;
    }
    return true;
  }
  if (c0 === 96) return L >= 3 && line.charCodeAt(1) === 96 && line.charCodeAt(2) === 96 && fenceOpenOf(line) !== null;
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) {
    if (L >= 3 && line.charCodeAt(1) === c0 && line.charCodeAt(2) === c0) {
      for (let i = 3; i < L; i++) {
        const c = line.charCodeAt(i);
        if (c !== 32 && c !== 9) return false;
      }
      return true;
    }
    return false;
  }
  return false;
}

// Render body lines to { html, toc, excerpt } — fused lex + render, no token array.
function renderMarkdown(lines, link, slugCache) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const L = lines.length;
  while (i < L) {
    const line = lines[i];
    const kind = classifyLine(line);
    if (kind === 1) {
      i++;
      continue;
    }
    if (kind === 2) {
      const lang = fenceOpenOf(line);
      const body = [];
      i++;
      while (i < L && !isFenceClose(lines[i])) body.push(lines[i++]);
      i++;
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
      const inner = body.length === 0 ? '' : `${escapeHtml(body.join('\n'))}\n`;
      blocks.push(`<pre><code${cls}>${inner}</code></pre>`);
      continue;
    }
    if (kind === 3) {
      const heading = headingOf(line);
      const id = uniqueSlug(slugify(heading.text, slugCache), ids);
      const html = inline(heading.text, link);
      blocks.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>`);
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++;
      continue;
    }
    if (kind === 4) {
      blocks.push('<hr>');
      i++;
      continue;
    }
    if (kind === 5) {
      // blockquote
      const body = [];
      while (i < L && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.startsWith('> ') ? l.slice(2) : l.slice(1));
      }
      const ls = [];
      for (const l of body) {
        const t = trimLine(l);
        if (t !== '') ls.push(t);
      }
      blocks.push(ls.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(ls.join('\n'), link)}</p>\n</blockquote>`);
      continue;
    }
    if (kind === 6 || kind === 7) {
      const markerIsOrdered = kind === 7;
      const firstOrd = markerIsOrdered ? orderedOf(line) : null;
      const ordNum = markerIsOrdered ? firstOrd.num : 1;
      const items = [];
      while (i < L) {
        const l = lines[i];
        if (markerIsOrdered) {
          const o = orderedOf(l);
          if (o !== null) {
            items.push([trimLine(o.text)]);
            i++;
            continue;
          }
        } else if ((l.charCodeAt(0) === 45 || l.charCodeAt(0) === 42) && l.charCodeAt(1) === 32) {
          items.push([trimLine(l.slice(2))]);
          i++;
          continue;
        }
        // continuation: /^ {2,}\S/ — 2+ literal spaces, then a non-whitespace char
        let p = 0;
        while (p < l.length && l.charCodeAt(p) === 32) p++;
        if (p >= 2 && p < l.length && !isWsChar(l.charCodeAt(p))) {
          items[items.length - 1].push(trimLine(l));
          i++;
          continue;
        }
        break;
      }
      const tag = markerIsOrdered ? 'ol' : 'ul';
      const open = markerIsOrdered && ordNum !== 1 ? `<ol start="${ordNum}">` : `<${tag}>`;
      let b = `${open}\n`;
      for (const parts of items) b += `<li>${inline(parts.join('\n'), link)}</li>\n`;
      b += `</${tag}>`;
      blocks.push(b);
      continue;
    }
    // paragraph
    const body = [trimLine(line)];
    i++;
    while (i < L && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), link);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  return { html: blocks.length === 0 ? '' : `${blocks.join('\n')}\n`, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates
class TemplateError extends Error {}
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// --- template compiler: AST -> JS function (V = flat scope, T = compiled map, D = depth, H = helpers)
const H = {
  g(v, k) {
    return v !== null && typeof v === 'object' && Object.hasOwn(v, k) ? v[k] : undefined;
  },
  textOf(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) {
      let s = '';
      for (let i = 0; i < v.length; i++) {
        if (i > 0) s += ', ';
        s += H.textOf(v[i]);
      }
      return s;
    }
    return '';
  },
  truthy(v) {
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
  },
  esc: escapeHtml,
};

function chainExpr(path) {
  // V is a null-prototype object, so its first segment needs no hasOwn guard.
  let e = `V[${JSON.stringify(path[0])}]`;
  for (let k = 1; k < path.length; k++) e = `H.g(${e},${JSON.stringify(path[k])})`;
  return e;
}

function compileNodes(nodes, out) {
  for (const n of nodes) {
    if (n.kind === 'text') out.push(`o.push(${JSON.stringify(n.text)});`);
    else if (n.kind === 'var') out.push(`o.push(H.esc(H.textOf(${chainExpr(n.path)})));`);
    else if (n.kind === 'raw') out.push(`o.push(H.textOf(${chainExpr(n.path)}));`);
    else if (n.kind === 'if') {
      const cond = n.not ? `!H.truthy(${chainExpr(n.path)})` : `H.truthy(${chainExpr(n.path)})`;
      out.push(`if(${cond}){`);
      compileNodes(n.then, out);
      out.push('}');
      if (n.else !== null) {
        out.push('else{');
        compileNodes(n.else, out);
        out.push('}');
      }
    } else if (n.kind === 'for') {
      const v = JSON.stringify(n.name);
      out.push(`{const _xs=${chainExpr(n.path)};if(Array.isArray(_xs)){for(let _k=0;_k<_xs.length;_k++){const _p0=V[${v}];const _ph=Object.hasOwn(V,${v});const _l0=V.loop;const _lh=Object.hasOwn(V,'loop');V[${v}]=_xs[_k];V.loop={index:_k+1,first:_k===0,last:_k===_xs.length-1,length:_xs.length};`);
      compileNodes(n.body, out);
      out.push('if(_ph)V[' + v + ']=_p0;else delete V[' + v + '];if(_lh)V.loop=_l0;else delete V.loop;}}}');
    } else if (n.kind === 'include') {
      out.push(`{const _f=T.get(${JSON.stringify(n.name)});if(_f!==undefined&&D<8)o.push(_f(V,T,D+1,H));}`);
    }
  }
}

function compileTemplate(nodes) {
  const parts = ['let o=[];'];
  compileNodes(nodes, parts);
  parts.push('return o.join("");');
  return new Function('V', 'T', 'D', 'H', parts.join(''));
}

// ---------------------------------------------------------------- build
/** Whether `target` opens with a URI scheme: a letter, then letters/digits/+/-/. up to ':'. */
function hasScheme(t) {
  const c0 = t.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 58) return true;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return false;
  }
  return false;
}

function resolvePathFrom(dirParts, rel) {
  const parts = dirParts.slice();
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export function run(input) {
  const slugCache = new Map();
  const report = [];
  const templates = new Map();
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(parseTemplate(name, input.templates[name])));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');

  // sources, sorted by path
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  // front matter + checks, in order
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.bodyLines = fm.bodyLines;
    s.post = s.path.startsWith('posts/');
    let own;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // permalinks
  const taken = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? ['posts', 'tags', 'page'] : []);
      taken.set(dir, set);
    }
    s.slug = uniqueSlug(s.data.slug ?? slugify(s.data.title, slugCache), set);
    s.outDir = dir === '' ? s.slug : `${dir}/${s.slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // markdown
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const dirParts = dir === '' ? [] : dir.split('/');
    const link = (target) => {
      if (hasScheme(target) || target.startsWith('/') || target.startsWith('#')) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePathFrom(dirParts, rel);
      if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
      broken.add(`broken-link ${s.path} -> ${target}`);
      return target;
    };
    const md = renderMarkdown(s.bodyLines, link, slugCache);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // collections
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name, slugCache);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name, slugCache);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name, slugCache);
      return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // layouts
  const tagCardCache = new Map();
  const tagCardOf = (t) => {
    let c = tagCardCache.get(t);
    if (c === undefined) {
      c = { name: t.name, slug: t.slug, url: t.url };
      tagCardCache.set(t, c);
    }
    return c;
  };
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.bodyLines) / 200)),
    tags: s.tagRefs.map(tagCardOf),
  });
  const cards = new Map();
  for (const p of posts) cards.set(p, cardOf(p));
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const output = {};
  const render = (name, vars) => {
    const fn = templates.get(name);
    if (fn === undefined) return null;
    const V = Object.assign(Object.create(null), { site, tags: allTags, recent }, vars);
    return fn(V, templates, 0, H);
  };
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  for (const s of kept) {
    const card = cards.get(s) ?? cardOf(s);
    const page = {
      ...card,
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    output[`${s.outDir}/index.html`] = render(s.layout, { page });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // report
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
