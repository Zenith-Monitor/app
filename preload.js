const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

    window: {
        minimize: () => ipcRenderer.invoke("window:minimize"),
        maximize: () => ipcRenderer.invoke("window:maximize"),
        close: () => ipcRenderer.invoke("window:close")
    },

    optimizer: {

        temp: () => ipcRenderer.invoke("optimizer:temp"),
        ram: () => ipcRenderer.invoke("optimizer:ram"),
        dns: () => ipcRenderer.invoke("optimizer:dns"),
        gaming: (enable) => ipcRenderer.invoke("optimizer:gaming", enable),

        cleanTemp: () => ipcRenderer.invoke("optimizer:temp"),
        clearRAM: () => ipcRenderer.invoke("optimizer:ram"),
        flushDNS: () => ipcRenderer.invoke("optimizer:dns"),
        gamingMode: (enable) => ipcRenderer.invoke("optimizer:gaming", enable),

        runOptimization: (mode) =>
            ipcRenderer.invoke("optimizer:run", mode)
    },

    startStats: () => ipcRenderer.invoke("stats:start"),

    onStats: (callback) =>
        ipcRenderer.on("stats:update", (_, data) => callback(data)),

    process: {
        list: () => ipcRenderer.invoke("process:list"),
        kill: (pid) => ipcRenderer.invoke("process:kill", pid)
    }
});