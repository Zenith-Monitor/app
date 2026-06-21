const MAX_POINTS = 60;

let cpuChart;
let ramChart;
let gpuChart;
let diskChart;

document.addEventListener("DOMContentLoaded", () => {

    console.log("RENDERER: Solicitando stats:start");
    window.api.startStats();

    /**
     * ======================
     * OPTIMIZER LOG SYSTEM
     * ======================
     */
    const logBox = document.getElementById("opt-log");

    function classifyLogLine(msg) {
        if (msg.startsWith("✔")) return "log-ok";
        if (msg.startsWith("❌")) return "log-error";
        if (msg.startsWith("⚠️")) return "log-warn";
        if (msg.startsWith("🛡️") || msg.startsWith("📊")) return "log-info";
        return "";
    }

    function log(msg) {
        if (!logBox) return;
        const line = document.createElement("div");
        line.className = "log-item " + classifyLogLine(msg);
        line.textContent = msg;
        logBox.appendChild(line);
        logBox.scrollTop = logBox.scrollHeight;
    }

    /**
     * ======================
     * SAFE CALL WRAPPER
     * ======================
     */
    function safeCall(fn, label) {
        return async () => {
            try {
                log(`🚀 ${label}...`);
                const res = await fn();

                if (res?.message) log(`✔ ${res.message}`);
                else if (res?.success) log(`✔ OK`);
                else log(`✔ Concluído`);

                return res;
            } catch (err) {
                log(`❌ Erro: ${err?.message || err}`);
            }
        };
    }

    /**
     * ======================
     * OPTIMIZER BUTTONS
     * ======================
     */
    const btnOptimize = document.getElementById("optimize-btn");
    const btnTemp = document.getElementById("temp-btn");
    const btnRam = document.getElementById("ram-btn");
    const btnGaming = document.getElementById("gaming-btn");

    if (btnOptimize) {
        btnOptimize.addEventListener("click", async () => {

            log("🚀 Iniciando otimização completa...");

            await safeCall(() => window.api.optimizer.cleanTemp(), "Limpando temporários")();
            await safeCall(() => window.api.optimizer.clearRAM(), "Otimizando memória")();
            await safeCall(() => window.api.optimizer.flushDNS(), "Limpando DNS")();
            await safeCall(() => window.api.optimizer.gamingMode(true), "Ativando modo gaming")();

            log("🎯 Otimização completa concluída");
        });
    }

    if (btnTemp) {
        btnTemp.addEventListener("click",
            safeCall(() => window.api.optimizer.cleanTemp(), "Limpeza de temporários")
        );
    }

    if (btnRam) {
        btnRam.addEventListener("click",
            safeCall(() => window.api.optimizer.clearRAM(), "Limpeza de memória")
        );
    }

    if (btnGaming) {
        btnGaming.addEventListener("click",
            safeCall(() => window.api.optimizer.gamingMode(true), "Modo gaming")
        );
    }

    /**
     * ======================
     * HELPERS DE FORMATAÇÃO
     * ======================
     */
    function formatarUptime(segundos) {
        if (!segundos && segundos !== 0) return "—";
        const horas = Math.floor(segundos / 3600);
        const minutos = Math.floor((segundos % 3600) / 60);
        return `${horas}h ${minutos}min ativo`;
    }

    /**
     * ======================
     * STATS STREAM
     * ======================
     */
    window.api.onStats((stats) => {

        try {

            const cpu = stats.cpu?.usage || 0;
            const ram = stats.ram?.usage || 0;
            const gpu = stats.gpu?.usage || 0;

            document.getElementById("cpu-text").innerHTML =
                `${cpu.toFixed(1)}%<br><small>${stats.cpu?.cores || 0} núcleos</small>`;

            document.getElementById("ram-text").innerHTML =
                `${ram.toFixed(1)}%<br><small>${stats.ram?.usedGB || 0} / ${stats.ram?.totalGB || 0} GB</small>`;

            document.getElementById("gpu-text").innerHTML =
                `${gpu.toFixed(1)}%<br><small>${stats.gpu?.model || "GPU desconhecida"}</small>`;

            const disks = stats.disk || [];
            const select = document.getElementById("disk-select");

            if (select && select.options.length === 0) {
                disks.forEach((disk, index) => {
                    const option = document.createElement("option");
                    option.value = index;
                    option.textContent = disk.fs || `Disco ${index}`;
                    select.appendChild(option);
                });
            }

            const disk = disks[Number(select?.value || 0)]?.use || 0;

            document.getElementById("disk-text").innerHTML =
                `${disk.toFixed(1)}%<br><small>Disco</small>`;

            const score = Math.max(
                0,
                Math.round(100 - (cpu * 0.45) - (ram * 0.25) - (disk * 0.15))
            );

            document.getElementById("performance-score").innerText = score;

            // ---- Status dinâmico do sistema ----
            const statusText = document.getElementById("system-status-text");
            const statusDot = document.getElementById("status-dot-live");

            if (statusText && statusDot) {
                let label = "Estável";
                let estado = "";

                if (score < 40) {
                    label = "Crítico";
                    estado = "status-danger";
                } else if (score < 70) {
                    label = "Moderado";
                    estado = "status-warn";
                }

                statusText.textContent = label;
                statusDot.className = "status-dot-live " + estado;
            }

            // ---- Hostname / uptime ----
            if (stats.system) {
                const meta = document.getElementById("system-meta");
                if (meta) {
                    meta.textContent = `${stats.system.hostname} · ${formatarUptime(stats.system.uptime)}`;
                }

                const footerHost = document.getElementById("footer-host");
                if (footerHost) {
                    footerHost.textContent = stats.system.hostname;
                }
            }

            push(cpuChart, cpu);
            push(ramChart, ram);
            push(gpuChart, gpu);
            push(diskChart, disk);

        } catch (err) {
            console.error("Dashboard Error:", err);
        }
    });

    /**
     * ======================
     * NAVIGATION
     * ======================
     */
    const tabs = document.querySelectorAll(".tab");
    const pages = document.querySelectorAll(".page");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {

            tabs.forEach(t => t.classList.remove("active"));
            pages.forEach(p => p.classList.remove("active"));

            tab.classList.add("active");

            document
                .getElementById(tab.dataset.page)
                .classList.add("active");
        });
    });

    /**
     * ======================
     * CHARTS — cores por canal (CH.01-04)
     * ======================
     */
    function createChart(id, color) {
        return new Chart(document.getElementById(id), {
            type: "line",
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    borderColor: color,
                    borderWidth: 2,
                    tension: 0.35,
                    pointRadius: 0,
                    fill: true,
                    backgroundColor: color + "1a"
                }]
            },
            options: {
                responsive: true,
                animation: false,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        display: false,
                        grid: { display: false }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        ticks: { display: false },
                        grid: { color: "rgba(255,255,255,.05)" }
                    }
                }
            }
        });
    }

    cpuChart = createChart("cpuChart", "#ffb454");
    ramChart = createChart("ramChart", "#5fe3c0");
    gpuChart = createChart("gpuChart", "#ff6b5b");
    diskChart = createChart("diskChart", "#5b9dff");

    function push(chart, value) {
        chart.data.labels.push("");
        chart.data.datasets[0].data.push(value);

        if (chart.data.labels.length > MAX_POINTS) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }

        chart.update("none");
    }
});