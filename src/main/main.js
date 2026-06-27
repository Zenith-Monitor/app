const { app, BrowserWindow, Menu } = require("electron");
const { exec } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

// Log imediato — primeira coisa que roda
const logPath = path.join(os.tmpdir(), "zenith-crash.log");
fs.appendFileSync(logPath, `[${new Date().toISOString()}] APP INICIADO — isPackaged=${app.isPackaged} execPath=${process.execPath}\n`);

const registerIpc = require("./ipc");

Menu.setApplicationMenu(null);

let win;

/**
 * =========================
 * CAPTURA DE ERROS
 * =========================
 */
process.on("uncaughtException", (err) => {
    try {
        fs.appendFileSync(
            path.join(os.tmpdir(), "zenith-crash.log"),
            `[${new Date().toISOString()}] UNCAUGHT\n${err.stack}\n\n`
        );
    } catch (e) {}
});

process.on("unhandledRejection", (err) => {
    try {
        fs.appendFileSync(
            path.join(os.tmpdir(), "zenith-crash.log"),
            `[${new Date().toISOString()}] PROMISE\n${err?.stack || err}\n\n`
        );
    } catch (e) {}
});

/**
 * =========================
 * UAC — verifica admin
 * =========================
 */
function isElevated() {
    return new Promise((resolve) => {
        exec("net session", { windowsHide: true }, (err) => {
            resolve(!err);
        });
    });
}

/**
 * =========================
 * UAC — re-lança como admin
 *
 * Sem requestedExecutionLevel no manifest (que bloqueia sem
 * certificado), usamos Start-Process -Verb RunAs via PowerShell
 * pra pedir UAC em runtime. O delay de 2s garante que o novo
 * processo já iniciou antes de fechar o atual.
 * =========================
 */
function relaunchAsAdmin() {
    let comando;

    if (app.isPackaged) {
        const exePath = process.execPath.replace(/\\/g, "\\\\").replace(/'/g, "''");
        comando = `Start-Process -FilePath '${exePath}' -Verb RunAs`;
    } else {
        const electronPath = process.execPath.replace(/\\/g, "\\\\").replace(/'/g, "''");
        const projectPath = path.join(__dirname, "../../").replace(/\\/g, "\\\\").replace(/'/g, "''");
        comando = `Start-Process -FilePath '${electronPath}' -ArgumentList '${projectPath}' -Verb RunAs`;
    }

    exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "${comando}"`,
        { windowsHide: true },
        (err) => {
            if (err) {
                // Usuário recusou o UAC — abre sem admin
                console.warn("UAC recusado — abrindo sem admin");
                createWindow();
            }
        }
    );

    // Aguarda 2s pro novo processo iniciar antes de fechar
    setTimeout(() => app.quit(), 2000);
}

/**
 * =========================
 * WINDOW CREATION
 * =========================
 */
function createWindow() {
    const indexPath = app.isPackaged
        ? path.join(process.resourcesPath, "app.asar", "src", "views", "index.html")
        : path.join(__dirname, "../views/index.html");

    const preloadPath = app.isPackaged
        ? path.join(process.resourcesPath, "app.asar", "preload.js")
        : path.join(__dirname, "../../preload.js");

    win = new BrowserWindow({
        width: 1400,
        height: 850,
        frame: false,
        icon: path.join(__dirname, "../assets/icons/icon.ico"),
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    fs.appendFileSync(logPath, `[${new Date().toISOString()}] INDEX: ${indexPath}\n`);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] PRELOAD: ${preloadPath}\n`);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] INDEX EXISTS: ${fs.existsSync(indexPath)}\n`);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] PRELOAD EXISTS: ${fs.existsSync(preloadPath)}\n`);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] resourcesPath: ${process.resourcesPath}\n`);

    win.loadFile(indexPath);

    win.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] DID-FAIL-LOAD: ${errorCode} ${errorDescription} ${validatedURL}\n`);
    });

    win.webContents.on("crashed", (event, killed) => {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] RENDERER CRASHED killed=${killed}\n`);
    });

    win.on("closed", () => {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] WINDOW CLOSED\n`);
    });

    try {
        registerIpc(win);
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] IPC REGISTERED OK\n`);
    } catch (err) {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] IPC ERROR: ${err.stack}\n`);
    }

    console.log("MAIN: Janela criada");
}

/**
 * =========================
 * APP LIFECYCLE
 * =========================
 */
app.whenReady().then(async () => {
    try {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] APP READY\n`);

        const elevated = await isElevated();
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ELEVATED=${elevated}\n`);

        if (!elevated) {
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] RELAUNCHING AS ADMIN\n`);
            relaunchAsAdmin();
            return;
        }

        fs.appendFileSync(logPath, `[${new Date().toISOString()}] CREATING WINDOW\n`);
        createWindow();
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] WINDOW CREATED\n`);

    } catch (err) {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] LIFECYCLE ERROR\n${err.stack}\n\n`);
        createWindow();
    }
});

app.on("window-all-closed", () => {
    app.quit();
});