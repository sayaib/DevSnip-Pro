/*
 * Code Diff Checker engine: pure functions shared by the page, its Web Worker
 * and the unit tests. Nothing here touches the DOM.
 *
 * The factory must stay self-contained (no references outside its own body):
 * the page turns its source into a Worker with `String(factory)`, so the
 * comparison runs off the UI thread without a separate worker file.
 *
 *   compute(left, right, options)   line diff model for both texts
 *   inlineDiff(a, b, options)       changed character ranges inside a modified line
 *   tokenize(text, language)        syntax tokens as [start, end, class] triples
 *   unifiedPatch(...)               a standard unified diff (git apply / patch compatible)
 *   lineHtml(...)                   one line as escaped HTML with syntax and change spans
 */
(function (root, factory) {
  var api = factory();
  api.factorySource = String(factory);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CodeDiffEngine = api;
})(typeof self !== "undefined" ? self : this, function factory() {
  "use strict";

  var KIND_EQUAL = 0, KIND_DELETE = 1, KIND_INSERT = 2;

  // ---------------------------------------------------------------------------
  // Lines
  // ---------------------------------------------------------------------------

  /**
   * Splits text into lines on \r\n, \n or \r. Returns line start/end offsets
   * (so lines can be sliced from the original text on demand), the line-ending
   * style and whether the text ends with a line break.
   */
  function splitLines(text) {
    text = text == null ? "" : String(text);
    var starts = [], ends = [];
    var crlf = 0, lf = 0, cr = 0;
    var start = 0, n = text.length;
    for (var i = 0; i < n; i++) {
      var c = text.charCodeAt(i);
      if (c === 10 || c === 13) {
        starts.push(start); ends.push(i);
        if (c === 13 && text.charCodeAt(i + 1) === 10) { crlf++; i++; }
        else if (c === 13) cr++;
        else lf++;
        start = i + 1;
      }
    }
    var finalNewline = n > 0 && start === n;
    if (start < n) { starts.push(start); ends.push(n); }
    var kinds = (crlf ? 1 : 0) + (lf ? 1 : 0) + (cr ? 1 : 0);
    var eol = kinds === 0 ? "none" : kinds > 1 ? "mixed" : crlf ? "CRLF" : lf ? "LF" : "CR";
    return { starts: Int32Array.from(starts), ends: Int32Array.from(ends), count: starts.length, eol: eol, finalNewline: finalNewline };
  }

  function lineAt(text, split, index) {
    return text.slice(split.starts[index], split.ends[index]);
  }

  /** The comparison key of a line under the ignore options. */
  function keyOf(line, options) {
    if (options.ignoreWhitespace) line = line.replace(/\s+/g, "");
    if (options.ignoreCase) line = line.toLowerCase();
    return line;
  }

  // ---------------------------------------------------------------------------
  // Sequence diff: patience anchors, then Myers' O(ND) middle-snake bisection
  // ---------------------------------------------------------------------------

  /**
   * Diffs two integer sequences. Returns runs as a flat array
   * [kind, count, kind, count, ...]. Never fails: when the time budget runs out
   * the remaining regions are reported as a whole delete plus insert (still a
   * correct diff, just not minimal) and `approximate` is set.
   */
  function diffSequences(a, b, options) {
    options = options || {};
    var deadline = options.deadline || Infinity;
    var patience = options.patience !== false;
    var PATIENCE_MIN = options.patienceMin >= 0 ? options.patienceMin : 4000;
    var runs = [];
    var state = { approximate: false };

    function push(kind, count) {
      if (count <= 0) return;
      var last = runs.length - 2;
      if (last >= 0 && runs[last] === kind) runs[last + 1] += count;
      else runs.push(kind, count);
    }

    var depth = 0;
    function region(aLo, aHi, bLo, bHi, usePatience) {
      // Common prefix and suffix.
      while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) { aLo++; bLo++; push(KIND_EQUAL, 1); }
      var suffix = 0;
      while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) { aHi--; bHi--; suffix++; }
      if (aLo === aHi) push(KIND_INSERT, bHi - bLo);
      else if (bLo === bHi) push(KIND_DELETE, aHi - aLo);
      else if (Date.now() > deadline) { state.approximate = true; push(KIND_DELETE, aHi - aLo); push(KIND_INSERT, bHi - bLo); }
      else {
        depth++;
        // Myers gives the minimal diff; patience anchors only split very large
        // regions first, where they keep the work bounded on real code.
        var big = (aHi - aLo) + (bHi - bLo) > PATIENCE_MIN;
        if (!(usePatience && big && depth < 400 && patienceRegion(aLo, aHi, bLo, bHi))) bisect(aLo, aHi, bLo, bHi);
        depth--;
      }
      push(KIND_EQUAL, suffix);
    }

    // Lines that occur exactly once on each side anchor the diff (patience
    // diff), which keeps code blocks aligned on their distinctive lines.
    function patienceRegion(aLo, aHi, bLo, bHi) {
      var counts = new Map(), i, v, e;
      for (i = aLo; i < aHi; i++) {
        v = a[i]; e = counts.get(v);
        if (!e) counts.set(v, { a: 1, b: 0, ai: i, bi: -1 });
        else e.a++;
      }
      for (i = bLo; i < bHi; i++) {
        e = counts.get(b[i]);
        if (e) { e.b++; e.bi = i; }
      }
      var cand = [], shared = false;
      for (i = aLo; i < aHi; i++) {
        e = counts.get(a[i]);
        if (e.b) shared = true;
        if (e.a === 1 && e.b === 1) cand.push(e);
      }
      // Nothing in common: the answer is known without searching.
      if (!shared) { push(KIND_DELETE, aHi - aLo); push(KIND_INSERT, bHi - bLo); return true; }
      if (!cand.length) return false;
      // Longest increasing subsequence of the b positions (patience sorting).
      var tails = [], prev = new Int32Array(cand.length), tailIdx = [];
      for (i = 0; i < cand.length; i++) {
        var x = cand[i].bi, lo = 0, hi = tails.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
        tails[lo] = x; tailIdx[lo] = i;
        prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
      }
      var anchors = [];
      for (var k = tailIdx[tails.length - 1]; k !== -1; k = prev[k]) anchors.push(cand[k]);
      anchors.reverse();
      var ca = aLo, cb = bLo;
      for (i = 0; i < anchors.length; i++) {
        region(ca, anchors[i].ai, cb, anchors[i].bi, true);
        push(KIND_EQUAL, 1);
        ca = anchors[i].ai + 1; cb = anchors[i].bi + 1;
      }
      region(ca, aHi, cb, bHi, true);
      return true;
    }

    // Myers' linear-space bisection: find the middle snake, split there and recurse.
    function bisect(aLo, aHi, bLo, bHi) {
      var n = aHi - aLo, m = bHi - bLo;
      var maxD = Math.ceil((n + m) / 2);
      var vOffset = maxD, vLength = 2 * maxD + 2;
      var v1 = new Int32Array(vLength).fill(-1), v2 = new Int32Array(vLength).fill(-1);
      v1[vOffset + 1] = 0; v2[vOffset + 1] = 0;
      var delta = n - m, front = (delta & 1) !== 0;
      var k1start = 0, k1end = 0, k2start = 0, k2end = 0;
      for (var d = 0; d < maxD; d++) {
        if ((d & 255) === 0 && Date.now() > deadline) break;
        var k1, k2, k1Offset, k2Offset, x1, y1, x2, y2;
        for (k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
          k1Offset = vOffset + k1;
          if (k1 === -d || (k1 !== d && v1[k1Offset - 1] < v1[k1Offset + 1])) x1 = v1[k1Offset + 1];
          else x1 = v1[k1Offset - 1] + 1;
          y1 = x1 - k1;
          while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) { x1++; y1++; }
          v1[k1Offset] = x1;
          if (x1 > n) k1end += 2;
          else if (y1 > m) k1start += 2;
          else if (front) {
            k2Offset = vOffset + delta - k1;
            if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
              x2 = n - v2[k2Offset];
              if (x1 >= x2) return split(aLo, aHi, bLo, bHi, x1, y1);
            }
          }
        }
        for (k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
          k2Offset = vOffset + k2;
          if (k2 === -d || (k2 !== d && v2[k2Offset - 1] < v2[k2Offset + 1])) x2 = v2[k2Offset + 1];
          else x2 = v2[k2Offset - 1] + 1;
          y2 = x2 - k2;
          while (x2 < n && y2 < m && a[aHi - x2 - 1] === b[bHi - y2 - 1]) { x2++; y2++; }
          v2[k2Offset] = x2;
          if (x2 > n) k2end += 2;
          else if (y2 > m) k2start += 2;
          else if (!front) {
            k1Offset = vOffset + delta - k2;
            if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
              x1 = v1[k1Offset];
              y1 = vOffset + x1 - k1Offset;
              if (x1 >= n - x2) return split(aLo, aHi, bLo, bHi, x1, y1);
            }
          }
        }
      }
      // Out of time, or nothing in common.
      if (Date.now() > deadline) state.approximate = true;
      push(KIND_DELETE, n);
      push(KIND_INSERT, m);
    }

    function split(aLo, aHi, bLo, bHi, x, y) {
      region(aLo, aLo + x, bLo, bLo + y, false);
      region(aLo + x, aHi, bLo + y, bHi, false);
    }

    region(0, a.length, 0, b.length, patience);
    return { runs: runs, approximate: state.approximate };
  }

  // ---------------------------------------------------------------------------
  // Line model
  // ---------------------------------------------------------------------------

  function isBlank(s) { return !s || /^\s*$/.test(s); }
  function indentOf(s) { var m = /^[ \t]*/.exec(s); return m ? m[0].replace(/\t/g, "    ").length : 0; }

  /**
   * Scores where an ambiguous insert or delete block reads best, in the
   * spirit of git's indent heuristic: a block should start on real code,
   * end on a blank line, and not start with a closer or end with an opener.
   */
  function blockScore(lines, start, len) {
    var first = lines[start], last = lines[start + len - 1];
    var s = 0;
    if (isBlank(first)) s -= 4;
    if (isBlank(last)) s += 2;
    if (/^\s*[}\])]/.test(first)) s -= 3;
    if (/[{[(]\s*$/.test(last)) s -= 3;
    var before = start > 0 ? lines[start - 1] : "";
    if (!isBlank(first) && !isBlank(before) && indentOf(first) < indentOf(before)) s -= 1;
    return s;
  }

  /**
   * Turns runs into change regions between equal stretches, slides pure
   * insert/delete regions to their most readable position, and returns
   * the regions as {a, aLen, b, bLen} in order.
   */
  function regionsFromRuns(runs, aKeys, bKeys, aLines, bLines) {
    var regions = [], ai = 0, bi = 0, cur = null;
    for (var r = 0; r < runs.length; r += 2) {
      var kind = runs[r], count = runs[r + 1];
      if (kind === KIND_EQUAL) { if (cur) { regions.push(cur); cur = null; } ai += count; bi += count; continue; }
      if (!cur) cur = { a: ai, aLen: 0, b: bi, bLen: 0 };
      if (kind === KIND_DELETE) { cur.aLen += count; ai += count; }
      else { cur.bLen += count; bi += count; }
    }
    if (cur) regions.push(cur);

    // Slide pure regions within the equal stretch around them.
    for (var i = 0; i < regions.length; i++) {
      var g = regions[i];
      if (g.aLen && g.bLen) continue;
      var del = g.aLen > 0, keys = del ? aKeys : bKeys, lines = del ? aLines : bLines;
      var len = del ? g.aLen : g.bLen, pos = del ? g.a : g.b;
      var prev = regions[i - 1], next = regions[i + 1];
      // Equal lines available above and below on this side.
      // Keep at least one equal line between regions so they stay separate changes.
      var minPos = prev ? (del ? prev.a + prev.aLen : prev.b + prev.bLen) + 1 : 0;
      var limit = next ? (del ? next.a : next.b) - 1 : keys.length;
      var lo = pos, hi = pos;
      while (lo - 1 >= minPos && keys[lo - 1] === keys[lo - 1 + len]) lo--;
      while (hi + len < limit && keys[hi] === keys[hi + len]) hi++;
      if (lo === hi) continue;
      var best = pos, bestScore = -Infinity;
      for (var p = lo; p <= hi; p++) {
        var sc = blockScore(lines, p, len);
        if (sc >= bestScore) { bestScore = sc; best = p; }
      }
      var shift = best - pos;
      if (!shift) continue;
      g.a += shift; g.b += shift;
    }
    return regions;
  }

  /** Character-bigram similarity (Dice coefficient), 0..1. */
  function similarity(x, y) {
    x = x.trim(); y = y.trim();
    if (x === y) return 1;
    if (!x.length || !y.length) return 0;
    if (x.length > 400) x = x.slice(0, 400);
    if (y.length > 400) y = y.slice(0, 400);
    if (x.length < 2 || y.length < 2) return x[0] === y[0] ? 0.5 : 0;
    var grams = new Map(), i, g, total = 0, hits = 0;
    for (i = 0; i < x.length - 1; i++) { g = x.substr(i, 2); grams.set(g, (grams.get(g) || 0) + 1); }
    for (i = 0; i < y.length - 1; i++) {
      g = y.substr(i, 2);
      var c = grams.get(g);
      if (c) { hits++; grams.set(g, c - 1); }
    }
    total = (x.length - 1) + (y.length - 1);
    return (2 * hits) / total;
  }

  var PAIR_THRESHOLD = 0.4;

  /**
   * Pairs deleted with inserted lines of one change region that are edits of
   * each other. Small regions use a monotone alignment that maximises total
   * similarity; large ones pair by position.
   */
  function pairRegion(aKeys, bKeys) {
    var n = aKeys.length, m = bKeys.length, pairs = [];
    if (!n || !m) return pairs;
    if (n * m <= 40000) {
      var sim = new Float64Array(n * m);
      for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) {
        var s = similarity(aKeys[i], bKeys[j]);
        sim[i * m + j] = s >= PAIR_THRESHOLD ? s : 0;
      }
      var W = m + 1, dp = new Float64Array((n + 1) * (m + 1));
      for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) {
        var best = Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
        var p = sim[i * m + j];
        if (p > 0 && p + dp[(i + 1) * W + j + 1] > best) best = p + dp[(i + 1) * W + j + 1];
        dp[i * W + j] = best;
      }
      i = 0; j = 0;
      while (i < n && j < m) {
        var here = dp[i * W + j], pv = sim[i * m + j];
        if (pv > 0 && Math.abs(here - (pv + dp[(i + 1) * W + j + 1])) < 1e-6) { pairs.push(i, j); i++; j++; }
        else if (Math.abs(here - dp[(i + 1) * W + j]) < 1e-6) i++;
        else j++;
      }
      return pairs;
    }
    for (var k = 0; k < Math.min(n, m); k++) if (similarity(aKeys[k], bKeys[k]) >= PAIR_THRESHOLD) pairs.push(k, k);
    return pairs;
  }

  /**
   * Compares two texts line by line.
   *
   * options: ignoreWhitespace, ignoreCase, timeoutMs (default 5000), language
   * (syntax tokens are included when it is set and the text is not huge).
   *
   * The model is a list of rows in unified order: `kind` (0 equal, 1 deleted,
   * 2 inserted), `ai`/`bi` (line index on each side or -1) and `pair` (the row
   * of the matching edited line, or -1). Change regions are listed as row ranges.
   */
  function compute(left, right, options) {
    options = options || {};
    var started = Date.now();
    var ls = splitLines(left), rs = splitLines(right);
    var aLines = new Array(ls.count), bLines = new Array(rs.count), i;
    for (i = 0; i < ls.count; i++) aLines[i] = left.slice(ls.starts[i], ls.ends[i]);
    for (i = 0; i < rs.count; i++) bLines[i] = right.slice(rs.starts[i], rs.ends[i]);
    var ignoring = !!(options.ignoreWhitespace || options.ignoreCase);
    var aKeys = ignoring ? aLines.map(function (l) { return keyOf(l, options); }) : aLines;
    var bKeys = ignoring ? bLines.map(function (l) { return keyOf(l, options); }) : bLines;

    // Lines become small integers so the diff compares numbers, not strings.
    var ids = new Map(), next = 0;
    function idOf(k) { var v = ids.get(k); if (v === undefined) { v = next++; ids.set(k, v); } return v; }
    var aIds = new Int32Array(aKeys.length), bIds = new Int32Array(bKeys.length);
    for (i = 0; i < aKeys.length; i++) aIds[i] = idOf(aKeys[i]);
    for (i = 0; i < bKeys.length; i++) bIds[i] = idOf(bKeys[i]);
    // A last line without a line break differs from the same line with one (as in git),
    // unless whitespace is ignored.
    if (!options.ignoreWhitespace && ls.finalNewline !== rs.finalNewline) {
      if (aIds.length && !ls.finalNewline) aIds[aIds.length - 1] = idOf(aKeys[aKeys.length - 1] + "\u0000no-eol");
      if (bIds.length && !rs.finalNewline) bIds[bIds.length - 1] = idOf(bKeys[bKeys.length - 1] + "\u0000no-eol");
    }

    var timeout = options.timeoutMs > 0 ? options.timeoutMs : 5000;
    var diff = diffSequences(aIds, bIds, { deadline: started + timeout });
    var regions = regionsFromRuns(diff.runs, aIds, bIds, aLines, bLines);

    // Rows: every original line once (equal or deleted) plus every inserted line.
    var total = aLines.length, ai = 0, bi = 0, r;
    for (r = 0; r < regions.length; r++) total += regions[r].bLen;
    var kind = new Uint8Array(total), rowA = new Int32Array(total), rowB = new Int32Array(total), pair = new Int32Array(total).fill(-1);
    var changes = [], row = 0, modified = 0, added = 0, removed = 0, unchanged = 0;
    ai = 0; bi = 0;
    function equalUntil(aEnd) {
      while (ai < aEnd) { kind[row] = KIND_EQUAL; rowA[row] = ai++; rowB[row] = bi++; row++; unchanged++; }
    }
    for (r = 0; r < regions.length; r++) {
      var g = regions[r];
      equalUntil(g.a);
      var startRow = row, delRow = row;
      for (i = 0; i < g.aLen; i++) { kind[row] = KIND_DELETE; rowA[row] = g.a + i; rowB[row] = -1; row++; }
      var insRow = row;
      for (i = 0; i < g.bLen; i++) { kind[row] = KIND_INSERT; rowA[row] = -1; rowB[row] = g.b + i; row++; }
      var pairs = pairRegion(aKeys.slice(g.a, g.a + g.aLen), bKeys.slice(g.b, g.b + g.bLen));
      for (i = 0; i < pairs.length; i += 2) {
        pair[delRow + pairs[i]] = insRow + pairs[i + 1];
        pair[insRow + pairs[i + 1]] = delRow + pairs[i];
      }
      var p = pairs.length / 2;
      modified += p; removed += g.aLen - p; added += g.bLen - p;
      changes.push(startRow, row);
      ai = g.a + g.aLen; bi = g.b + g.bLen;
    }
    equalUntil(aLines.length);

    var result = {
      rows: total, kind: kind, ai: rowA, bi: rowB, pair: pair,
      changes: Int32Array.from(changes),
      left: { starts: ls.starts, ends: ls.ends, count: ls.count, eol: ls.eol, finalNewline: ls.finalNewline },
      right: { starts: rs.starts, ends: rs.ends, count: rs.count, eol: rs.eol, finalNewline: rs.finalNewline },
      stats: {
        added: added, removed: removed, modified: modified, unchanged: unchanged,
        additions: added + modified, deletions: removed + modified, changes: changes.length / 2
      },
      // Equal under the options, but not byte for byte (ignored whitespace, case or line endings).
      identical: changes.length === 0,
      exact: left === right,
      approximate: diff.approximate,
      ms: 0
    };
    if (options.language) {
      result.leftTokens = tokenize(left, options.language);
      result.rightTokens = tokenize(right, options.language);
    }
    result.ms = Date.now() - started;
    return result;
  }

  // ---------------------------------------------------------------------------
  // Character-level changes inside a modified line
  // ---------------------------------------------------------------------------

  var TOKEN_RE = /[A-Za-z0-9_$À-￿]+|\s+|[^A-Za-z0-9_$À-￿\s]/g;

  function tokensOf(s) {
    var out = [], m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(s))) out.push(m.index, m.index + m[0].length);
    return out;
  }

  /**
   * Character ranges that differ between two versions of a line, word by word,
   * as flat [start, end, ...] arrays for each side. Ignored whitespace and case
   * never show as changes.
   */
  function inlineDiff(a, b, options) {
    options = options || {};
    if (a.length > 10000 || b.length > 10000) return null;
    var ta = tokensOf(a), tb = tokensOf(b);
    var ids = new Map(), next = 0;
    function key(s) {
      if (options.ignoreWhitespace && /^\s+$/.test(s)) return "";
      return options.ignoreCase ? s.toLowerCase() : s;
    }
    function idOf(s) { var k = key(s), v = ids.get(k); if (v === undefined) { v = next++; ids.set(k, v); } return v; }
    var ia = new Int32Array(ta.length / 2), ib = new Int32Array(tb.length / 2), i;
    for (i = 0; i < ia.length; i++) ia[i] = idOf(a.slice(ta[2 * i], ta[2 * i + 1]));
    for (i = 0; i < ib.length; i++) ib[i] = idOf(b.slice(tb[2 * i], tb[2 * i + 1]));
    var runs = diffSequences(ia, ib, { patience: false, deadline: Date.now() + 50 }).runs;
    var ra = [], rb = [], xa = 0, xb = 0;
    function add(list, s, e) {
      if (s >= e) return;
      var n = list.length;
      if (n && list[n - 1] >= s) list[n - 1] = Math.max(list[n - 1], e);
      else list.push(s, e);
    }
    for (var r = 0; r < runs.length; r += 2) {
      var kind = runs[r], count = runs[r + 1];
      if (kind === KIND_EQUAL) { xa += count; xb += count; continue; }
      if (kind === KIND_DELETE) { add(ra, ta[2 * xa], ta[2 * (xa + count) - 1]); xa += count; }
      else { add(rb, tb[2 * xb], tb[2 * (xb + count) - 1]); xb += count; }
    }
    // Ignored whitespace and case can leave "changes" that are equal under the options.
    if (options.ignoreWhitespace || options.ignoreCase) { ra = dropIgnorable(a, ra, options); rb = dropIgnorable(b, rb, options); }
    return { a: mergeNear(a, ra), b: mergeNear(b, rb) };
  }

  function dropIgnorable(s, ranges, options) {
    var out = [];
    for (var i = 0; i < ranges.length; i += 2) {
      var piece = s.slice(ranges[i], ranges[i + 1]);
      if (options.ignoreWhitespace && /^\s*$/.test(piece)) continue;
      out.push(ranges[i], ranges[i + 1]);
    }
    return out;
  }

  /** Joins changes separated by a single space or punctuation mark, which reads better than confetti. */
  function mergeNear(s, ranges) {
    if (ranges.length < 4) return ranges;
    var out = [ranges[0], ranges[1]];
    for (var i = 2; i < ranges.length; i += 2) {
      var gap = s.slice(out[out.length - 1], ranges[i]);
      if (gap.length <= 1 && !/[A-Za-z0-9]/.test(gap)) out[out.length - 1] = ranges[i + 1];
      else out.push(ranges[i], ranges[i + 1]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Syntax highlighting (rules shared in spirit with the toolkit code viewer)
  // ---------------------------------------------------------------------------

  var CLASS_NAMES = ["", "com", "str", "num", "lit", "kw", "key", "tag", "fn", "type", "attr"];
  var CLASS_IDS = {};
  CLASS_NAMES.forEach(function (n, i) { if (n) CLASS_IDS[n] = i; });

  var END = "(?![\\s\\S])";
  function words(s) { return new Set(s.split(" ")); }
  var DQ = '"(?:\\\\.|[^"\\\\\\n])*"', SQ = "'(?:\\\\.|[^'\\\\\\n])*'";
  var BT = "`(?:\\\\[\\s\\S]|[^`\\\\])*(?:`|" + END + ")";
  var SLASH = "\\/\\/[^\\n]*", BLOCK = "\\/\\*[\\s\\S]*?(?:\\*\\/|" + END + ")", HASH = "(?<![^\\s])#[^\\n]*";
  var NUM = "\\b(?:0[xX][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b";
  var WORD = "@?[A-Za-z_$][\\w$]*";
  var C_KEYWORDS = "abstract as assert async await break case catch class const continue default defer delete do dynamic else enum export extends extension final finally for foreach from fun func function get go goto guard if implements import in init instanceof interface internal is late lateinit let mixin module namespace new object of open operator out override package private protected public readonly record required return sealed select set static struct super suspend switch synchronized this throw throws try type typealias typeof using val var void volatile when where while with yield satisfies declare keyof protocol self mut impl pub use fn match loop crate trait echo elseif endforeach";
  var C_TYPES = "int long float double boolean bool char byte short string str number any unknown never object void uint int32 int64 float64 i32 i64 u8 u32 u64 f32 f64 usize";
  var LIT = "true false null undefined nil None True False NaN Infinity";
  var LIT_SET = words(LIT);
  var LANGS = {
    c: { rules: [[SLASH + "|" + BLOCK, "com"], [BT + "|" + DQ + "|" + SQ, "str"], ["@[A-Za-z_][\\w.]*", "attr"], [NUM, "num"], [WORD, "word"]], kw: words(C_KEYWORDS + " " + C_TYPES), calls: true, types: true },
    json: { rules: [[SLASH + "|" + BLOCK, "com"], [DQ + "(?=\\s*:)", "key"], [DQ, "str"], ["-?" + NUM, "num"], [WORD, "word"]], kw: words("") },
    python: { rules: [[HASH, "com"], ['[rRbBfFuU]{0,2}(?:"""[\\s\\S]*?(?:"""|' + END + ")|'''[\\s\\S]*?(?:'''|" + END + "))", "str"], ["[rRbBfFuU]{0,2}(?:" + DQ + "|" + SQ + ")", "str"], ["@[A-Za-z_][\\w.]*", "attr"], [NUM, "num"], [WORD, "word"]], kw: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass raise return self cls try while with yield int str float bool list dict set tuple bytes"), calls: true, types: true },
    ruby: { rules: [[HASH, "com"], [DQ + "|" + SQ, "str"], [":[A-Za-z_]\\w*[?!]?", "lit"], ["@{1,2}[A-Za-z_]\\w*", "attr"], [NUM, "num"], ["[A-Za-z_]\\w*[?!]?", "word"]], kw: words("alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require require_relative attr_accessor attr_reader attr_writer private protected public puts lambda proc"), calls: true, types: true },
    yaml: { rules: [[HASH, "com"], ["\\{\\{[\\s\\S]*?(?:\\}\\}|" + END + ")", "fn"], ["(?<=^[ \\t]*(?:- )*)[^\\s:#'\"{}\\[\\],&*!|>-][^:#\\n]*?(?=:(?:[ \\t]|$))", "key"], ["(?<=^[ \\t]*(?:- )*)(?:" + DQ + "|" + SQ + ")(?=:(?:[ \\t]|$))", "key"], [DQ + "|" + SQ, "str"], ["^---$|^\\.\\.\\.$|[&*][\\w-]+|![\\w!/.-]+", "attr"], ["-?" + NUM, "num"], [WORD, "word"]], lit: words(LIT + " yes no on off ~") },
    sh: { rules: [[HASH, "com"], [DQ + "|" + SQ, "str"], ["\\$\\{[^}\\n]*\\}|\\$[\\w@#?$!*-]", "key"], ["(?<=\\s|^)--?[\\w-]+", "attr"], [NUM, "num"], ["[A-Za-z_][\\w-]*", "word"]], kw: words("if then else elif fi for while until do done case esac in function return export local readonly set unset echo exit source alias sudo cd break continue shift trap eval exec") },
    docker: { rules: [[HASH, "com"], [DQ + "|" + SQ, "str"], ["\\$\\{[^}\\n]*\\}|\\$\\w+", "key"], ["(?<=^[ \\t]*)[A-Za-z]+(?=[ \\t])", "kw"], ["(?<=\\s)--[\\w-]+", "attr"], [NUM, "num"]] },
    ini: { rules: [[HASH + "|(?<=^[ \\t]*);[^\\n]*", "com"], ["(?<=^[ \\t]*)\\[[^\\]\\n]*\\]", "type"], ["(?<=^[ \\t]*(?:export[ \\t]+)?)[\\w.\\-\\/]+(?=[ \\t]*[=:])", "key"], ['"""[\\s\\S]*?(?:"""|' + END + ")", "str"], [DQ + "|" + SQ, "str"], ["\\$\\{[^}\\n]*\\}", "attr"], [NUM, "num"], [WORD, "word"]], lit: words(LIT) },
    hcl: { rules: [[HASH + "|" + SLASH + "|" + BLOCK, "com"], ["<<-?EO[FT][\\s\\S]*?^[ \\t]*EO[FT]$", "str"], [DQ, "str"], ["[\\w-]+(?=[ \\t]*=(?!=))", "key"], [NUM, "num"], [WORD, "word"]], kw: words("resource data variable output provider module locals terraform backend required_providers for_each count depends_on dynamic content lifecycle for in if moved import check"), calls: true },
    sql: { rules: [["--[^\\n]*|" + BLOCK, "com"], [SQ, "str"], ['"(?:[^"\\n])*"|`[^`\\n]*`', "key"], [NUM, "num"], [WORD, "word"]], kw: words("select from where insert into values update set delete create table alter drop index primary key foreign references not null and or join left right inner outer full cross on group by order having limit offset as distinct union all case when then else end default unique constraint if exists in is like ilike between returning with view begin commit rollback grant revoke cascade asc desc count sum avg min max integer int bigint text varchar boolean timestamp serial"), ci: true, calls: true },
    markup: { rules: [["<!--[\\s\\S]*?(?:-->|" + END + ")", "com"], ["<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|" + END + ")", "str"], ["<[?!][\\w-]*", "kw"], ["(?<=<\\/?)[\\w:.-]+", "tag"], ["(?<=<[^<>]*\\s)[\\w:.@-]+(?=\\s*=)", "attr"], ["(?<=<[^<>]*=\\s*)(?:" + DQ + "|" + SQ + ")", "str"], ["&#?\\w+;", "num"]] },
    css: { rules: [[BLOCK + "|" + SLASH, "com"], [DQ + "|" + SQ, "str"], ["@[\\w-]+", "kw"], ["--[\\w-]+|[\\w-]+(?=\\s*:[^;{]*[;}\\n])", "key"], ["#[\\da-fA-F]{3,8}\\b|-?\\d*\\.?\\d+(?:%|[a-z]+)?", "num"], ["[.#][\\w-]+", "type"], ["[\\w-]+(?=\\()", "fn"]] },
    markdown: { rules: [["^```[\\s\\S]*?(?:^```|" + END + ")", "str"], ["^#{1,6}[ \\t].*", "kw"], ["`[^`\\n]+`", "str"], ["\\[[^\\]\\n]*\\]\\([^)\\n]*\\)", "fn"], ["\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__", "type"], ["^[ \\t]*(?:[-*+]|\\d+\\.)(?=[ \\t])|^>.*|^\\|.*", "attr"]] },
    diff: { rules: [["^@@.*", "kw"], ["^(?:\\+\\+\\+|---) .*|^diff .*|^index .*", "type"], ["^\\+.*", "str"], ["^-.*", "attr"]] },
    http: { rules: [["^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\b|^HTTP\\/[\\d.]+", "kw"], ["^[\\w-]+(?=:)", "key"], [DQ, "str"], [NUM, "num"]] },
    nginx: { rules: [[HASH, "com"], [DQ + "|" + SQ, "str"], ["\\$\\w+", "key"], ["(?<=^[ \\t]*)[a-z_]+(?=[ \\t;{])", "kw"], [NUM, "num"]] }
  };

  /** Languages offered in the picker: id, label and lexer family. */
  var LANGUAGES = [
    ["plaintext", "Plain text", null], ["javascript", "JavaScript", "c"], ["typescript", "TypeScript", "c"], ["jsx", "JSX / TSX", "c"],
    ["json", "JSON", "json"], ["python", "Python", "python"], ["java", "Java", "c"], ["kotlin", "Kotlin", "c"], ["csharp", "C#", "c"],
    ["cpp", "C / C++", "c"], ["go", "Go", "c"], ["rust", "Rust", "c"], ["swift", "Swift", "c"], ["dart", "Dart", "c"], ["php", "PHP", "c"],
    ["ruby", "Ruby", "ruby"], ["scala", "Scala", "c"], ["sql", "SQL", "sql"], ["html", "HTML", "markup"], ["xml", "XML / SVG", "markup"],
    ["css", "CSS / SCSS / Less", "css"], ["yaml", "YAML", "yaml"], ["toml", "TOML / INI / .env", "ini"], ["shell", "Shell", "sh"],
    ["dockerfile", "Dockerfile", "docker"], ["terraform", "Terraform / HCL", "hcl"], ["markdown", "Markdown", "markdown"],
    ["graphql", "GraphQL", "c"], ["diff", "Diff / patch", "diff"], ["http", "HTTP", "http"], ["nginx", "nginx", "nginx"]
  ];
  var FAMILY = {}, LABEL = {};
  LANGUAGES.forEach(function (l) { FAMILY[l[0]] = l[2]; LABEL[l[0]] = l[1]; });

  var EXTENSIONS = {
    js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", mts: "typescript", cts: "typescript", jsx: "jsx", tsx: "jsx",
    json: "json", jsonc: "json", json5: "json", jsonl: "json", ndjson: "json", ipynb: "json", py: "python", pyi: "python", pyw: "python",
    java: "java", kt: "kotlin", kts: "kotlin", cs: "csharp", c: "cpp", h: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", m: "cpp",
    go: "go", rs: "rust", swift: "swift", dart: "dart", php: "php", rb: "ruby", rake: "ruby", gemspec: "ruby", scala: "scala", groovy: "java", gradle: "java",
    sql: "sql", psql: "sql", html: "html", htm: "html", vue: "html", svelte: "html", xml: "xml", svg: "xml", xsd: "xml", xsl: "xml", plist: "xml", csproj: "xml", pom: "xml",
    css: "css", scss: "css", sass: "css", less: "css", yaml: "yaml", yml: "yaml", toml: "toml", ini: "toml", cfg: "toml", conf: "toml", properties: "toml", env: "toml",
    sh: "shell", bash: "shell", zsh: "shell", fish: "shell", ps1: "shell", tf: "terraform", tfvars: "terraform", hcl: "terraform",
    md: "markdown", markdown: "markdown", mdx: "markdown", graphql: "graphql", gql: "graphql", proto: "graphql", diff: "diff", patch: "diff", http: "http"
  };

  /** Picks a language from a file name, then from the content. */
  function detectLanguage(name, text) {
    var base = String(name || "").split(/[\\/]/).pop().toLowerCase();
    if (base) {
      if (base === "dockerfile" || /^dockerfile\./.test(base) || /\.dockerfile$/.test(base)) return "dockerfile";
      if (/^\.env(\.|$)/.test(base)) return "toml";
      if (base === "makefile" || base === ".bashrc" || base === ".zshrc") return "shell";
      if (base === "nginx.conf") return "nginx";
      var ext = base.lastIndexOf(".") > 0 ? base.slice(base.lastIndexOf(".") + 1) : "";
      if (ext && EXTENSIONS[ext]) return EXTENSIONS[ext];
    }
    var s = String(text || "").slice(0, 4000);
    var t = s.trim();
    if (!t) return "plaintext";
    if (/^#!.*\b(?:bash|sh|zsh)\b/.test(t)) return "shell";
    if (/^#!.*\bpython/.test(t)) return "python";
    if (/^#!.*\bnode\b/.test(t)) return "javascript";
    if (/^<\?php/.test(t)) return "php";
    if (/^(?:diff --git|--- \S|Index: )/.test(t) && /^@@ /m.test(s)) return "diff";
    if (/^[[{]/.test(t) && /^[[{][\s\S]*[\]}]$/.test(t) && /"\s*:/.test(t)) return "json";
    if (/^<!doctype html|^<html[\s>]/i.test(t)) return "html";
    if (/^<\?xml|^<[A-Za-z][\w:-]*[\s>]/.test(t)) return /<(?:div|span|body|head|p|a|ul|li|script|template)[\s>]/i.test(s) ? "html" : "xml";
    if (/^FROM\s+\S+/m.test(s) && /^(?:RUN|COPY|CMD|ENTRYPOINT|WORKDIR)\s/m.test(s)) return "dockerfile";
    if (/^\s*(?:resource|variable|provider|module|terraform)\s+"/m.test(s)) return "terraform";
    if (/^\s*package\s+main\b|^\s*func\s+\w+\(/m.test(s)) return "go";
    if (/^\s*(?:fn|let mut|impl|use\s+\w+::)\s/m.test(s)) return "rust";
    if (/^\s*(?:def\s+\w+\(|class\s+\w+(?:\(.*\))?:|from\s+[\w.]+\s+import\s|import\s+\w+\s*$|if __name__ ==)/m.test(s)) return "python";
    if (/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?class\s+\w+/m.test(s) && /;\s*$/m.test(s) && /^\s*import\s+[\w.]+;/m.test(s)) return "java";
    if (/^\s*using\s+System|namespace\s+[\w.]+\s*[{;]/m.test(s)) return "csharp";
    if (/^\s*#include\s*[<"]/m.test(s)) return "cpp";
    if (/\b(?:interface|type)\s+\w+\s*(?:=|\{)|:\s*(?:string|number|boolean)\b|\bimport\s+type\b/.test(s)) return "typescript";
    if (/\b(?:const|let|var|function)\s+\w+|=>|\brequire\(|\bimport\s+.*\bfrom\s+['"]|\bexport\s+(?:default|const|function)/.test(s)) return "javascript";
    if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH)\s/im.test(s) && /\b(?:FROM|INTO|TABLE|SET|WHERE)\b/i.test(s)) return "sql";
    if (/^\s*[.#]?[\w-]+(?:\s*[,>+~]\s*[.#]?[\w-]+)*\s*\{[^}]*:[^}]*;/m.test(s)) return "css";
    if (/^#{1,6}\s+\S/m.test(s) && /^(?:[-*]\s|\d+\.\s|```)/m.test(s)) return "markdown";
    if (/^[\w.-]+:\s+\S/m.test(s) && /^\s*-\s+\S|^[\w.-]+:\s*$/m.test(s) && !/[;{}]\s*$/m.test(s)) return "yaml";
    if (/^\s*\[[\w.\s"-]+\]\s*$/m.test(s) && /^\s*[\w.-]+\s*=\s*\S/m.test(s)) return "toml";
    if (/^[A-Z][A-Z0-9_]*=\S*/m.test(s) && !/[;{}]/.test(s)) return "toml";
    return "plaintext";
  }

  var compiled = {};
  function lexer(language) {
    var family = FAMILY[language];
    if (!family) return null;
    if (!compiled[family]) {
      var spec = LANGS[family];
      var re = new RegExp(spec.rules.map(function (r) { return "(" + r[0].replace(/(?<!\\)\((?!\?)/g, "(?:") + ")"; }).join("|"), "gm");
      compiled[family] = { spec: spec, re: re };
    }
    return compiled[family];
  }

  function classify(spec, token, source, end) {
    var key = spec.ci ? token.toLowerCase() : token;
    if (spec.lit && spec.lit.has(token)) return "lit";
    if (!spec.lit && LIT_SET.has(token)) return "lit";
    if (spec.kw && spec.kw.has(key)) return "kw";
    if (spec.calls && /^\s*\(/.test(source.slice(end, end + 40))) return "fn";
    if (spec.types && /^[A-Z][a-z0-9]\w*$/.test(token)) return "type";
    return "";
  }

  var MAX_HIGHLIGHT_CHARS = 6000000;

  /**
   * Syntax tokens for a whole text as an Int32Array of [start, end, class]
   * triples, so comments and strings spanning lines are coloured correctly.
   * Returns null for plain text or very large inputs.
   */
  function tokenize(source, language) {
    var lex = lexer(language);
    if (!lex || !source || source.length > MAX_HIGHLIGHT_CHARS) return null;
    var re = lex.re, spec = lex.spec, out = [], match, count = 0;
    re.lastIndex = 0;
    while ((match = re.exec(source))) {
      if (!match[0]) { re.lastIndex++; continue; }
      if (++count > 3000000) break;
      var group = 1;
      while (match[group] === undefined) group++;
      var cls = spec.rules[group - 1][1];
      if (cls === "word") cls = classify(spec, match[0], source, re.lastIndex);
      if (!cls) continue;
      out.push(match.index, re.lastIndex, CLASS_IDS[cls]);
    }
    return Int32Array.from(out);
  }

  /** Index of the first token ending after `offset` (binary search over triples). */
  function firstTokenAfter(tokens, offset) {
    var lo = 0, hi = tokens.length / 3;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (tokens[mid * 3 + 1] <= offset) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"; });
  }

  var MAX_RENDER_CHARS = 20000;

  /**
   * One line as HTML: syntax spans (`s-<class>`) split where changed ranges
   * (`<mark class="chg">`) begin and end. `text` is the whole side's text and
   * [start, end) the line within it, so syntax tokens can be looked up by offset.
   */
  function lineHtml(text, start, end, tokens, changes) {
    var truncated = false;
    if (end - start > MAX_RENDER_CHARS) { end = start + MAX_RENDER_CHARS; truncated = true; }
    if (start === end) return "";
    // Boundaries: every token edge and change edge inside the line.
    var cuts = [];
    var t = tokens ? firstTokenAfter(tokens, start) : 0;
    var tokenList = [];
    if (tokens) {
      for (var k = t; k * 3 < tokens.length && tokens[k * 3] < end; k++) {
        var s = Math.max(tokens[k * 3], start), e = Math.min(tokens[k * 3 + 1], end);
        if (s < e) tokenList.push(s, e, tokens[k * 3 + 2]);
      }
    }
    var changeList = [];
    if (changes) for (var c = 0; c < changes.length; c += 2) {
      var cs = start + changes[c], ce = Math.min(start + changes[c + 1], end);
      if (cs < ce) changeList.push(cs, ce);
    }
    if (!tokenList.length && !changeList.length) return escapeHtml(text.slice(start, end)) + (truncated ? '<span class="trunc">… line truncated</span>' : "");
    cuts.push(start, end);
    for (k = 0; k < tokenList.length; k += 3) cuts.push(tokenList[k], tokenList[k + 1]);
    for (k = 0; k < changeList.length; k += 2) cuts.push(changeList[k], changeList[k + 1]);
    cuts.sort(function (x, y) { return x - y; });
    var html = "", ti = 0, ci = 0, inMark = false;
    for (var i = 0; i < cuts.length - 1; i++) {
      var a = cuts[i], b = cuts[i + 1];
      if (a === b) continue;
      while (ti < tokenList.length && tokenList[ti + 1] <= a) ti += 3;
      while (ci < changeList.length && changeList[ci + 1] <= a) ci += 2;
      var cls = ti < tokenList.length && tokenList[ti] <= a ? CLASS_NAMES[tokenList[ti + 2]] : "";
      var marked = ci < changeList.length && changeList[ci] <= a;
      if (marked !== inMark) { html += marked ? '<mark class="chg">' : "</mark>"; inMark = marked; }
      var piece = escapeHtml(text.slice(a, b));
      html += cls ? '<span class="s-' + cls + '">' + piece + "</span>" : piece;
    }
    if (inMark) html += "</mark>";
    return html + (truncated ? '<span class="trunc">… line truncated</span>' : "");
  }

  // ---------------------------------------------------------------------------
  // Unified patch
  // ---------------------------------------------------------------------------

  /**
   * A unified diff of the model, as `git diff` / `diff -u` writes it, with
   * "\ No newline at end of file" markers. `context` lines surround each hunk.
   */
  function unifiedPatch(model, left, right, options) {
    options = options || {};
    var context = options.context >= 0 ? options.context : 3;
    var leftName = options.leftName || "original", rightName = options.rightName || "modified";
    var out = ["--- a/" + leftName, "+++ b/" + rightName];
    if (!model.changes.length) return out.join("\n") + "\n";
    var L = model.left, R = model.right;
    var rows = model.rows;
    var c = 0;
    while (c < model.changes.length) {
      var hs = Math.max(0, model.changes[c] - context);
      var he = Math.min(rows, model.changes[c + 1] + context);
      c += 2;
      while (c < model.changes.length && model.changes[c] - context <= he) {
        he = Math.min(rows, model.changes[c + 1] + context);
        c += 2;
      }
      var lines = [], aStart = -1, bStart = -1, aCount = 0, bCount = 0;
      for (var r = hs; r < he; r++) {
        var k = model.kind[r], ai = model.ai[r], bi = model.bi[r];
        if (k === KIND_EQUAL) {
          if (aStart < 0) aStart = ai;
          if (bStart < 0) bStart = bi;
          lines.push(" " + left.slice(L.starts[ai], L.ends[ai]));
          aCount++; bCount++;
          // A context line that is the last line of a side without a final newline.
          var aLast = ai === L.count - 1 && !L.finalNewline, bLast = bi === R.count - 1 && !R.finalNewline;
          if (aLast && bLast) lines.push("\\ No newline at end of file");
          else if (aLast || bLast) {
            // Same text but only one side ends without a newline: write it as a change.
            lines.pop(); aCount--; bCount--;
            lines.push("-" + left.slice(L.starts[ai], L.ends[ai]));
            aCount++;
            if (aLast) lines.push("\\ No newline at end of file");
            lines.push("+" + right.slice(R.starts[bi], R.ends[bi]));
            bCount++;
            if (bLast) lines.push("\\ No newline at end of file");
          }
        } else if (k === KIND_DELETE) {
          if (aStart < 0) aStart = ai;
          lines.push("-" + left.slice(L.starts[ai], L.ends[ai]));
          aCount++;
          if (ai === L.count - 1 && !L.finalNewline) lines.push("\\ No newline at end of file");
        } else {
          if (bStart < 0) bStart = bi;
          lines.push("+" + right.slice(R.starts[bi], R.ends[bi]));
          bCount++;
          if (bi === R.count - 1 && !R.finalNewline) lines.push("\\ No newline at end of file");
        }
      }
      // Deletions are grouped before insertions, as git writes them.
      lines = groupHunk(lines);
      if (aStart < 0) aStart = startFor(model, hs, "ai");
      if (bStart < 0) bStart = startFor(model, hs, "bi");
      var aHeader = aCount === 0 ? aStart + ",0" : (aStart + 1) + (aCount === 1 ? "" : "," + aCount);
      var bHeader = bCount === 0 ? bStart + ",0" : (bStart + 1) + (bCount === 1 ? "" : "," + bCount);
      out.push("@@ -" + aHeader + " +" + bHeader + " @@");
      Array.prototype.push.apply(out, lines);
    }
    return out.join("\n") + "\n";
  }

  /** Reorders each run of -/+ lines (with their newline markers) to all - then all +. */
  function groupHunk(lines) {
    var out = [], dels = [], ins = [], last = null;
    function flush() { Array.prototype.push.apply(out, dels); Array.prototype.push.apply(out, ins); dels = []; ins = []; }
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], ch = l.charAt(0);
      if (ch === "-") { dels.push(l); last = dels; }
      else if (ch === "+") { ins.push(l); last = ins; }
      else if (ch === "\\" && last) last.push(l);
      else { flush(); last = null; out.push(l); }
    }
    flush();
    return out;
  }

  /** Number of lines on one side before row `row` (for empty hunk sides). */
  function startFor(model, row, side) {
    for (var r = row; r < model.rows; r++) if (model[side][r] >= 0) return model[side][r];
    for (r = row - 1; r >= 0; r--) if (model[side][r] >= 0) return model[side][r] + 1;
    return 0;
  }

  return {
    KIND_EQUAL: KIND_EQUAL, KIND_DELETE: KIND_DELETE, KIND_INSERT: KIND_INSERT,
    splitLines: splitLines, lineAt: lineAt, keyOf: keyOf,
    diffSequences: diffSequences, similarity: similarity, compute: compute,
    inlineDiff: inlineDiff, tokenize: tokenize, detectLanguage: detectLanguage, LANGUAGES: LANGUAGES, languageLabel: function (id) { return LABEL[id] || id; },
    escapeHtml: escapeHtml, lineHtml: lineHtml, unifiedPatch: unifiedPatch
  };
});
