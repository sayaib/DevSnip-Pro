/* DevSnip Pro - CSV & Excel Viewer: the rules of cell and header editing.
 *
 * Pure functions with no DOM, shared by the webview (as window.SheetEditing)
 * and the unit tests (through require), so key handling and column naming
 * are tested exactly as the page runs them.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SheetEditing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ARROWS = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" };

  /**
   * What a key pressed in the cell editor does. Editing starts in one of two
   * modes, as in Excel: "enter" when it was started by typing over the cell,
   * where the arrow keys finish the cell and move to the next one; "edit"
   * when it was started with Enter, F2 or a double-click, where they move the
   * caret. F2 switches between them. Returns null for keys the text box
   * handles itself (characters, Backspace, clipboard keys, Home/End…).
   *
   * key: { key, shiftKey, altKey, ctrlKey, metaKey, isComposing, keyCode }
   * context: { mac: boolean, mode: "enter" | "edit", header: boolean }
   */
  function editorKeyAction(key, context) {
    // Keys that pick a character in an input method (Japanese, Chinese…) belong to it.
    if (key.isComposing || key.keyCode === 229) return null;
    var mod = context.mac ? key.metaKey : key.ctrlKey;
    var k = key.key;
    if (k === "Escape") return { type: "cancel" };
    if (k === "Enter") {
      // Alt+Enter (and Ctrl/⌘+Enter) breaks the line inside the cell, as in Excel; a column name stays one line.
      if (key.altKey || key.ctrlKey || key.metaKey) return context.header ? { type: "commit", move: null } : { type: "newline" };
      return { type: "commit", move: key.shiftKey ? "up" : "down" };
    }
    if (k === "Tab") return { type: "commit", move: key.shiftKey ? "left" : "right" };
    if (k === "F2") return { type: "toggleMode" };
    if (ARROWS[k] && context.mode === "enter" && !key.altKey && !mod) return { type: "commit", move: ARROWS[k] };
    if (mod && !key.altKey) {
      var lower = k.length === 1 ? k.toLowerCase() : k;
      if (lower === "z") return { type: key.shiftKey ? "redo" : "undo" };
      if (lower === "y" && !context.mac) return { type: "redo" };
      if (lower === "a") return { type: "selectAll" };
      // Saving finishes the cell first; the key then goes on to VS Code.
      if (lower === "s") return { type: "save" };
    }
    return null;
  }

  function norm(name) {
    return String(name === null || name === undefined ? "" : name).trim().toLowerCase();
  }

  /**
   * The name a column gets when none is typed: "Column 4" for the fourth
   * column, or "Column 4 (2)" when that is taken.
   */
  function defaultColumnName(names, index) {
    var taken = {};
    for (var i = 0; i < names.length; i++) if (i !== index) taken[norm(names[i])] = true;
    var base = "Column " + (index + 1);
    if (!taken[norm(base)]) return base;
    for (var n = 2; ; n++) if (!taken[norm(base + " (" + n + ")")]) return base + " (" + n + ")";
  }

  /**
   * Default names for count new columns at index at..at+count-1, given the
   * names the sheet has once they are inserted (new ones blank).
   */
  function defaultColumnNames(names, at, count) {
    var list = names.slice();
    var out = [];
    for (var i = 0; i < count; i++) {
      var name = defaultColumnName(list, at + i);
      list[at + i] = name;
      out.push(name);
    }
    return out;
  }

  /**
   * What a column name typed for column index becomes. Empty text takes the
   * default name; a name another column already has (ignoring case and
   * surrounding spaces) is refused with the column it clashes with, because
   * JSON exports and column mapping key on unique names. Keeping a column's
   * own current name is never a clash, even where the file already repeats it.
   */
  function checkColumnName(names, index, text) {
    var name = String(text === null || text === undefined ? "" : text);
    if (name.indexOf("\n") !== -1 || name.indexOf("\r") !== -1) name = name.replace(/\r\n?|\n/g, " ");
    if (!name.trim()) return { ok: true, name: defaultColumnName(names, index), defaulted: true };
    if (norm(name) === norm(names[index])) return { ok: true, name: name };
    for (var i = 0; i < names.length; i++) {
      if (i !== index && norm(names[i]) === norm(name)) return { ok: false, name: name, clash: i };
    }
    return { ok: true, name: name };
  }

  /**
   * Where the caret goes when a cell is double-clicked: the character
   * boundary nearest x pixels from the start of the text. measure(text)
   * returns a width in pixels.
   */
  function caretIndexAt(text, x, measure) {
    if (!text || x <= 0) return 0;
    if (text.indexOf("\n") !== -1) return text.length;
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (measure(text.slice(0, mid + 1)) <= x) lo = mid + 1; else hi = mid;
    }
    // Snap to whichever side of that character is closer.
    if (lo < text.length) {
      var left = measure(text.slice(0, lo)), right = measure(text.slice(0, lo + 1));
      if (x - left > right - x) lo++;
    }
    return lo;
  }

  return {
    editorKeyAction: editorKeyAction,
    defaultColumnName: defaultColumnName,
    defaultColumnNames: defaultColumnNames,
    checkColumnName: checkColumnName,
    caretIndexAt: caretIndexAt
  };
});
