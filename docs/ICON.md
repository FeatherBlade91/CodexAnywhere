# Application icon

The canonical artwork is `src/desktop/assets/icon.png`. The window, sidebar and favicon use it directly. `src/desktop/assets/icon.ico` is derived from the same artwork at 16, 24, 32, 48, 64, 128 and 256 pixels for the Windows executable, tray, installer and uninstaller.

Generated with the built-in image generation tool. The tool does not expose a model selector or verified model version; GPT Image 2.5 was requested but cannot be confirmed.

## Generation prompt

Use case: logo-brand. Create a single polished production app icon for ChatGPT Plan Bridge, an AI coding developer tool. Square icon, full bleed deep navy blue background. Centered bold geometric code angle brackets < and > form the two ends of an abstract bridge, connected by a short elegant horizontal bridge with a single luminous four-point AI node in its center. Teal to ice-blue gradient on the symbol, very subtle dimensional thickness, crisp edges, restrained light. Professional minimal developer-tool identity. Symbol occupies 75 percent of canvas, balanced generous margins, strong silhouette legible at 16px. Front view, no perspective. No lettering, no words, no watermark, no mockup, no circuit traces, no robot, no extra decorative elements. One icon only.

## Regenerate the Windows container

With Pillow installed, run from the repository root:

```sh
python -c "from PIL import Image; Image.open('src/desktop/assets/icon.png').save('src/desktop/assets/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
```
