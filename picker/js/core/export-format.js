/*
 * Export formats shared by the page and tests (task 0.6).
 * - bundle(files): the object published for agents (tier 2) and sent to the save server (tier 1).
 * - agentText(files): the text copied by "انسخ للوكيل" (tier 3): plain instructions + each text file
 *   between fixed BEGIN/END lines. parseAgentText() reads it back (used by tests; agents follow the text).
 * Works in the browser (window.Hawiya.exportFormat) and in Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.exportFormat = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ORDER = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css', 'style-guide.html'];
  var DOWNLOAD_ONLY = ['style-guide.html']; // too long to paste into a chat; delivered by download or the server
  var BEGIN = '===== HAWIYA FILE: design/';
  var BEGIN_END = ' =====';
  var END = '===== HAWIYA END FILE =====';

  function has(obj, k) {
    return Object.prototype.hasOwnProperty.call(obj, k);
  }

  function orderedNames(files) {
    if (!files || typeof files !== 'object') throw new Error('Hawiya.exportFormat: no files');
    Object.keys(files).forEach(function (k) {
      if (ORDER.indexOf(k) === -1) throw new Error('Hawiya.exportFormat: file name not allowed: ' + k);
      if (typeof files[k] !== 'string') throw new Error('Hawiya.exportFormat: content of ' + k + ' must be text');
    });
    var names = ORDER.filter(function (n) {
      return has(files, n);
    });
    if (names.length === 0) throw new Error('Hawiya.exportFormat: no files');
    return names;
  }

  function bundle(files) {
    var out = {};
    orderedNames(files).forEach(function (n) {
      out[n] = files[n];
    });
    return { format: 'hawiya-export', schemaVersion: 1, files: out };
  }

  function checkContent(name, content) {
    if (content.length > 0 && content.charAt(content.length - 1) !== '\n') {
      throw new Error('Hawiya.exportFormat: ' + name + ' must end with a newline');
    }
    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/\r$/, '');
      if (l === END || l.indexOf(BEGIN) === 0) {
        throw new Error('Hawiya.exportFormat: ' + name + ' contains a separator line');
      }
    }
  }

  function agentText(files) {
    var names = orderedNames(files);
    var pasted = names.filter(function (n) {
      return DOWNLOAD_ONLY.indexOf(n) === -1;
    });
    var skipped = names.filter(function (n) {
      return DOWNLOAD_ONLY.indexOf(n) !== -1;
    });
    var out = [
      'Hawiya export: the UI identity chosen by the user.',
      'Save each file below into the design/ folder at the project root, byte for byte, without editing it.',
      'Do not replace existing files in design/ without asking the user first.',
      'Each file starts after its "' + BEGIN + '<name>' + BEGIN_END + '" line and ends right before the "' + END + '" line.',
      // Task 9.3 (CHG-8, R-110, B-095): agents tended to drop that last line break.
      'Every file ends with exactly one line break (the one right before its "' + END + '" line): keep it when you save the file, so the saved file matches the export byte for byte.',
      'After saving, follow design/DESIGN.md for all UI work.'
    ];
    if (skipped.length) {
      out.push('Not included here (ask the user to use the Download button): ' + skipped.join(', ') + '.');
    }
    out.push('');
    pasted.forEach(function (n) {
      checkContent(n, files[n]);
      out.push(BEGIN + n + BEGIN_END);
      out.push(files[n] + END);
      out.push('');
    });
    return out.join('\n');
  }

  function parseAgentText(text) {
    var lines = String(text).split('\n');
    var files = {};
    var i = 0;
    while (i < lines.length) {
      var line = lines[i].replace(/\r$/, '');
      if (line.indexOf(BEGIN) === 0 && line.slice(-BEGIN_END.length) === BEGIN_END) {
        var name = line.slice(BEGIN.length, line.length - BEGIN_END.length);
        if (ORDER.indexOf(name) === -1) throw new Error('Hawiya.exportFormat: file name not allowed: ' + name);
        if (has(files, name)) throw new Error('Hawiya.exportFormat: file appears twice: ' + name);
        var body = [];
        i++;
        while (i < lines.length && lines[i].replace(/\r$/, '') !== END) {
          if (lines[i].indexOf(BEGIN) === 0) throw new Error('Hawiya.exportFormat: missing END line for ' + name);
          body.push(lines[i]);
          i++;
        }
        if (i >= lines.length) throw new Error('Hawiya.exportFormat: missing END line for ' + name);
        files[name] = body.length ? body.join('\n') + '\n' : '';
      }
      i++;
    }
    if (Object.keys(files).length === 0) throw new Error('Hawiya.exportFormat: no files found');
    return files;
  }

  return { ORDER: ORDER, bundle: bundle, agentText: agentText, parseAgentText: parseAgentText };
});
