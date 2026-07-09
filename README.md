# Pictorial

**Pictorial** is a lightweight transparent media viewer built with **Tauri**, **React** and **TypeScript**.

It lets you place images, GIFs and videos on top of other windows, zoom and move them freely, pin them above everything else, and keep the transparent area click-through so it does not block other apps.

## Features

- View images, GIFs and videos in one shared folder playlist
- Switch between media files with keyboard, mouse wheel or panel buttons
- Transparent overlay window
- Click-through empty area around the media
- Pin media above all windows
- Zoom and move media without resizing the system window
- Keep media partially visible when dragged near screen edges
- Video controls:
  - play / pause
  - seek bar
  - volume
  - playback speed: `0.5x`, `1x`, `1.5x`, `2x`, `3x`
- Auto-refresh folder contents when switching files
- Startup file support
- Multi-monitor support

## Supported formats

### Images

```text
jpg, jpeg, png, gif, bmp, webp, avif, tif, tiff
```

### Videos

```text
mp4, webm, mov, m4v, mkv, avi
```

> Actual playback support can depend on the WebView2 codecs available on the user's Windows system.

## Controls

| Action | Control |
| --- | --- |
| Open file | `Open media` button |
| Next file | Mouse wheel down / `ArrowRight` |
| Previous file | Mouse wheel up / `ArrowLeft` |
| First file | `Home` |
| Last file | `End` |
| Zoom in / out | `Ctrl + Mouse wheel` |
| Rotate | `R` |
| Reset zoom / rotation | `Ctrl + 0` |
| Move media | Left mouse drag |
| Context menu | Right mouse button |
| Pin above windows | Context menu -> `Pin above windows` |
| Unpin | Context menu -> `Unpin window` |
| Close | Context menu -> `Close` |

When the window is pinned, interactions with the media are blocked and the control panel is hidden. The media stays above other windows.

## Development

### Requirements

- Node.js
- Rust
- Tauri dependencies for your platform
- Microsoft Edge WebView2 Runtime on Windows

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run tauri dev
```

### Build release

```bash
npm run tauri build
```

## Project structure

```text
src/
  App.tsx          Main UI and media overlay logic
  App.css          Styles
  main.tsx         React entry point
  useViewer.ts     Folder loading and navigation
  media.ts         Media formats and helpers
  geometry.ts      Positioning and screen bounds helpers

src-tauri/
  src/lib.rs       Tauri commands and Windows hit-region logic
  Cargo.toml       Rust dependencies
  tauri.conf.json  Tauri app configuration
```

## App identifier

The app identifier is configured in:

```text
src-tauri/tauri.conf.json
```

Example:

```json
{
  "identifier": "com.farika.pictorial"
}
```

## GitHub notes

Do not commit generated or heavy folders such as:

```text
node_modules/
src-tauri/target/
dist/
```

They should be ignored by `.gitignore`.

Recommended first commit:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/Pictorial.git
git push -u origin main
```

## License

MIT License.
