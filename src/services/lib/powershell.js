/**
 * ============================================================
 *  ZENITH MONITOR — Utilitários de execução de comandos
 * ============================================================
 *  Centraliza a execução de comandos no CMD e no PowerShell,
 *  pra não duplicar essa lógica entre o módulo de otimização
 *  e o módulo de métricas.
 * ============================================================
 */

const { exec } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

/**
 * Executa um comando simples no CMD do Windows.
 * @param {string} comando
 * @returns {Promise<{output?: string, error?: string}>}
 */
function runCMD(comando) {
    return new Promise((resolve) => {
        exec(comando, { windowsHide: true }, (err, stdout, stderr) => {
            if (err) return resolve({ error: stderr || err.message });
            resolve({ output: stdout });
        });
    });
}

/**
 * Executa um comando curto e único via "powershell -Command".
 * Para scripts longos ou com aspas/variáveis complexas, use
 * runPowerShellScript() em vez desta função.
 * @param {string} comando
 */
function runPowerShell(comando) {
    return new Promise((resolve) => {
        exec(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${comando}"`,
            { windowsHide: true },
            (err, stdout, stderr) => {
                if (err) return resolve({ error: stderr || err.message });
                resolve({ output: stdout });
            }
        );
    });
}

/**
 * Executa um script PowerShell completo (multi-linha), salvando-o
 * primeiro em um arquivo temporário. Isso evita os problemas de
 * escaping de aspas que acontecem com "-Command" em scripts grandes.
 * @param {string} conteudoScript
 */
function runPowerShellScript(conteudoScript) {
    return new Promise((resolve) => {
        const arquivoTemp = path.join(
            os.tmpdir(),
            `zenith_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`
        );

        try {
            fs.writeFileSync(arquivoTemp, conteudoScript, "utf-8");
        } catch (err) {
            return resolve({ error: "Falha ao criar script temporário: " + err.message });
        }

        exec(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${arquivoTemp}"`,
            { windowsHide: true, maxBuffer: 1024 * 1024 * 10 },
            (err, stdout, stderr) => {
                try { fs.unlinkSync(arquivoTemp); } catch (e) { /* ignora */ }

                if (err) return resolve({ error: stderr || err.message });
                resolve({ output: stdout });
            }
        );
    });
}

/**
 * Verifica se o processo atual está rodando com privilégios
 * de Administrador no Windows.
 * @returns {Promise<boolean>}
 */
function isElevated() {
    return new Promise((resolve) => {
        exec("net session", { windowsHide: true }, (err) => {
            resolve(!err);
        });
    });
}

module.exports = {
    runCMD,
    runPowerShell,
    runPowerShellScript,
    isElevated
};