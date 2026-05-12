# vibeTerminals

Terminal, editor, notes, and git — side by side in one window.

Built with Tauri 2 + React + xterm.js.

![screenshot 1](https://raw.githubusercontent.com/nguyendangkin/vibeTerminals/master/public/Screenshot%202026-05-12%20094824.png)

![screenshot 2](https://raw.githubusercontent.com/nguyendangkin/vibeTerminals/master/public/Screenshot%202026-05-12%20094834.png)

## Features

- **Real PTY terminal** (PowerShell, CMD, pwsh)
- **Split panes** — split horizontally/vertically, drag to resize, drag-and-drop to reorder
- **File explorer** with tree view
- **Text editor** with tabs, unsaved change indicators, and save confirmation
- **Notes** — task notes and prompt notes, send note content as terminal commands
- **Git integration** — stage/commit/discard, ASCII commit graph, real-time file watching
- **Multi-project** — Discord-style project bar, each project keeps its own terminal/editor/notes state
- **Frameless window** with custom window controls

## Dev

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```
