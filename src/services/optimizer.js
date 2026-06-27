/**
 * ============================================================
 *  ZENITH MONITOR — Módulo de Otimização
 * ============================================================
 *  Executa rotinas de otimização do sistema:
 *
 *    • Limpeza de arquivos temporários (com contagem e tamanho)
 *    • Limpeza de Prefetch (com contagem e tamanho)
 *    • Limpeza profunda de memória RAM (4 técnicas via Windows API)
 *    • Flush de cache DNS
 *    • Modo Gaming (plano de energia + Timer Resolution 0.5ms)
 *
 *  Gera um log detalhado de cada operação em:
 *    <pasta do app>\log\log.txt
 *
 *  ⚠️ A limpeza de RAM e o Timer Resolution exigem privilégios
 *  de Administrador para funcionar por completo.
 * ============================================================
 */

const { app, shell } = require("electron");
const { exec } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { runCMD, runPowerShellScript, isElevated } = require("./lib/powershell");

/* ============================================================
   SISTEMA DE LOG
============================================================ */

function getLogPath() {
    // Pasta do executável do app (funciona tanto em dev quanto empacotado)
    const base = app.isPackaged
        ? path.dirname(process.execPath)
        : path.join(__dirname, "../../");

    const pasta = path.join(base, "log");

    if (!fs.existsSync(pasta)) {
        fs.mkdirSync(pasta, { recursive: true });
    }

    return path.join(pasta, "log.txt");
}

function abrirPastaLog() {
    const logPath = getLogPath();
    const pasta = path.dirname(logPath);
    shell.openPath(pasta);
}

function escreverLog(linhas) {
    try {
        const filePath = getLogPath();
        const conteudo = linhas.join("\n") + "\n";
        fs.writeFileSync(filePath, conteudo, "utf-8");
        return filePath;
    } catch (err) {
        console.error("Falha ao gravar log:", err);
        return null;
    }
}

function criarCabecalho(operacao) {
    const agora = new Date();
    return [
        "=".repeat(60),
        `  ZENITH MONITOR — Log de Otimização`,
        `  Operação : ${operacao}`,
        `  Data     : ${agora.toLocaleDateString("pt-BR")}`,
        `  Hora     : ${agora.toLocaleTimeString("pt-BR")}`,
        `  Sistema  : ${os.hostname()} (${os.platform()} ${os.release()})`,
        "=".repeat(60),
        ""
    ];
}

/* ============================================================
   CONTROLE DE EXECUÇÃO
============================================================ */

let emExecucao = false;

/* ============================================================
   SNAPSHOT DE MEMÓRIA
============================================================ */

async function getSnapshot() {
    const total = os.totalmem();
    const livre = os.freemem();
    const usada = total - livre;

    return {
        ram: Number(((usada / total) * 100).toFixed(1)),
        ramLivreMB: Number((livre / 1024 / 1024).toFixed(0)),
        ramUsadaMB: Number((usada / 1024 / 1024).toFixed(0))
    };
}

function calculateGain(antes, depois) {
    return Number((antes.ram * 0.7 - depois.ram * 0.7).toFixed(2));
}

/* ============================================================
   HELPERS
============================================================ */

function formatarBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ============================================================
   LIMPEZA DE ARQUIVOS TEMPORÁRIOS
============================================================ */

const SCRIPT_CLEAN_TEMP = `
$ErrorActionPreference = "SilentlyContinue"
$tempPath = $env:TEMP
$arquivos = Get-ChildItem -Path $tempPath -Recurse -Force -ErrorAction SilentlyContinue
$totalArquivos = ($arquivos | Where-Object { -not $_.PSIsContainer } | Measure-Object).Count
$totalBytes = ($arquivos | Where-Object { -not $_.PSIsContainer } | Measure-Object -Property Length -Sum).Sum
if (-not $totalBytes) { $totalBytes = 0 }
Write-Output "ANTES_ARQUIVOS:$totalArquivos"
Write-Output "ANTES_BYTES:$totalBytes"

Remove-Item -Path "$tempPath\\*" -Recurse -Force -ErrorAction SilentlyContinue

$restantes = Get-ChildItem -Path $tempPath -Recurse -Force -ErrorAction SilentlyContinue
$restantesCount = ($restantes | Where-Object { -not $_.PSIsContainer } | Measure-Object).Count
if (-not $restantesCount) { $restantesCount = 0 }
Write-Output "DEPOIS_ARQUIVOS:$restantesCount"
`;

async function cleanTemp() {
    const resultado = await runPowerShellScript(SCRIPT_CLEAN_TEMP);
    const saida = resultado.output || "";

    const extrair = (chave) => {
        const m = saida.match(new RegExp(chave + ":(\\S+)"));
        return m ? m[1] : "0";
    };

    const antesArquivos = parseInt(extrair("ANTES_ARQUIVOS")) || 0;
    const antesBytes = parseInt(extrair("ANTES_BYTES")) || 0;
    const depoisArquivos = parseInt(extrair("DEPOIS_ARQUIVOS")) || 0;
    const deletados = Math.max(0, antesArquivos - depoisArquivos);

    const linhas = criarCabecalho("Limpeza de Arquivos Temporários");
    linhas.push(`Pasta analisada : %TEMP%`);
    linhas.push(`Arquivos encontrados : ${antesArquivos}`);
    linhas.push(`Tamanho total : ${formatarBytes(antesBytes)}`);
    linhas.push(`Arquivos removidos : ${deletados}`);
    linhas.push(`Arquivos restantes : ${depoisArquivos} (em uso pelo sistema, não removíveis)`);
    linhas.push("");
    linhas.push(deletados > 0
        ? `✔ Limpeza concluída — ${formatarBytes(antesBytes)} liberados`
        : `✔ Pasta já estava limpa`
    );

    const filePath = escreverLog(linhas);

    return {
        success: true,
        message: `Temporários: ${deletados} arquivos removidos (${formatarBytes(antesBytes)})`,
        detalhes: { deletados, antesBytes },
        logFile: filePath
    };
}

/* ============================================================
   LIMPEZA DE PREFETCH
============================================================ */

const SCRIPT_CLEAN_PREFETCH = `
$ErrorActionPreference = "SilentlyContinue"
$prefetchPath = "C:\\Windows\\Prefetch"
$arquivos = Get-ChildItem -Path $prefetchPath -Filter "*.pf" -Force -ErrorAction SilentlyContinue
$totalArquivos = ($arquivos | Measure-Object).Count
$totalBytes = ($arquivos | Measure-Object -Property Length -Sum).Sum
if (-not $totalBytes) { $totalBytes = 0 }
Write-Output "PREFETCH_ARQUIVOS:$totalArquivos"
Write-Output "PREFETCH_BYTES:$totalBytes"

$nomes = $arquivos | Select-Object -First 20 -ExpandProperty Name
$nomes | ForEach-Object { Write-Output "PREFETCH_NOME:$_" }

Remove-Item -Path "$prefetchPath\\*.pf" -Force -ErrorAction SilentlyContinue

$restantes = (Get-ChildItem -Path $prefetchPath -Filter "*.pf" -Force -ErrorAction SilentlyContinue | Measure-Object).Count
if (-not $restantes) { $restantes = 0 }
Write-Output "PREFETCH_RESTANTES:$restantes"
`;

async function cleanPrefetch() {
    const resultado = await runPowerShellScript(SCRIPT_CLEAN_PREFETCH);

    if (resultado.error) {
        return {
            success: false,
            message: "Falha ao limpar Prefetch — verifique se está rodando como Administrador."
        };
    }

    const saida = resultado.output || "";

    const extrair = (chave) => {
        const m = saida.match(new RegExp(chave + ":(\\S+)"));
        return m ? m[1] : "0";
    };

    const totalArquivos = parseInt(extrair("PREFETCH_ARQUIVOS")) || 0;
    const totalBytes = parseInt(extrair("PREFETCH_BYTES")) || 0;
    const restantes = parseInt(extrair("PREFETCH_RESTANTES")) || 0;
    const deletados = Math.max(0, totalArquivos - restantes);

    // Extrai os nomes dos arquivos deletados
    const nomes = [];
    const linhasNome = saida.match(/PREFETCH_NOME:(.+)/g) || [];
    linhasNome.forEach(l => {
        const nome = l.replace("PREFETCH_NOME:", "").trim();
        if (nome) nomes.push(nome);
    });

    const linhas = criarCabecalho("Limpeza de Prefetch");
    linhas.push(`Pasta analisada : C:\\Windows\\Prefetch`);
    linhas.push(`Arquivos .pf encontrados : ${totalArquivos}`);
    linhas.push(`Tamanho total : ${formatarBytes(totalBytes)}`);
    linhas.push(`Arquivos removidos : ${deletados}`);
    linhas.push("");

    if (nomes.length > 0) {
        linhas.push("Exemplos de arquivos removidos:");
        nomes.forEach(n => linhas.push(`  - ${n}`));
        if (totalArquivos > 20) {
            linhas.push(`  ... e mais ${totalArquivos - 20} arquivos`);
        }
        linhas.push("");
    }

    linhas.push(deletados > 0
        ? `✔ Prefetch limpo — ${deletados} arquivos removidos (${formatarBytes(totalBytes)})`
        : `✔ Prefetch já estava limpo`
    );

    const filePath = escreverLog(linhas);

    return {
        success: true,
        message: `Prefetch: ${deletados} arquivos removidos (${formatarBytes(totalBytes)})`,
        detalhes: { deletados, totalBytes },
        logFile: filePath
    };
}

/* ============================================================
   LIMPEZA DE RAM — 4 técnicas reais via Windows API (P/Invoke)
============================================================ */

const SCRIPT_LIMPEZA_RAM = `
$ErrorActionPreference = "SilentlyContinue"

$codigo = @"
using System;
using System.Runtime.InteropServices;

public static class ZenithMemoria {
    [DllImport("psapi.dll")]
    public static extern bool EmptyWorkingSet(IntPtr hProcess);

    [DllImport("ntdll.dll")]
    public static extern int NtSetSystemInformation(int InfoClass, IntPtr Info, int Length);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetSystemFileCacheSize(IntPtr Min, IntPtr Max, int Flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool LookupPrivilegeValue(string sys, string name, out long luid);

    [StructLayout(LayoutKind.Sequential)]
    public struct TOKEN_PRIVILEGES { public uint Count; public long Luid; public uint Attr; }

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES newState, uint len, IntPtr prev, IntPtr ret);

    public static bool EnablePrivilege(string name) {
        IntPtr token;
        OpenProcessToken(System.Diagnostics.Process.GetCurrentProcess().Handle, 0x28, out token);
        TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
        tp.Count = 1; tp.Attr = 0x2;
        LookupPrivilegeValue(null, name, out tp.Luid);
        return AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    }
}
"@

Add-Type -TypeDefinition $codigo -Language CSharp

[ZenithMemoria]::EnablePrivilege("SeProfileSingleProcessPrivilege") | Out-Null
[ZenithMemoria]::EnablePrivilege("SeIncreaseQuotaPrivilege") | Out-Null

function Enviar-ComandoMemoria($cmd) {
    $bytes = [BitConverter]::GetBytes([int32]$cmd)
    $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal(4)
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, 4)
    $status = [ZenithMemoria]::NtSetSystemInformation(80, $ptr, 4)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
    return $status
}

$ramAntes = [Math]::Round((Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).FreePhysicalMemory / 1024)
Write-Output "RAM_LIVRE_ANTES:$ramAntes"

$statusWS = Enviar-ComandoMemoria 2
Write-Output "WORKINGSETS_STATUS:$statusWS"

$contador = 0
Get-Process | ForEach-Object {
    try { if ([ZenithMemoria]::EmptyWorkingSet($_.Handle)) { $contador++ } } catch {}
}
Write-Output "WORKINGSETS_COUNT:$contador"

try {
    $cacheOk = [ZenithMemoria]::SetSystemFileCacheSize([IntPtr]::Zero, [IntPtr]::Zero, 0)
} catch { $cacheOk = $false }
Write-Output "FILECACHE_OK:$cacheOk"

$statusStandby = Enviar-ComandoMemoria 4
Write-Output "STANDBYLIST_STATUS:$statusStandby"

$statusModified = Enviar-ComandoMemoria 3
Write-Output "MODIFIEDLIST_STATUS:$statusModified"

Start-Sleep -Milliseconds 500
$ramDepois = [Math]::Round((Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).FreePhysicalMemory / 1024)
Write-Output "RAM_LIVRE_DEPOIS:$ramDepois"
`;

async function clearRAM() {
    const elevated = await isElevated();
    const antes = await getSnapshot();
    const resultado = await runPowerShellScript(SCRIPT_LIMPEZA_RAM);

    if (resultado.error) {
        return {
            success: false,
            elevated,
            message: "Falha ao limpar a memória: " + resultado.error
        };
    }

    const saida = resultado.output || "";
    const extrair = (chave) => {
        const m = saida.match(new RegExp(chave + ":(\\S+)"));
        return m ? m[1] : "?";
    };

    const statusWS      = extrair("WORKINGSETS_STATUS");
    const contadorWS    = extrair("WORKINGSETS_COUNT");
    const cacheOk       = extrair("FILECACHE_OK");
    const statusStandby = extrair("STANDBYLIST_STATUS");
    const statusModified= extrair("MODIFIEDLIST_STATUS");
    const ramAntesPS    = parseInt(extrair("RAM_LIVRE_ANTES")) || antes.ramLivreMB;
    const ramDepoisPS   = parseInt(extrair("RAM_LIVRE_DEPOIS")) || 0;
    const liberadoMB    = Math.max(0, ramDepoisPS - ramAntesPS);

    const tecnicas = [
        { nome: "Working Set Evacuation",  ok: statusWS === "0",       detalhe: `${contadorWS} processos` },
        { nome: "System File Cache Flush", ok: cacheOk === "True",     detalhe: "" },
        { nome: "Standby List Purge",      ok: statusStandby === "0",  detalhe: "" },
        { nome: "Modified Page List Flush",ok: statusModified === "0", detalhe: "" }
    ];

    const linhas = criarCabecalho("Limpeza de Memória RAM");
    linhas.push(`Privilégios : ${elevated ? "Administrador ✔" : "Usuário padrão ⚠️ (resultado parcial)"}`);
    linhas.push(`RAM livre antes : ${ramAntesPS} MB`);
    linhas.push(`RAM livre depois : ${ramDepoisPS} MB`);
    linhas.push(`Memória liberada : ${liberadoMB > 0 ? liberadoMB + " MB" : "< 1 MB (já estava otimizada)"}`);
    linhas.push("");
    linhas.push("Técnicas executadas:");
    tecnicas.forEach(t => {
        linhas.push(`  ${t.ok ? "✔" : "✗"} ${t.nome}${t.detalhe ? " (" + t.detalhe + ")" : ""}`);
    });
    linhas.push("");

    if (!elevated) {
        linhas.push("⚠️ Execute como Administrador para ativar todas as técnicas.");
    } else {
        linhas.push(`✔ Limpeza concluída — ${liberadoMB} MB liberados`);
    }

    const filePath = escreverLog(linhas);

    return {
        success: true,
        elevated,
        message: `RAM: ${liberadoMB} MB liberados`,
        warning: !elevated ? "Execute como Administrador para a limpeza completa." : null,
        details: tecnicas.map(t => `${t.nome}: ${t.ok ? "OK" : "falhou"}${t.detalhe ? " — " + t.detalhe : ""}`),
        logFile: filePath
    };
}

/* ============================================================
   FLUSH DE DNS
============================================================ */

async function flushDNS() {
    const resultado = await runCMD("ipconfig /flushdns");

    const linhas = criarCabecalho("Flush de DNS");
    linhas.push(`Comando : ipconfig /flushdns`);
    linhas.push(`Resultado : ${resultado.error ? "ERRO — " + resultado.error : "OK"}`);
    linhas.push("");
    linhas.push(resultado.error
        ? `❌ Falha ao limpar o cache de DNS`
        : `✔ Cache de DNS limpo com sucesso`
    );

    const filePath = escreverLog(linhas);

    return {
        success: !resultado.error,
        message: resultado.error ? "Falha ao limpar DNS." : "Cache de DNS limpo.",
        logFile: filePath
    };
}

/* ============================================================
   MODO GAMING — plano de energia + Timer Resolution 0.5ms
============================================================ */

const SCRIPT_TIMER_ATIVAR = `
$ErrorActionPreference = "SilentlyContinue"

$codigo = @"
using System;
using System.Runtime.InteropServices;

public static class ZenithTimer {
    [DllImport("ntdll.dll")]
    public static extern int NtSetTimerResolution(uint RequestedResolution, bool Set, out uint ActualResolution);

    [DllImport("ntdll.dll")]
    public static extern int NtQueryTimerResolution(out uint MinimumResolution, out uint MaximumResolution, out uint CurrentResolution);
}
"@

Add-Type -TypeDefinition $codigo -Language CSharp

$min = [uint32]0; $max = [uint32]0; $atual = [uint32]0
[ZenithTimer]::NtQueryTimerResolution([ref]$min, [ref]$max, [ref]$atual) | Out-Null
Write-Output "TIMER_MIN:$min"
Write-Output "TIMER_MAX:$max"
Write-Output "TIMER_ANTES:$atual"

$resultado = [uint32]0
$status = [ZenithTimer]::NtSetTimerResolution(5000, $true, [ref]$resultado)
Write-Output "TIMER_STATUS:$status"
Write-Output "TIMER_DEPOIS:$resultado"
`;

const SCRIPT_TIMER_DESATIVAR = `
$ErrorActionPreference = "SilentlyContinue"

$codigo = @"
using System;
using System.Runtime.InteropServices;

public static class ZenithTimerReset {
    [DllImport("ntdll.dll")]
    public static extern int NtSetTimerResolution(uint RequestedResolution, bool Set, out uint ActualResolution);
}
"@

Add-Type -TypeDefinition $codigo -Language CSharp

$resultado = [uint32]0
[ZenithTimerReset]::NtSetTimerResolution(156250, $false, [ref]$resultado) | Out-Null
Write-Output "TIMER_RESET:$resultado"
`;

async function gamingMode(enable = true) {
    const cmd = enable
        ? "powercfg -setactive SCHEME_MIN"
        : "powercfg -setactive SCHEME_BALANCED";

    await runCMD(cmd);

    if (enable) {
        const resultado = await runPowerShellScript(SCRIPT_TIMER_ATIVAR);
        const saida = resultado.output || "";

        const extrair = (chave) => {
            const m = saida.match(new RegExp(chave + ":(\\S+)"));
            return m ? m[1] : "?";
        };

        const timerAntes  = extrair("TIMER_ANTES");
        const timerDepois = extrair("TIMER_DEPOIS");
        const timerStatus = extrair("TIMER_STATUS");
        const timerMin    = extrair("TIMER_MIN");
        const timerMax    = extrair("TIMER_MAX");

        const toMs = (v) => v !== "?" ? (parseInt(v) / 10000).toFixed(3) + "ms" : "?";

        const linhas = criarCabecalho("Modo Gaming — Ativado");
        linhas.push(`Plano de energia : Alto Desempenho (SCHEME_MIN)`);
        linhas.push("");
        linhas.push("Timer Resolution (NtSetTimerResolution):");
        linhas.push(`  Resolução mínima suportada : ${toMs(timerMax)}`);
        linhas.push(`  Resolução máxima suportada : ${toMs(timerMin)}`);
        linhas.push(`  Resolução anterior         : ${toMs(timerAntes)}`);
        linhas.push(`  Resolução ativada          : ${toMs(timerDepois)}`);
        linhas.push(`  Status                     : ${timerStatus === "0" ? "OK" : "falhou (status " + timerStatus + ")"}`);
        linhas.push("");
        linhas.push("Nota: a resolução do timer reverte automaticamente quando o app for fechado.");
        linhas.push("");
        linhas.push(`✔ Modo Gaming ativado — Timer: ${toMs(timerAntes)} → ${toMs(timerDepois)}`);

        const filePath = escreverLog(linhas);

        return {
            success: true,
            message: `Modo Gaming ativado — Timer: ${toMs(timerAntes)} → ${toMs(timerDepois)}`,
            timer: { antes: toMs(timerAntes), depois: toMs(timerDepois), status: timerStatus === "0" ? "OK" : "falhou" },
            logFile: filePath
        };

    } else {
        await runPowerShellScript(SCRIPT_TIMER_DESATIVAR);

        const linhas = criarCabecalho("Modo Gaming — Desativado");
        linhas.push(`Plano de energia : Balanceado (SCHEME_BALANCED)`);
        linhas.push(`Timer Resolution : revertido ao padrão do Windows (15.625ms)`);
        linhas.push("");
        linhas.push(`✔ Modo Gaming desativado`);

        const filePath = escreverLog(linhas);

        return {
            success: true,
            message: "Modo Gaming desativado — plano e timer revertidos.",
            logFile: filePath
        };
    }
}

/* ============================================================
   MOTOR PRINCIPAL — otimização completa
============================================================ */

async function runOptimization(mode = "safe") {

    if (emExecucao) {
        return { success: false, message: "Uma otimização já está em andamento" };
    }

    emExecucao = true;

    const uiLog = [];
    const fileLinhas = criarCabecalho("Otimização Rápida Completa");

    const add = (msg) => {
        const linha = `[${new Date().toLocaleTimeString()}] ${msg}`;
        uiLog.push(linha);
        fileLinhas.push(linha);
        return linha;
    };

    try {
        const elevated = await isElevated();
        add(elevated ? "🛡️ Executando como Administrador" : "⚠️ Sem Administrador — resultado parcial");

        const before = await getSnapshot();
        fileLinhas.push(`RAM antes : ${before.ramUsadaMB} MB usados (${before.ram}%)`);
        fileLinhas.push("");

        add("🧹 Limpando arquivos temporários...");
        const t = await cleanTemp();
        add(`✔ ${t.message}`);

        add("🗂️ Limpando Prefetch...");
        const p = await cleanPrefetch();
        add(`${p.success ? "✔" : "❌"} ${p.message}`);

        add("🧠 Otimizando memória RAM...");
        const r = await clearRAM();
        add(`${r.success ? "✔" : "❌"} ${r.message}`);
        if (r.details) r.details.forEach(d => add(`   • ${d}`));
        if (r.warning) add(`⚠️ ${r.warning}`);

        add("🌐 Limpando cache de DNS...");
        const d = await flushDNS();
        add(`✔ ${d.message}`);

        add("🎮 Ajustando plano de energia...");
        const g = await gamingMode(mode === "gaming");
        add(`✔ ${g.message}`);

        add("🎯 Otimização concluída");

        const after = await getSnapshot();
        fileLinhas.push("");
        fileLinhas.push(`RAM depois : ${after.ramUsadaMB} MB usados (${after.ram}%)`);
        fileLinhas.push(`Memória liberada : ${Math.max(0, before.ramUsadaMB - after.ramUsadaMB)} MB`);

        const filePath = escreverLog(fileLinhas);

        return {
            success: true,
            elevated,
            before,
            after,
            gain: calculateGain(before, after),
            log: uiLog,
            file: filePath
        };

    } catch (err) {
        add("❌ ERRO: " + err.toString());
        return { success: false, message: err.toString(), log: uiLog };

    } finally {
        emExecucao = false;
    }
}

/* ============================================================
   EXPORTAÇÃO
============================================================ */

module.exports = {
    cleanTemp,
    cleanPrefetch,
    clearRAM,
    flushDNS,
    gamingMode,
    runOptimization,
    abrirPastaLog,
    isElevated
};