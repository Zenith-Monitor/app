const { app, BrowserWindow, Menu } = require("electron");
const { exec } = require("child_process");
const path = require("path");

const registerIpc = require("./ipc");

Menu.setApplicationMenu(null);

let win;

function isElevated() {
    return new Promise((resolve) => {
        exec("net session", { windowsHide: true }, (err) => {
            resolve(!err);
        });
    });
}

function relaunchAsAdmin() {
    let comando;

    if (app.isPackaged) {
        const exePath = process.execPath.replace(/'/g, "''");
        comando = `Start-Process -FilePath '${exePath}' -Verb RunAs`;
    } else {

        const electronPath = process.execPath.replace(/'/g, "''");
        const projectPath = path.join(__dirname, "../../").replace(/'/g, "''");
        comando = `Start-Process -FilePath '${electronPath}' -ArgumentList '${projectPath}' -Verb RunAs`;
    }

    exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${comando}"`,
        { windowsHide: true },
        (err) => {
            if (err) {
                console.warn("UAC: elevação recusada ou falhou — abrindo sem admin");
                createWindow();
            }
        }
    );

    app.quit();
}

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

    win.loadFile(path.join(__dirname, "../views/index.html"));

    registerIpc(win);

    console.log("MAIN: IPC registrado com sucesso");
}

/**
 * =========================
 * APP LIFECYCLE
 * =========================
 */
app.whenReady().then(async () => {
    console.log("APP: Verificando privilégios...");

    const elevated = await isElevated();

    if (!elevated) {
        console.log("APP: Sem admin — solicitando elevação via UAC...");
        relaunchAsAdmin();
        return;
    }

    console.log("APP: Rodando como Administrador");
    createWindow();
});