// test/unit/detection/setup-env.js
// Polyfills for Node.js test environment before ES module dependencies load

if (typeof globalThis.localStorage === "undefined") {
    globalThis.localStorage = {
        _data: {},
        getItem(k) { return this._data[k] ?? null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; },
        clear() { this._data = {}; }
    };
}
