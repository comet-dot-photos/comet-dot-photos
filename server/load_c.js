// ===============================
// server/native/loader.js
// ===============================
/* Koffi loader for platform-specific shared libs */
const koffi = require("koffi");
const fs2 = require("fs");
const path2 = require("path");

function resolveLibPath() {
  const base = path2.join(__dirname, "/c_build");
  if (process.platform === "darwin") {
    if (process.arch === 'arm64') return path2.join(base, "checkvis.darwin_arm64.dylib");
    if (process.arch === "x64") return path2.join(base, "checkvis.darwin_x64.dylib");
  } else if (process.platform === "win32") {
    if (process.arch === "x64") return path2.join(base, "checkvis.win_x64.dll");
  } else if (process.platform === "linux") {
    if (process.arch === "x64" && fs2.existsSync("/etc/redhat-release"))
      return path2.join(base, "checkvis.linux_redhat_x64.so");
    if (process.arch === "x64" && fs2.existsSync("/etc/debian_version"))
      return path2.join(base, "checkvis.linux_debian_x64.so");
  }
  throw new Error(`Unsupported platform ${process.platform}/${process.arch}`);
}

function load_c() {
  const p = resolveLibPath();
  const lib = koffi.load(p);
  return {
    c_load_vbuff: lib.func("int load_vbuff(char*, int, int)"),
    c_check_vis: lib.func("void check_vis(int, uint8_t*, uint64_t*)"),
    // c_count_vis: lib.func('int count_vis(uint64_t*)'), // for debugging
  };
}

module.exports = { load_c };