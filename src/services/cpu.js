const si = require("systeminformation");

async function getUsage() {
    const load = await si.currentLoad();
    return load.currentLoad.toFixed(1);
}

module.exports = {
    getUsage
};