const { app, BrowserWindow, Menu } = require("electron");
const { exec } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

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
 * certificado comercial), usamos Start-Process -Verb RunAs via
 * PowerShell pra pedir UAC em runtime. O delay de 2s garante
 * que o novo processo já iniciou antes de fechar o atual.
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

    win.loadFile(indexPath);

    registerIpc(win);
}

/**
 * =========================
 * APP LIFECYCLE
 * =========================
 */
app.whenReady().then(async () => {
    try {
        const elevated = await isElevated();

        if (!elevated) {
            relaunchAsAdmin();
            return;
        }

        createWindow();

    } catch (err) {
        fs.appendFileSync(
            path.join(os.tmpdir(), "zenith-crash.log"),
            `[${new Date().toISOString()}] LIFECYCLE ERROR\n${err.stack}\n\n`
        );
        createWindow();
    }
});

app.on("window-all-closed", () => {
    // Limpa a pasta temporária do portable ao fechar
    // O electron-builder extrai o portable em %TEMP%\3Fxxx\
    // Se não limpar, versões antigas ficam acumulando e podem
    // causar conflito ao abrir uma versão diferente depois
    if (app.isPackaged) {
        try {
            const pastaTemp = path.dirname(process.execPath);
            // Só deleta se for uma pasta temporária do Electron portable
            // (começa com "3F" que é o prefixo padrão do electron-builder)
            if (pastaTemp.includes(os.tmpdir()) && path.basename(pastaTemp).startsWith("3F")) {
                fs.rmSync(pastaTemp, { recursive: true, force: true });
            }
        } catch (e) {
            // Ignora erros de limpeza — não é crítico
        }
    }

    app.quit();
});