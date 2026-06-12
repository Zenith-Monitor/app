const { BrowserWindow, app } = require("electron");
const path = require("path");

require("./ipc");

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, "../../preload.js")
        }
    });

    win.loadFile("src/views/index.html");
}

app.whenReady().then(createWindow);