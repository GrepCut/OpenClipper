#[cfg(windows)]
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, IDXGIFactory1,
};

/// Select the hardware adapter with the most dedicated VRAM. sherpa-onnx
/// otherwise hard-codes DirectML device 0, often the integrated GPU.
#[cfg(windows)]
pub fn configure_preferred_adapter() {
    const ENV_KEY: &str = "OPEN_CLIPPER_DIRECTML_DEVICE_ID";
    if let Ok(value) = std::env::var(ENV_KEY) {
        if value.parse::<u32>().is_ok() {
            log::info!("Parakeet DirectML: using configured adapter index {value}");
            return;
        }
    }

    let factory = match unsafe { CreateDXGIFactory1::<IDXGIFactory1>() } {
        Ok(factory) => factory,
        Err(error) => {
            log::warn!("Parakeet DirectML: cannot enumerate adapters ({error})");
            return;
        }
    };

    let mut selected: Option<(u32, usize, String)> = None;
    for index in 0..32u32 {
        let adapter = match unsafe { factory.EnumAdapters1(index) } {
            Ok(adapter) => adapter,
            Err(_) => break,
        };
        let desc = match unsafe { adapter.GetDesc1() } {
            Ok(desc) => desc,
            Err(error) => {
                log::warn!("Parakeet DirectML: cannot inspect adapter {index} ({error})");
                continue;
            }
        };
        if (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
            continue;
        }
        let name = String::from_utf16_lossy(&desc.Description)
            .trim_end_matches('\0')
            .trim()
            .to_owned();
        let vram = desc.DedicatedVideoMemory;
        if selected.as_ref().is_none_or(|(_, best_vram, _)| vram > *best_vram) {
            selected = Some((index, vram, name));
        }
    }

    if let Some((index, vram, name)) = selected {
        std::env::set_var(ENV_KEY, index.to_string());
        log::info!(
            "Parakeet DirectML: selected adapter index={index} name={name:?} dedicated_vram_mib={}",
            vram / (1024 * 1024)
        );
    } else {
        log::warn!("Parakeet DirectML: no hardware adapter found; sherpa-onnx will use its default");
    }
}

#[cfg(not(windows))]
pub fn configure_preferred_adapter() {}
