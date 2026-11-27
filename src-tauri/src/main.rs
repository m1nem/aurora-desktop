// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1"); }
    aurora_lib::run();
}
