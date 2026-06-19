const { AsyncLocalStorage } = require("async_hooks");

const dbStore = new AsyncLocalStorage();

module.exports = dbStore;
