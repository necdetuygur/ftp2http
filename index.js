const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const ftp = require("basic-ftp");
const path = require("path");
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Example: ftp2http user:password@host:port 3000");
  process.exit(1);
}
const ftpArgument = args[0];
const portArgument = args[1] || 3000;
let ftpUser, ftpPassword, ftpHost, ftpPort;
try {
  const [userPart, hostPart] = ftpArgument.split("@");
  if (!userPart || !hostPart) {
    throw new Error("Invalid FTP connection format");
  }
  [ftpUser, ftpPassword] = userPart.split(":");
  [ftpHost, ftpPort] = hostPart.split(":");
  if (!ftpUser || !ftpPassword || !ftpHost) {
    throw new Error("Missing FTP connection information");
  }
  ftpPort = ftpPort ? parseInt(ftpPort, 10) : 21;
} catch (err) {
  console.error("Error parsing FTP connection information:", err.message);
  console.error("Example: ftp2http user:password@host:port 3000");
  process.exit(1);
}
const FTP_CONFIG = {
  host: ftpHost,
  user: ftpUser,
  password: ftpPassword,
  port: ftpPort,
  secure: false,
};
const PORT = parseInt(portArgument, 10);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
let currentState = {
  url: "",
  time: 0,
  speed: 1,
  paused: true,
};
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
  socket.on("update", (data) => {
    currentState = { ...currentState, ...data };
    socket.broadcast.emit("update", data);
  });
  socket.emit("sync", currentState);
  socket.on("disconnect", () => {
    console.log("Leaved:", socket.id);
  });
});
async function createFTPClient() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access(FTP_CONFIG);
    return client;
  } catch (err) {
    console.error("FTP connection error:", err.message);
    throw err;
  }
}
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
}
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
    ".json": "application/json",
    ".xml": "application/xml",
  };
  return mimeTypes[ext] || "application/octet-stream";
}
async function getFTPListing(ftpPath = "/") {
  let client = null;
  try {
    client = await createFTPClient();
    const list = await client.list(ftpPath);
    return list.map((item) => ({
      name: item.name,
      type: item.type,
      size: item.size,
      date: item.rawModifiedAt,
      isDirectory: item.isDirectory,
      path: path.posix.join(ftpPath, item.name),
    }));
  } catch (err) {
    console.error("FTP list import error:", err);
    throw err;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (err) {}
    }
  }
}
function naturalSort(a, b) {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return collator.compare(a, b);
}
app.get("/", async (req, res) => {
  try {
    const ftpPath = req.query.path || "/";
    const listing = await getFTPListing(ftpPath);
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>FTP File Explorer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          @import url("https://fonts.googleapis.com/css2?family=Fira+Sans+Extra+Condensed:wght@400;700&display=swap");
          
          body {
            font-family: "Fira Sans Extra Condensed", Arial, Helvetica, sans-serif !important;
            margin: 0;
            padding: 10px;
            background-color: #112233;
            color: #e0e0e0;
            max-width: 100%;
            overflow-x: hidden;
          }
          .container {
            max-width: 1000px;
            margin: 0 auto;
            background: #1a2b3c;
            padding: 15px;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            width: auto;
            box-sizing: border-box;
          }
          
          .table-container {
            width: 100%;
            overflow-x: auto;
          }
          
          h1 {
            color: #ffffff;
            margin-top: 0;
            font-size: 1.5rem;
          }
          .path-info {
            margin-bottom: 15px;
            padding: 8px;
            background-color: #1e3246;
            border-radius: 4px;
            word-break: break-all;
            font-size: 0.9rem;
          }
          .server-info {
            margin-bottom: 10px;
            font-size: 0.85rem;
            color: #b0b0b0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          th, td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid #2a3a4a;
          }
          th {
            background-color: #1e3246;
            color: #ffffff;
          }
          tr:hover {
            background-color: #233548;
          }
          a {
            color: #77aaff;
            text-decoration: none;
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100%;
          }
          a:hover {
            text-decoration: underline;
            color: #99ccff;
          }
          .folder-icon::before {
            content: "📁 ";
          }
          .file-icon::before {
            content: "📄 ";
          }
          .back-link {
            margin-bottom: 15px;
            display: inline-block;
            color: #77aaff;
          }
          
          /* Column widths */
          table th:nth-child(1), table td:nth-child(1) {
            width: 50%;
          }
          
          table th:nth-child(2), table td:nth-child(2) {
            width: 20%;
            text-align: center;
          }
          
          table th:nth-child(3), table td:nth-child(3) {
            width: 30%;
            text-align: right;
          }
          
          @media (max-width: 600px) {
            body {
              padding: 0;
            }
            .container {
              padding: 10px;
              width: 100%;
              border-radius: 0;
              overflow-x: hidden;
            }
            h1 {
              font-size: 1.3rem;
            }
            th, td {
              padding: 6px;
              font-size: 0.9rem;
            }
            
            table {
              width: 100%;
              table-layout: fixed;
              min-width: 480px;
            }
            
            table th:nth-child(1), table td:nth-child(1) {
              width: 40%;
            }
            
            table th:nth-child(2), table td:nth-child(2) {
              width: 20%;
            }
            
            table th:nth-child(3), table td:nth-child(3) {
              width: 40%;
              display: table-cell;
            }
            
            a {
              font-size: 0.95rem;
            }
          }
          
          @media (min-width: 601px) and (max-width: 800px) {
            table th:nth-child(1), table td:nth-child(1) {
              width: 55%;
            }
            
            table th:nth-child(2), table td:nth-child(2) {
              width: 15%;
              text-align: center;
            }
            
            table th:nth-child(3), table td:nth-child(3) {
              width: 30%;
              text-align: right;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>FTP File Explorer</h1>
          <div class="server-info">
            Host: ${FTP_CONFIG.host}:${FTP_CONFIG.port}
          </div>
          <div class="path-info">
            Current location: ${ftpPath}
          </div>
    `;
    if (ftpPath !== "/") {
      const parentPath = path.posix.dirname(ftpPath);
      html += `<a class="back-link" href="/?path=${encodeURIComponent(
        parentPath,
      )}">⬆️ Go to Top Index</a>`;
    }
    html += `
      <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>History</th>
          </tr>
        </thead>
        <tbody>
    `;
    const directories = listing.filter((item) => item.isDirectory);
    const files = listing.filter((item) => !item.isDirectory);

    // Sort directories and files using natural sort
    directories.sort((a, b) => naturalSort(a.name, b.name));
    files.sort((a, b) => naturalSort(a.name, b.name));

    const sortedListing = [...directories, ...files];
    sortedListing.forEach((item) => {
      const itemDate = new Date(item.date).toLocaleString();
      const itemSize = item.isDirectory ? "-" : formatFileSize(item.size);
      if (item.isDirectory) {
        html += `
          <tr>
            <td><a class="folder-icon" href="/?path=${encodeURIComponent(
              item.path,
            )}">${item.name}</a></td>
            <td>${itemSize}</td>
            <td>${itemDate}</td>
          </tr>
        `;
      } else {
        html += `
          <tr>
            <td>
              <div style="display: flex; justify-content: start; align-items: center; gap: 0.5rem;">
                <a class="file-icon" href="/file?path=${encodeURIComponent(
                  item.path,
                )}">
                  ${item.name}
                </a>
                ${
                  item.name.toLowerCase().match(/\.(mp4|mkv|mp3)$/)
                    ? `
                      <a href="/videosync?url=${encodeURIComponent(item.path)}">
                        Play
                      </a>
                    `
                    : ""
                }
              </div>
            </td>
            <td>${itemSize}</td>
            <td>${itemDate}</td>
          </tr>
        `;
      }
    });
    html += `
        </tbody>
      </table>
      </div>
      </div>
    </body>
    </html>
    `;
    res.send(html);
  } catch (err) {
    console.error("Home page error:", err);
    res
      .status(500)
      .send(
        `<h1>Error</h1><p>${err.message}</p><p><a href="/">Back to Home Page</a></p>`,
      );
  }
});
app.get("/file", async (req, res) => {
  let client = null;
  let clientClosed = false;
  try {
    const ftpPath = req.query.path;
    if (!ftpPath) {
      return res.status(400).send("File path not specified.");
    }
    const fileName = path.basename(ftpPath);
    const mimeType = getMimeType(fileName);
    client = await createFTPClient();
    const fileInfo = await client.size(ftpPath).catch(() => 0);
    const fileSize = fileInfo || 0;
    const handleClose = () => {
      if (client && !clientClosed) {
        clientClosed = true;
        setTimeout(() => {
          try {
            client.close();
          } catch (err) {}
          client = null;
        }, 0);
      }
    };
    req.on("close", handleClose);
    req.on("error", handleClose);
    res.on("close", handleClose);
    res.on("error", handleClose);
    const range = req.headers.range;
    let start, end;
    if (range && fileSize > 0) {
      const parts = range.replace(/bytes=/, "").split("-");
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= fileSize) end = fileSize - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        Connection: "keep-alive",
      });
      try {
        await client.download(res, ftpPath, start);
      } catch (streamErr) {
        if (
          clientClosed ||
          streamErr.code === "ECONNRESET" ||
          streamErr.code === "ERR_STREAM_PREMATURE_CLOSE" ||
          streamErr.message.includes("User closed client during task")
        ) {
          return;
        }
        throw streamErr;
      }
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Accept-Ranges": "bytes",
        Connection: "keep-alive",
      });
      try {
        await client.downloadTo(res, ftpPath);
      } catch (streamErr) {
        if (
          clientClosed ||
          streamErr.code === "ECONNRESET" ||
          streamErr.code === "ERR_STREAM_PREMATURE_CLOSE" ||
          streamErr.message.includes("User closed client during task")
        ) {
          return;
        }
        throw streamErr;
      }
    }
  } catch (err) {
    if (
      clientClosed ||
      err.code === "ECONNRESET" ||
      err.code === "ERR_STREAM_PREMATURE_CLOSE" ||
      (err.message && err.message.includes("User closed client during task"))
    ) {
      return;
    }
    console.error(`File display error:`, err);
    if (!res.headersSent) {
      res
        .status(500)
        .send(
          `<h1>File Display Error</h1><p>${err.message}</p><p><a href="/">Back to Home Page</a></p>`,
        );
    }
  } finally {
    if (req) {
      req.removeAllListeners("close");
      req.removeAllListeners("error");
    }
    if (res) {
      res.removeAllListeners("close");
      res.removeAllListeners("error");
    }
    if (client && !clientClosed) {
      try {
        await client.close();
      } catch (err) {}
      client = null;
    }
  }
});
app.get("/videosync", async (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl) {
    return res.status(400).send("VideoSync: File url not specified.");
  }
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>VideoSync</title>
        <script src="/socket.io/socket.io.js"></script>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          @import url("https://fonts.googleapis.com/css2?family=Fira+Sans+Extra+Condensed:wght@400;700&display=swap");
          body {
            font-family: "Fira Sans Extra Condensed", Arial, Helvetica, sans-serif !important;
            margin: 0;
            padding: 10px;
            background-color: #112233;
            color: #e0e0e0;
            max-width: 100%;
            overflow-x: hidden;
          }
          .controls {
            margin: 0.5rem 0;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
        </style>
      </head>
      <body>
        <form action="./videosync" class="controls">
          <label for="videoUrl">Video URL</label>
          <input
            name="url"
            type="text"
            id="videoUrl"
            placeholder="http://example.com/video.mp4"
            style="width: 75%"
          />
          <button type="submit">Oynat</button>
        </form>
        <video id="video" style="width: 100%; max-height: 80vh" controls></video>
        <div class="controls">
          <label for="speedInput">Playback Speed</label>
          <input type="number" id="speedInput" value="1.25" step="0.05" />
          <button onclick="sendData()">Senkronize Et</button>
        </div>
        <script>
          const socket = io(window.top.location.protocol + "//" + window.top.location.host);
          const video = document.getElementById("video");
          const videoUrl = document.getElementById("videoUrl");
          const speedInput = document.getElementById("speedInput");
          setTimeout(() => {
            let queryStringVideoUrl = new URLSearchParams(window.location.search)
              .get("url")
              .trim() || "${encodeURIComponent(fileUrl)}";
            if (queryStringVideoUrl) {
              const isHttp = queryStringVideoUrl.indexOf("http") > -1;
              if(!isHttp){
                queryStringVideoUrl = window.top.location.protocol + "//" + window.top.location.host + "/file?path=" + queryStringVideoUrl;
              }
              videoUrl.value = queryStringVideoUrl;
              video.src = queryStringVideoUrl;
              sendData();
            }
          }, 100);
          socket.on("sync", (data) => {
            if (data.url) video.src = data.url;
            video.currentTime = data.time;
            video.playbackRate = data.speed;
            videoUrl.value = data.url;
            speedInput.value = data.speed;
          });
          socket.on("update", (data) => {
            if (data.url && video.src !== data.url) video.src = data.url;
            video.currentTime = data.time;
            video.playbackRate = data.speed;
            videoUrl.value = data.url;
            speedInput.value = data.speed;
            if (data.paused) {
              video.pause();
            } else {
              video.play();
            }
          });
          function sendData() {
            const data = {
              url: videoUrl.value,
              time: video.currentTime,
              speed: parseFloat(speedInput.value),
              paused: video.paused,
            };
            video.playbackRate = data.speed;
            socket.emit("update", data);
          }
        </script>
      </body>
    </html>
  `;
  return res.status(200).send(html);
});
server.listen(PORT, () => {
  console.log(
    `Connected to FTP host: ${FTP_CONFIG.user}@${FTP_CONFIG.host}:${FTP_CONFIG.port}`,
  );
  console.log(`HTTP host running: http://localhost:${PORT}`);
});
