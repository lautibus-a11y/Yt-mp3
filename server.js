const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Localiza la carpeta bin tanto en desarrollo como en la app empaquetada de Electron
 */
function getBinDir() {
  if (process.resourcesPath) {
    const resourceBin = path.join(process.resourcesPath, 'bin');
    if (fs.existsSync(resourceBin)) {
      return resourceBin;
    }
  }
  const localBin = path.join(__dirname, 'bin');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return null;
}

const activeBinDir = getBinDir();
if (activeBinDir) {
  process.env.PATH = `${activeBinDir}${path.delimiter}${process.env.PATH}`;
}
if (process.platform === 'darwin') {
  process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.HOME}/.local/bin:${process.env.PATH}`;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

/**
 * Valida formato de URL de YouTube
 */
function isValidYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w-]{11}(\S*)?$/;
  return ytRegex.test(url.trim());
}

/**
 * Extrae el identificador del video para nombrar el archivo resultante
 */
function extractVideoId(url) {
  const match = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * Obtiene la ruta al ejecutable yt-dlp (compatible con Windows y macOS)
 */
function getYtDlpPath() {
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
  const binDir = getBinDir();
  if (binDir) {
    const fullPath = path.join(binDir, exeName);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return exeName;
}

/**
 * Obtiene la carpeta de ffmpeg si existe localmente (compatible con Windows y macOS)
 */
function getFfmpegDir() {
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  const binDir = getBinDir();
  if (binDir) {
    const fullPath = path.join(binDir, exeName);
    if (fs.existsSync(fullPath)) {
      return binDir;
    }
  }
  return null;
}

/**
 * Extrae mensajes de error legibles desde la salida de yt-dlp
 */
function extractErrorMessage(stderr, code, signal) {
  if (!stderr || !stderr.trim()) {
    if (signal) return `El proceso fue detenido por señal ${signal}.`;
    return `El proceso finalizó con código ${code}.`;
  }
  const lines = stderr.trim().split('\n');
  const errorLines = lines.filter(l => l.includes('ERROR:'));
  if (errorLines.length > 0) {
    return errorLines.join('\n').replace(/^ERROR:\s*/gm, '');
  }
  return lines.slice(-2).join(' ');
}

/**
 * Endpoint de descarga
 * POST /api/download
 * Body: { url: string, format: 'mp4' | 'mp3', quality?: '360' | '720' | '1080' }
 */
app.post('/api/download', (req, res) => {
  const { url, format, quality } = req.body;

  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'La URL ingresada no es una URL válida de YouTube.' });
  }

  const selectedFormat = (format || 'mp4').toLowerCase();
  if (selectedFormat !== 'mp4' && selectedFormat !== 'mp3') {
    return res.status(400).json({ error: 'Formato no soportado. Selecciona mp4 o mp3.' });
  }

  const videoId = extractVideoId(url) || Date.now();
  const fileExtension = selectedFormat === 'mp3' ? 'mp3' : 'mp4';

  const ytDlpBinary = getYtDlpPath();
  const ffmpegDir = getFfmpegDir();

  // CASO 1: MP3 (Solo audio) - Streaming directo nativo en máxima fidelidad
  if (selectedFormat === 'mp3') {
    const filename = `youtube_${videoId}.mp3`;
    const ytDlpArgs = ['--no-playlist'];
    if (ffmpegDir) {
      ytDlpArgs.push('--ffmpeg-location', ffmpegDir);
    }
    ytDlpArgs.push(
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', '-',
      url.trim()
    );

    const child = spawn(ytDlpBinary, ytDlpArgs);
    let stderrBuffer = '';
    let hasStartedStreaming = false;

    child.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });

    child.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: `Error al iniciar yt-dlp: ${err.message}` });
      }
    });

    child.stdout.on('data', (chunk) => {
      if (!hasStartedStreaming) {
        hasStartedStreaming = true;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'audio/mpeg');
      }
      res.write(chunk);
    });

    child.stdout.on('end', () => {
      if (hasStartedStreaming && !res.writableEnded) {
        res.end();
      }
    });

    child.on('close', (code, signal) => {
      if ((code !== 0 || signal) && !hasStartedStreaming && !res.headersSent) {
        const errorMsg = extractErrorMessage(stderrBuffer, code, signal);
        return res.status(500).json({ error: errorMsg });
      }
      if (hasStartedStreaming && !res.writableEnded) {
        res.end();
      }
    });

    res.on('close', () => {
      if (!res.writableEnded && !child.killed) {
        child.kill('SIGTERM');
      }
    });

    return;
  }

  // CASO 2: MP4 (Video + Audio) con resolución seleccionable (360p, 720p, 1080p)
  const validQualities = { '360': 360, '720': 720, '1080': 1080 };
  const targetHeight = validQualities[quality] || 1080;
  const qualityTag = `${targetHeight}p`;
  const filename = `youtube_${videoId}_${qualityTag}.mp4`;
  const tempFilePath = path.join(os.tmpdir(), `yt_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);

  const ytDlpArgs = [
    '--no-playlist',
    '-S', `res:${targetHeight},vcodec:h264,acodec:m4a`,
    '-f', `bv*[height<=${targetHeight}][vcodec^=avc]+ba[acodec^=mp4a]/bv*[height<=${targetHeight}]+ba/b[height<=${targetHeight}]/b`,
    '--merge-output-format', 'mp4',
    '--recode-video', 'mp4',
    '--postprocessor-args', 'Merger:-movflags +faststart'
  ];

  if (ffmpegDir) {
    ytDlpArgs.push('--ffmpeg-location', ffmpegDir);
  }

  ytDlpArgs.push('-o', tempFilePath, url.trim());

  const child = spawn(ytDlpBinary, ytDlpArgs);
  let stderrBuffer = '';

  child.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
  });

  child.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: `Error al iniciar yt-dlp: ${err.message}` });
    }
  });

  child.on('close', (code, signal) => {
    if (code !== 0 || signal) {
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
      if (!res.headersSent) {
        const errorMsg = extractErrorMessage(stderrBuffer, code, signal);
        return res.status(500).json({ error: errorMsg });
      }
      return;
    }

    if (!fs.existsSync(tempFilePath)) {
      if (!res.headersSent) {
        return res.status(500).json({ error: 'No se pudo generar el archivo de video.' });
      }
      return;
    }

    const stat = fs.statSync(tempFilePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stat.size);

    const fileStream = fs.createReadStream(tempFilePath);
    fileStream.pipe(res);

    function cleanup() {
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
    }

    res.on('finish', cleanup);
    res.on('close', cleanup);
  });

  res.on('close', () => {
    if (!res.writableEnded && !child.killed) {
      child.kill('SIGTERM');
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function startServer(port = PORT) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`Servidor activo en http://localhost:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
