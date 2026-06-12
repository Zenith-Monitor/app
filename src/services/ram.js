const si = require("systeminformation");

async function getUsage() {

    const mem = await si.mem();

    return (
        (mem.used / mem.total) * 100
    ).toFixed(1);
}

module.exports = {
    getUsage
};