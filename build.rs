//! 构建脚本：为 Windows 可执行文件嵌入应用图标（对齐原 PyInstaller 产物）。

fn main() {
    #[cfg(target_os = "windows")]
    {
        let icon = "assets/icon.ico";
        if std::path::Path::new(icon).exists() {
            match winresource::WindowsResource::new().set_icon(icon).compile() {
                Ok(_) => {}
                Err(e) => {
                    println!("cargo:warning=图标嵌入失败（不影响功能）: {}", e);
                }
            }
        }
    }
    println!("cargo:rerun-if-changed=assets/icon.ico");
}
