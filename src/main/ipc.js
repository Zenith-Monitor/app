const { ipcMain, app } = require("electron");
const { exec, spawn } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const si = require("systeminformation");
const optimizer = require("../services/optimizer");

let statsInterval = null;
let sharedWin = null;

/**
 * =========================
 * SMOOTH STATE (EMA)
 * Suaviza a transição dos valores no gráfico, sem distorcer
 * o valor real — só evita "pulos" bruscos visuais.
 * =========================
 */
let smoothedCpu = 0;
let smoothedRam = 0;
let smoothedGpu = 0;

/**
 * =========================
 * CPU — híbrido: WMI (preferencial) + si.currentLoad() (fallback)
 *
 * 1ª escolha: "% Processor Utility" via WMI
 *   (Win32_PerfFormattedData_Counters_ProcessorInformation)
 *   É a MESMA métrica que o Gerenciador de Tarefas mostra.
 *   Nomes de classe/propriedade do WMI não são localizados por
 *   idioma (diferente do Get-Counter, que é).
 *
 * Fallback automático: si.currentLoad()
 *   Usado se o provedor de contadores de performance do Windows
 *   não responder. Isso acontece em sistemas que passaram por
 *   apps de "debloat"/otimização que desregistram esse provedor —
 *   não depende dele, então funciona em qualquer máquina, mas usa
 *   o método "clássico" (% tempo ocupado), que pode divergir um
 *   pouco da métrica "Processor Utility" em CPUs com escalonamento
 *   de frequência agressivo. É uma troca aceitável: preferimos o
 *   valor mais preciso quando disponível, sem deixar o app sem
 *   leitura nenhuma quando não está.
 *
 * Mantemos UM processo PowerShell rodando em loop (em vez de
 * spawnar um novo a cada segundo) lendo o valor via WMI e mandando
 * por stdout. O Node só lê o último valor recebido.
 * =========================
 */
let processoContadores = null;
let utilidadeCpuAtual = null; // null = ainda sem leitura (usa fallback)
let streamContadoresIniciado = false;
let scriptContadoresPath = null;
let fonteCpuLogada = false; // evita spamar o console a cada tick

function logarFonteCpu(fonte) {
    if (fonteCpuLogada) return;
    fonteCpuLogada = true;
    console.log(`[CPU] Fonte ativa: ${fonte}`);
}

function iniciarStreamContadores() {
    if (streamContadoresIniciado) return;
    streamContadoresIniciado = true;

    scriptContadoresPath = path.join(os.tmpdir(), `zenith_contadores_${process.pid}.ps1`);

    const conteudoScript = `
$ErrorActionPreference = "SilentlyContinue"
while ($true) {
    try {
        $cpu = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -ErrorAction Stop
        Write-Output ("CPU_UTILITY:" + $cpu.PercentProcessorUtility)
    } catch {
        Write-Output "CPU_UTILITY:ERRO"
    }
    Start-Sleep -Milliseconds 1000
}
`;

    try {
        fs.writeFileSync(scriptContadoresPath, conteudoScript, "utf-8");
    } catch (err) {
        console.error("Falha ao criar script de monitoramento:", err);
        streamContadoresIniciado = false;
        return;
    }

    processoContadores = spawn(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptContadoresPath],
        { windowsHide: true }
    );

    let bufferSaida = "";

    processoContadores.stdout.on("data", (chunk) => {
        bufferSaida += chunk.toString();
        const linhas = bufferSaida.split("\n");
        bufferSaida = linhas.pop(); // guarda linha incompleta pro próximo chunk

        for (const linha of linhas) {
            const m = linha.match(/CPU_UTILITY:([\d.]+|ERRO)/);
            if (!m || m[1] === "ERRO") continue;

            const valor = parseFloat(m[1]);
            if (Number.isNaN(valor)) continue;

            utilidadeCpuAtual = Math.max(0, Math.min(100, valor));
            logarFonteCpu("WMI % Processor Utility (igual o Gerenciador de Tarefas)");
        }
    });

    processoContadores.on("error", (err) => {
        console.error("Processo de monitoramento falhou:", err);
        streamContadoresIniciado = false;
        processoContadores = null;
    });

    processoContadores.on("exit", () => {
        streamContadoresIniciado = false;
        processoContadores = null;
        if (scriptContadoresPath) {
            try { fs.unlinkSync(scriptContadoresPath); } catch (e) { /* ignora */ }
        }
    });

    // Se depois de alguns segundos o WMI não respondeu nada,
    // assume que o provedor está indisponível e avisa qual
    // fallback está em uso (só pra log/diagnóstico, a leitura via
    // si.currentLoad() já está acontecendo normalmente desde o
    // primeiro tick).
    setTimeout(() => {
        if (utilidadeCpuAtual === null) {
            logarFonteCpu("si.currentLoad() — provedor WMI de performance não respondeu (fallback)");
        }
    }, 5000);
}

function pararStreamContadores() {
    if (processoContadores) {
        processoContadores.kill();
        processoContadores = null;
    }
    streamContadoresIniciado = false;
}

/**
 * =========================
 * GPU — nvidia-smi como fonte principal
 * Não depende de nenhum provedor de contador do Windows (é
 * binário próprio da NVIDIA).
 * =========================
 */
function lerNvidiaSmi() {
    return new Promise((resolve) => {
        exec(
            "nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits",
            { windowsHide: true, timeout: 1500 },
            (err, stdout) => {
                if (err || !stdout || !stdout.trim()) return resolve(null);
                const valor = parseFloat(stdout.trim().split("\n")[0]);
                resolve(Number.isNaN(valor) ? null : valor);
            }
        );
    });
}

async function obterUsoGpu(graphics) {
    const nvidia = await lerNvidiaSmi();
    if (nvidia !== null) return nvidia;

    // fallback: o que o systeminformation conseguir ler
    const valor = Number(
        graphics?.controllers?.[0]?.utilizationGpu ??
        graphics?.controllers?.[0]?.utilization ??
        0
    );

    return Number.isNaN(valor) ? 0 : valor;
}

/**
 * =========================
 * SYSTEM STATS
 * =========================
 */
async function collectStats() {

    const [load, mem, graphics, disks] = await Promise.all([
        si.currentLoad().catch(() => null),
        si.mem().catch(() => null),
        si.graphics().catch(() => null),
        si.fsSize().catch(() => [])
    ]);

    // Prioriza o valor via WMI (igual o Gerenciador de Tarefas). Se
    // ainda não tiver leitura disponível (ou o provedor estiver
    // indisponível), cai pro si.currentLoad() automaticamente.
    const cpuUsage = utilidadeCpuAtual !== null
        ? utilidadeCpuAtual
        : (load ? Number(load.currentLoad.toFixed(1)) : 0);

    const ramRaw = mem ? (mem.used / mem.total) * 100 : 0;
    const gpuRaw = await obterUsoGpu(graphics);

    // =========================
    // EMA SMOOTHING (só pra suavizar o gráfico)
    // =========================
    smoothedCpu = smoothedCpu * 0.85 + cpuUsage * 0.15;
    smoothedRam = smoothedRam * 0.85 + ramRaw * 0.15;
    smoothedGpu = smoothedGpu * 0.85 + gpuRaw * 0.15;

    const gpu = graphics?.controllers?.[0];

    return {
        cpu: {
            usage: Number(smoothedCpu.toFixed(1)),
            cores: os.cpus().length,
            model: os.cpus()[0].model
        },

        ram: {
            usage: Number(smoothedRam.toFixed(1)),
            usedGB: mem ? Number((mem.used / 1024 / 1024 / 1024).toFixed(2)) : 0,
            totalGB: mem ? Number((mem.total / 1024 / 1024 / 1024).toFixed(2)) : 0
        },

        gpu: {
            usage: Number(smoothedGpu.toFixed(1)),
            model: gpu?.model || "Unknown GPU"
        },

        disk: (disks || []).map((d) => ({
            fs: d.fs,
            use: d.use,
            size: d.size,
            used: d.used
        })),

        system: {
            hostname: os.hostname(),
            uptime: os.uptime(),
            platform: os.platform(),
            release: os.release()
        }
    };
}

/**
 * =========================
 * STREAM LOOP (dashboard)
 * =========================
 */
function startStatsStream() {

    if (statsInterval) return;

    statsInterval = setInterval(async () => {

        try {
            if (!sharedWin || sharedWin.isDestroyed()) return;

            const stats = await collectStats();

            sharedWin.webContents.send("stats:update", stats);

        } catch (err) {
            console.error("IPC STREAM ERROR:", err);
        }

    }, 1000);
}

/**
 * =========================
 * IPC REGISTER
 * =========================
 */
function registerIpc(win) {

    sharedWin = win;

    // Já inicia o stream assim que a janela sobe, pra já ter
    // leitura pronta (ou já ter decidido o fallback) quando o
    // dashboard pedir stats:start.
    iniciarStreamContadores();

    app.on("before-quit", pararStreamContadores);

    ipcMain.handle("stats:start", async () => {

        const first = await collectStats();

        if (sharedWin && !sharedWin.isDestroyed()) {
            sharedWin.webContents.send("stats:update", first);
        }

        startStatsStream();
    });

    ipcMain.handle("stats:stop", () => {
        if (statsInterval) {
            clearInterval(statsInterval);
            statsInterval = null;
        }
    });

    ipcMain.handle("window:minimize", () => sharedWin?.minimize());

    ipcMain.handle("window:maximize", () => {
        if (!sharedWin) return;
        sharedWin.isMaximized() ? sharedWin.unmaximize() : sharedWin.maximize();
    });

    ipcMain.handle("window:close", () => sharedWin?.close());

    ipcMain.handle("optimizer:temp", () => optimizer.cleanTemp());
    ipcMain.handle("optimizer:ram", () => optimizer.clearRAM());
    ipcMain.handle("optimizer:dns", () => optimizer.flushDNS());
    ipcMain.handle("optimizer:gaming", (_, e) => optimizer.gamingMode(e));
    ipcMain.handle("optimizer:run", (_, mode) => optimizer.runOptimization(mode));
}

module.exports = registerIpc;