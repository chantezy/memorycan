const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Forward main → renderer push events as DOM events so the web front-end can
// react without polling (e.g. auto-refresh when projects/ folder changes).
ipcRenderer.on('projects-changed', () => {
  window.dispatchEvent(new Event('projects-changed'));
});

// A file/folder was dropped onto the window; the main process recovered the
// real filesystem path and forwards it here so the front-end can import it.
ipcRenderer.on('native-drop', (event, payload) => {
  window.dispatchEvent(new CustomEvent('app:native-drop', { detail: payload }));
});

// Recover the real filesystem path of an OS-dragged file/folder and forward it
// to the page. Electron 32+ removed `File.path`, so the renderer page can no
// longer read dropped paths (and contextIsolation/app:// strip them anyway).
// The preload script CAN: `webUtils.getPathForFile()` works here. We listen in
// the CAPTURE phase so we read the DataTransfer before any page handler can
// stopPropagation, then resolve it to a folder in the main process and notify
// the page via `app:native-drop`.
window.addEventListener(
  'drop',
  (e) => {
    try {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || files.length === 0) return;
      const paths = [];
      for (const f of files) {
        try {
          const p = webUtils.getPathForFile(f);
          if (p) paths.push(p);
        } catch {
          /* ignore a single unreadable file */
        }
      }
      if (paths.length === 0) return;
      ipcRenderer
        .invoke('resolve-drop-folder', paths)
        .then((res) => {
          const folderPath = res && res.success && res.folderPath ? res.folderPath : paths[0];
          window.dispatchEvent(new CustomEvent('app:native-drop', { detail: { folderPath } }));
        })
        .catch(() => {
          window.dispatchEvent(new CustomEvent('app:native-drop', { detail: { folderPath: paths[0] } }));
        });
    } catch {
      /* ignore */
    }
  },
  true // capture phase
);

contextBridge.exposeInMainWorld('api', {
  // ===== Data Collection =====
  collectScan: () => ipcRenderer.invoke('collect-scan'),
  collectRefresh: () => ipcRenderer.invoke('collect-refresh'),
  getProjectsData: () => ipcRenderer.invoke('get-projects-data'),
  getProjectDetail: (key) => ipcRenderer.invoke('get-project-detail', key),
  associateProjectFolder: (key, projectPath) =>
    ipcRenderer.invoke('associate-project-folder', key, projectPath),
  updateProjectSummary: (key, summary) =>
    ipcRenderer.invoke('update-project-summary', key, summary),
  openProjectsFolder: () => ipcRenderer.invoke('open-projects-folder'),
  projectFolderExists: (folderName) => ipcRenderer.invoke('project-folder-exists', folderName),
  openProjectFolder: (folderName) => ipcRenderer.invoke('open-project-folder', folderName),
  collectImportFile: (filePath) => ipcRenderer.invoke('collect-import-file', filePath),
  collectImportFolder: (folderPath) => ipcRenderer.invoke('collect-import-folder', folderPath),
  deleteProject: (folderName) => ipcRenderer.invoke('delete-project', folderName),

  // ===== AI Agent Detection =====
  detectSources: () => ipcRenderer.invoke('detect-sources'),
  importFromSource: (sourceId) => ipcRenderer.invoke('import-from-source', sourceId),
  importToProject: (params) => ipcRenderer.invoke('import-to-project', params),
  previewScan: (params) => ipcRenderer.invoke('preview-scan', params),

  // ===== File Operations =====
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  resolveDropFolder: (paths) => ipcRenderer.invoke('resolve-drop-folder', paths),
  exportFile: (filename, content, mime) => ipcRenderer.invoke('export-file', filename, content, mime),

  // ===== Prompt / Instructions =====
  getCollectionPrompt: () => ipcRenderer.invoke('get-collection-prompt'),

  // ===== Anonymizer =====
  runAnonymizer: (inputPath, outputPath, termsPath) =>
    ipcRenderer.invoke('run-anonymizer', inputPath, outputPath, termsPath),
  selectTermsCsv: () => ipcRenderer.invoke('select-terms-csv'),
  anonymizeProject: (projectFolder, termsPath) =>
    ipcRenderer.invoke('anonymize-project', projectFolder, termsPath),

  // ===== App Info =====
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // ===== Environment =====
  isElectron: true,
});
