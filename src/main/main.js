const { app, BrowserWindow, Menu } = require("electron");
const { exec } = require("child_process");
const path = require("path");

const registerIpc = require("./ipc");

Menu.setApplicationMenu(null);

let win;

/**
 * =========================
 * UAC — AUTO-ELEVAÇÃO
 *
 * Verifica se o processo atual tem privilégios de Administrador.
 * Se não tiver, re-lança o próprio app via PowerShell com
 * "Start-Process -Verb RunAs", que dispara o prompt UAC do Windows,
 * e encerra a instância atual sem abrir janela nenhuma.
 *
 * Diferencia dois cenários:
 *   - App empacotado (app.isPackaged = true): re-lança o próprio
 *     .exe diretamente, sem argumentos extras do Electron.
 *   - Modo dev (npm start): re-lança electron.exe com o caminho
 *     do projeto como argumento.
 *
 * Isso garante que todas as operações que dependem de admin
 * (limpeza de RAM completa, System File Cache, Standby List, etc.)
 * funcionem sem que o usuário precise abrir o terminal como admin
 * manualmente — e sem precisar de certificado de código pago.
 * =========================
 */
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
        const projectPath = path.join(__dirname, "../../").replace(/\\/g, "\\\\").replace(/'/g, "''");
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

    // Aguarda 1.5s pra garantir que o PowerShell iniciou o novo
    // processo antes de fechar essa instância — evita race condition
    setTimeout(() => app.quit(), 1500);
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