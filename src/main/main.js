const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

const registerIpc = require("./ipc"); 

Menu.setApplicationMenu(null);

let win;

/**
 * =========================
 * WINDOW CREATION
 * =========================
 */
function createWindow() {

    win = new BrowserWindow({
        width: 1400,
        height: 850,
        frame: false,
        icon: path.join(__dirname, "../assets/icons/icon.ico"),
        webPreferences: {
            preload: path.join(__dirname, "../../preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    console.log("MAIN: Janela criada");

    // DEVTOOLS
    // win.webContents.openDevTools({ mode: "detach" });

    win.loadFile(path.join(__dirname, "../views/index.html"));

    // 🔥 PASSA A JANELA PRO IPC (CRÍTICO)
    registerIpc(win);

    console.log("MAIN: IPC registrado com sucesso");
}

/**
 * =========================
 * APP LIFECYCLE
 * =========================
 */
app.whenReady().then(() => {
    console.log("APP: Aberto");
    createWindow();
});