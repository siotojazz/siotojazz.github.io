# Full-album video renderer

The renderer creates a 1920×1080, 24 fps, H.264/AAC MP4 ready to upload to YouTube. It uses the full-resolution album cover, `background.mp4`, Garet from the repository `fonts` directory, the player-style segmented blue progress bar, and the visualizer lyric transition.

Tracks are selected exactly like `index.html`: sorted by numeric ID and limited to `album.standardTrackCount`, so deluxe-only songs are excluded. The renderer uses the same silence threshold and leading/trailing trim behavior as the site, then concatenates the songs without inserted gaps.

## Commands

Run commands from the `tools` directory after `npm install`.

Render a representative PNG preview:

```powershell
npm run album:frame
```

Render a frame at an album timestamp:

```powershell
npm run album:frame -- --time=12:30
```

Render a fast 960×540 draft at 4 captured frames per second:

```powershell
npm run album:video:low
```

Render medium quality at 1280×720 and 12 captured frames per second:

```powershell
npm run album:video:med
```

Render the 1920×1080, 24 fps YouTube master:

```powershell
npm run album:video:max
```

Render only a selected album-time range:

```powershell
npm run album:video:low -- --start=12:30 --end=15:00 --output=renders/album-section.mp4
```

Alternatively, render a fixed duration beginning at a timestamp:

```powershell
npm run album:video:low -- --start=12:30 --duration=30 --output=renders/album-30-second-section.mp4
```

The defaults write `../renders/album-frame.png` and `../renders/sioto-jazz-full-album.mp4`. Use `--output=...` to override either path.

During a video render, the terminal shows the percentage, album time, estimated time remaining, and current song. All presets produce a standard 24 fps MP4; lower presets duplicate frames to render much faster. A custom capture rate can still be supplied:

```powershell
npm run album:video -- --quality=low --capture-fps=6 --output=renders/album-draft.mp4
```

To verify timings without encoding:

```powershell
npm run album:timeline
```

## Requirements

- Node.js and the dependencies in `tools/package.json`.
- FFmpeg on `PATH`, installed through winget, or provided with `FFMPEG_PATH`:

```powershell
$env:FFMPEG_PATH = 'C:\path\to\ffmpeg.exe'
npm run album:video
```

Useful options are listed by `npm run album:video -- --help`.
