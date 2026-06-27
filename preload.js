const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

    window: {
        minimize: () => ipcRenderer.invoke("window:minimize"),
        maximize: () => ipcRenderer.invoke("window:maximize"),
        close: () => ipcRenderer.invoke("window:close")
    },

    optimizer: {
        temp:     () => ipcRenderer.invoke("optimizer:temp"),
        prefetch: () => ipcRenderer.invoke("optimizer:prefetch"),
        ram:      () => ipcRenderer.invoke("optimizer:ram"),
        dns:      () => ipcRenderer.invoke("optimizer:dns"),
        gaming:   (enable) => ipcRenderer.invoke("optimizer:gaming", enable),

        // compatibilidade com o renderer atual
        cleanTemp:   () => ipcRenderer.invoke("optimizer:temp"),
        cleanPrefetch: () => ipcRenderer.invoke("optimizer:prefetch"),
        clearRAM:    () => ipcRenderer.invoke("optimizer:ram"),
        flushDNS:    () => ipcRenderer.invoke("optimizer:dns"),
        gamingMode:  (enable) => ipcRenderer.invoke("optimizer:gaming", enable),

        runOptimization: (mode) => ipcRenderer.invoke("optimizer:run", mode),
        abrirLog: () => ipcRenderer.invoke("optimizer:abrir-log")
    },

    startStats: () => ipcRenderer.invoke("stats:start"),

    onStats: (callback) =>
        ipcRenderer.on("stats:update", (_, data) => callback(data)),

    process: {
        list: () => ipcRenderer.invoke("process:list"),
        kill: (pid) => ipcRenderer.invoke("process:kill", pid)
    }
});