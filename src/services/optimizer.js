/**
 * ============================================================
 *  ZENITH MONITOR — Módulo de Otimização
 * ============================================================
 *  Executa rotinas de otimização do sistema:
 *
 *    • Limpeza de arquivos temporários
 *    • Limpeza profunda de memória RAM (via Windows API)
 *    • Flush de cache DNS
 *    • Modo Gaming (plano de energia)
 *
 *  Gera um log detalhado de cada execução em:
 *    %USERPROFILE%\Downloads\zenith-monitor\log.txt
 *
 *  ⚠️ A limpeza de RAM exige privilégios de Administrador para
 *  funcionar por completo (System File Cache, Standby List e
 *  Modified Page List dependem de privilégios elevados).
 * ============================================================
 */

const { exec } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { runCMD, runPowerShellScript, isElevated } = require("./lib/powershell");

/* ============================================================
   CONTROLE DE EXECUÇÃO
   Evita que duas otimizações rodem ao mesmo tempo.
============================================================ */

let emExecucao = false;

/* ============================================================
   SNAPSHOT DE MEMÓRIA (usado pro comparativo antes/depois)
============================================================ */

async function getSnapshot() {
    const total = os.totalmem();
    const livre = os.freemem();
    const usada = total - livre;

    return {
        ram: Number(((usada / total) * 100).toFixed(1)),
        ramLivreMB: Number((livre / 1024 / 1024).toFixed(0)),
        cpu: 0,
        disk: 0
    };
}

function calculateGain(antes, depois) {
    const scoreAntes = antes.ram * 0.7;
    const scoreDepois = depois.ram * 0.7;
    return Number((scoreAntes - scoreDepois).toFixed(2));
}

/* ============================================================
   LIMPEZA DE ARQUIVOS TEMPORÁRIOS
============================================================ */

async function cleanTemp() {
    await runCMD(`del /f /s /q %TEMP%\\* >nul 2>&1`);
    await runCMD(`for /d %i in (%TEMP%\\*) do rd /s /q "%i" >nul 2>&1`);

    return {
        success: true,
        message: "Arquivos temporários removidos."
    };
}

/* ============================================================
   LIMPEZA DE RAM — 4 técnicas reais via Windows API (P/Invoke)

     1) Esvaziar o Working Set de todos os processos
     2) Liberar o System File Cache
     3) Purgar a Standby List
     4) Forçar o flush da Modified Page List
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

# 1) Esvaziar working sets (chamada de sistema, rápida)
$statusWS = Enviar-ComandoMemoria 2
Write-Output "WORKINGSETS_STATUS:$statusWS"

# 1b) Fallback processo a processo
$contador = 0
Get-Process | ForEach-Object {
    try { if ([ZenithMemoria]::EmptyWorkingSet($_.Handle)) { $contador++ } } catch {}
}
Write-Output "WORKINGSETS_COUNT:$contador"

# 2) Flush do System File Cache
try {
    $cacheOk = [ZenithMemoria]::SetSystemFileCacheSize([IntPtr]::Zero, [IntPtr]::Zero, 0)
} catch { $cacheOk = $false }
Write-Output "FILECACHE_OK:$cacheOk"

# 3) Purge da Standby List
$statusStandby = Enviar-ComandoMemoria 4
Write-Output "STANDBYLIST_STATUS:$statusStandby"

# 4) Flush da Modified Page List
$statusModified = Enviar-ComandoMemoria 3
Write-Output "MODIFIEDLIST_STATUS:$statusModified"
`;

/**
 * Executa a limpeza profunda de memória RAM.
 * @returns {Promise<object>} resultado detalhado de cada técnica
 */
async function clearRAM() {
    const elevated = await isElevated();
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

    // status 0 = STATUS_SUCCESS no NtSetSystemInformation
    const statusWS = extrair("WORKINGSETS_STATUS");
    const contadorWS = extrair("WORKINGSETS_COUNT");
    const cacheOk = extrair("FILECACHE_OK");
    const statusStandby = extrair("STANDBYLIST_STATUS");
    const statusModified = extrair("MODIFIEDLIST_STATUS");

    const details = [
        `Working Sets: ${statusWS === "0" ? "OK" : "falhou (status " + statusWS + ")"} — ${contadorWS} processos`,
        `Cache de Arquivos do Sistema: ${cacheOk === "True" ? "OK" : "falhou"}`,
        `Standby List: ${statusStandby === "0" ? "OK" : "falhou (status " + statusStandby + ")"}`,
        `Modified Page List: ${statusModified === "0" ? "OK" : "falhou (status " + statusModified + ")"}`
    ];

    const algumaFalhou =
        [statusWS, statusStandby, statusModified].some((s) => s !== "0") || cacheOk !== "True";

    return {
        success: true,
        elevated,
        message: elevated
            ? "Limpeza de memória concluída."
            : "Limpeza executada sem privilégios de Administrador — resultado parcial",
        warning: !elevated
            ? "Execute o programa como Administrador para a limpeza completa."
            : algumaFalhou
            ? "Uma ou mais técnicas falharam (veja os detalhes)."
            : null,
        details
    };
}

/* ============================================================
   FLUSH DE DNS
============================================================ */

async function flushDNS() {
    await runCMD("ipconfig /flushdns");

    return {
        success: true,
        message: "Cache de DNS limpo."
    };
}

/* ============================================================
   MODO GAMING (plano de energia)
============================================================ */

async function gamingMode(enable = true) {
    const cmd = enable
        ? "powercfg -setactive SCHEME_MIN"
        : "powercfg -setactive SCHEME_BALANCED";

    await runCMD(cmd);

    return {
        success: true,
        message: enable ? "Modo Gaming ativado." : "Modo Gaming desativado."
    };
}

/* ============================================================
   MOTOR PRINCIPAL — orquestra todas as etapas
============================================================ */

/**
 * Executa a rotina completa de otimização.
 * @param {"safe"|"gaming"} mode
 */
async function runOptimization(mode = "safe") {

    if (emExecucao) {
        return {
            success: false,
            message: "Uma otimização já está em andamento"
        };
    }

    emExecucao = true;

    const log = [];
    const add = (msg) => {
        const linha = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.push(linha);
        return linha;
    };

    try {
        const elevated = await isElevated();
        add(
            elevated
                ? "🛡️ Executando como Administrador"
                : "⚠️ Sem privilégios de Administrador — a limpeza de RAM será limitada"
        );

        const before = await getSnapshot();

        add("🚀 Iniciando otimização rápida");

        add("🧹 Limpando arquivos temporários...");
        const t = await cleanTemp();
        add("✔ " + t.message);

        add("🧠 Otimizando memória (4 técnicas)...");
        const r = await clearRAM();
        add((r.success ? "✔ " : "❌ ") + r.message);
        if (r.details) r.details.forEach((d) => add("   • " + d));
        if (r.warning) add("⚠️ " + r.warning);

        add("🌐 Limpando cache de DNS...");
        const d = await flushDNS();
        add("✔ " + d.message);

        add("🎮 Ajustando plano de energia...");
        const g = await gamingMode(mode === "gaming");
        add("✔ " + g.message);

        add("🎯 Otimização concluída");

        const after = await getSnapshot();
        add(
            `📊 RAM antes: ${before.ram}% (${before.ramLivreMB} MB livres) | depois: ${after.ram}% (${after.ramLivreMB} MB livres)`
        );

        const filePath = getLogPath();

        try {
            fs.writeFileSync(filePath, log.join("\n"), "utf-8");
            exec(`start "" "${filePath}"`);
        } catch (writeErr) {
            console.error("Falha ao gravar log:", writeErr);
        }

        return {
            success: true,
            elevated,
            before,
            after,
            gain: calculateGain(before, after),
            ramDetails: r,
            log,
            file: filePath
        };

    } catch (err) {
        add("❌ ERRO: " + err.toString());
        return {
            success: false,
            message: err.toString(),
            log
        };

    } finally {
        emExecucao = false;
    }
}

/* ============================================================
   EXPORTAÇÃO
============================================================ */

module.exports = {
    cleanTemp,
    clearRAM,
    flushDNS,
    gamingMode,
    runOptimization,
    isElevated
};