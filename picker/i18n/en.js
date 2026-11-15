/*
 * English interface text (R-032). Same keys and {placeholders} as ar.js (tests/i18n.test.js).
 * Browser: window.Hawiya.i18nData.en. Node: module.exports.
 */
(function (root, dict) {
  if (typeof module === 'object' && module.exports) {
    module.exports = dict;
  } else {
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.i18nData = root.Hawiya.i18nData || {};
    root.Hawiya.i18nData.en = dict;
  }
})(typeof self !== 'undefined' ? self : this, {
  'app.title': 'Hawiya — UI identity picker',
  'app.name': 'Hawiya',
  'app.tagline': "Choose your app's interface identity, then export it as files your agent understands.",
  'app.stage': 'Preview build: one identity and three choices.',

  'lang.switchTo': 'العربية',
  'lang.switchLabel': 'Show the page in Arabic',

  'notice.fonts':
    'Fonts are loaded from Google Fonts, so they need an internet connection. The page contacts no other site on the internet.',
  'notice.mobile': 'The mobile scene is approximate, not an exact simulation of a real device.',

  'identity.title': 'Ready identity',
  'identity.calm.name': 'Calm corporate',
  'identity.calm.hint': 'Neutral blue, clear font, moderate corners',

  'color.legend': 'Primary color',
  'color.custom': 'Custom color',
  'color.blue': 'Blue',
  'color.teal': 'Teal',
  'color.violet': 'Violet',
  'color.red': 'Red',
  'color.charcoal': 'Charcoal',

  'font.legend': 'Font',
  'font.sample': 'Clear identity',

  'radius.legend': 'Corners',
  'radius.value': '{value} px',

  'storage.unavailable':
    'This browser does not allow saving right now, so your choices will not stay after the page is closed. Choosing, previewing and exporting work as usual.',
  'saved.title': 'My saved identities',
  'saved.nameLabel': 'Identity name',
  'saved.nameInvalid': 'Type a name with at least one visible character, without < or >, and at most 80 characters.',
  'saved.save': 'Save',
  'saved.saveNew': 'Save as a new copy',
  'saved.empty': 'No saved identities yet. Your current choices are saved automatically as a draft.',
  'saved.unnamed': '(no name)',
  'saved.open': 'Open',
  'saved.openNamed': 'Open the identity {name}',
  'saved.older': 'Saved in an older format; it cannot be opened in this version and stays saved as it is.',
  'saved.newer': 'Saved in a newer format than this page; it cannot be opened here and stays saved as it is.',
  'saved.damaged': 'Could not be read; it cannot be opened and stays saved as it is.',
  'saved.full':
    "The browser's storage is full, so the last change was not saved. Choosing and exporting work as usual.",
  'saved.failed': 'Could not save in this browser. Export is still available.',
  'saved.created': 'Saved “{name}”.',
  'saved.updated': 'Updated “{name}”.',
  'saved.opened': 'Opened “{name}”. Your changes are saved automatically; press “Save” to update it in the list.',
  'saved.missing':
    'This identity cannot be opened: some of its choices are no longer in the library. It stays saved as it is.',
  'saved.cannotOpen': 'This identity cannot be opened in this version. It stays saved as it is.',
  'saved.listUnreadable':
    'The saved identities list in this browser could not be read (perhaps another version of the page saved it). Nothing in it was deleted: on the next save it is moved, unchanged, to a side copy in the browser.',
  'saved.draftUnreadable':
    'The previous draft could not be read, so the page started from the ready identity. Its old copy is still in the browser and was not deleted.',

  'preview.title': 'Preview',

  'export.title': 'Export',
  'export.button': 'Export',
  'export.copy': 'Copy for the agent',
  'export.copyFallbackLabel': 'Result text to copy by hand',
  'export.download': 'Download {name}',
  'export.listSeparator': ', ',
  'export.saving': 'Saving to your project…',
  'export.saved': 'The files were saved in the design folder of your project: {names}. You can close this page.',
  'export.savedOlder':
    'Your previous export ({names}) was saved in the design folder, not your current choices, because you changed a choice while it was saving. To pass on your current choices, press “Export”, then use “Copy for the agent” or the downloads.',
  'export.alreadySaved':
    'The automatic save already happened once and the save server has closed. To pass on this new version, use “Copy for the agent” or the downloads.',
  'export.previousPending':
    'An earlier save is still waiting for the server, so this export was not sent. “Copy for the agent” and the downloads below have your current choices.',
  'export.changed': 'You changed a choice after the last export. Press “Export” again to get the current version.',
  'export.pressExportFirst': 'Press “Export” first to show the copy and download buttons for your current choices.',
  'export.uncertain':
    'The outcome of the previous save attempt is unknown, and an earlier version may still reach the design folder. So no new save will be sent: pass on your current choices with “Copy for the agent” or the downloads, and tell the agent to replace what is in design if it finds anything.',
  'export.changedDuringSave':
    'You changed a choice while saving: what is being saved now is the previous version. Wait for the result here, then press “Export” for the current version.',
  'export.exists':
    'The design folder already has identity files, and nothing was replaced. Use “Copy for the agent” or the downloads; the agent will ask you before replacing.',
  'export.notFolder':
    'design in your project is not a plain folder (perhaps a link to somewhere else), so nothing was written. Use “Copy for the agent” or the downloads and tell the agent about it.',
  'export.badToken':
    'The save link is no longer valid, so nothing was saved. Use “Copy for the agent” or the downloads.',
  'export.unreachable':
    'Could not reach the save server, or it disconnected before answering. If you do not find the files in the design folder, use “Copy for the agent” or the downloads; your choices are kept.',
  'export.timeout':
    'The save server did not answer within 20 seconds, so we do not know whether the save happened. Check the design folder, or use “Copy for the agent” or the downloads.',
  'export.failed':
    'The automatic save failed (code {status}), so nothing was saved. Use “Copy for the agent” or the downloads.',
  'export.fileMode':
    'The page is open as a file, so there is no automatic save. The result is ready for the agent inside this page, or use “Copy for the agent” or the downloads.',
  'export.generateFailed': 'Could not prepare the files from your choices. Change any choice and try again.',
  'export.copied': 'Copied. Paste it into the chat with your agent.',
  'export.copyManual':
    'Automatic copy failed. The text is selected in front of you; copy it by hand (⌘C or Ctrl+C) and paste it into the chat with your agent.'
});
