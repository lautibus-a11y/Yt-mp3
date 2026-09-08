# YouTube Downloader (MP4 / MP3)

Aplicación de escritorio desarrollada con Electron, Node.js y Express para descargar videos y audios de YouTube en formatos nativos compatibles con macOS (QuickTime Player) y Windows.

## Características

- **Video MP4 en alta definición**: Selección de resolución en **1080p (Full HD)**, **720p (HD)** y **360p (SD)**.
- **Audio MP3**: Extracción directa de audio en máxima calidad.
- **Compatibilidad nativa con macOS**: Formato H.264 (AVC) + AAC para reproducción instantánea en QuickTime Player y QuickLook.
- **Diseño nativo macOS**: Interfaz oscura con *glassmorphism* y controles adaptados al sistema.
- **Multiplataforma**: Compatible con macOS (`.dmg`) y Windows (`.exe`).

## Desarrollo local

```bash
# Instalar dependencias
npm install

# Iniciar la aplicación en modo escritorio (Electron)
npm start

# Iniciar únicamente el servidor Express en navegador
npm run server
```

## Compilación de instaladores

```bash
# Generar instalador para el sistema actual
npm run dist

# Generar instalador para macOS (.dmg)
npm run dist:mac

# Generar instalador para Windows (.exe)
npm run dist:win
```
