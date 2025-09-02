// ===============================
// server/native/loader.js
// ===============================
/* Koffi loader for platform-specific shared libs */
const koffi = require("koffi");
const path2 = require("path");

function resolveLibPath() {
  const base = path2.join(__dirname, "/c_build");
  if (process.platform === "darwin") {
    if (process.arch === 'arm64' || process.arch === 'x64')
         return path2.join(base, "checkvis2.darwin.dylib");
  } else if (process.platform === "win32") {
    if (process.arch === "x64") return path2.join(base, "checkvis2.win_x64.dll");
  } else if (process.platform === "linux") {
    if (process.arch === "x64") return path2.join(base, "checkvis2.linux_x64.so");
  }
  throw new Error(`Unsupported platform ${process.platform}/${process.arch}`);
}

function load_c() {
  const p = resolveLibPath();
  const lib = koffi.load(p);
  return {
    c_load_vbuff2: lib.func("int load_vbuff2(int, char*, int, int)"),
    c_check_vis2: lib.func("void check_vis2(int, int, uint8_t*, uint64_t*)"),
    // c_count_vis2: lib.func('int count_vis(uint64_t*)'), // for debugging
  };
}

module.exports = { load_c };