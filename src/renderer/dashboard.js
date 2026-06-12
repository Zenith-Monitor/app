async function updateStats() {

    const stats = await window.api.getStats();

    document.getElementById("cpu").textContent =
        stats.cpu + "%";

    document.getElementById("ram").textContent =
        stats.ram + "%";
}

updateStats();

setInterval(updateStats, 1000);