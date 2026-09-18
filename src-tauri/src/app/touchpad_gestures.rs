//! Native touchpad gestures for the publish map.
//!
//! WebView2 hosted by wry never delivers touchpad pinch to the page (no ctrl+wheel,
//! no visualViewport scale), even though the same gesture works in Edge. We read the
//! raw finger contacts through Win32 Raw Input and run one recognizer for both
//! two-finger pan and pinch, so the two never fight each other.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

pub const TOUCHPAD_GESTURE_EVENT: &str = "touchpad-gesture";

/// Finger motion (relative to the starting spread) needed before the gesture locks in.
const LOCK_MOTION_RATIO: f64 = 0.12;
/// A gesture is a pinch only when the spread changes this many times more than the
/// centroid travels. Pinch with one finger resting gives 2.0, a pure pinch ~infinity;
/// slightly converging two-finger scrolls stay well below. Ties go to pan.
const PINCH_DOMINANCE: f64 = 1.5;
const MIN_FINGER_DISTANCE: f64 = 1e-6;
const RATIO_EPSILON: f64 = 1e-4;
const PAN_EPSILON_MM: f64 = 1e-3;

/// Finger position in millimetres on the touchpad surface.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Contact {
    pub id: u32,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GestureEvent {
    /// Number of fingers on the touchpad changed.
    Contacts { count: usize },
    /// Two-finger pan in millimetres (finger movement direction).
    Pan { dx: f64, dy: f64 },
    /// Zoom ratio since the previous pinch event.
    Pinch { ratio: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum GestureMode {
    Pending,
    Pinch,
    Pan,
}

#[derive(Clone, Copy, Debug)]
struct Gesture {
    ids: [u32; 2],
    start_distance: f64,
    start_centroid: (f64, f64),
    last_distance: f64,
    last_centroid: (f64, f64),
    mode: GestureMode,
}

/// Turns touchpad frames (all fingers currently touching) into pan / pinch events.
#[derive(Default)]
pub struct GestureTracker {
    gesture: Option<Gesture>,
    contact_count: usize,
}

impl GestureTracker {
    pub fn frame(&mut self, touching: &[Contact], events: &mut Vec<GestureEvent>) {
        if touching.len() != self.contact_count {
            self.contact_count = touching.len();
            events.push(GestureEvent::Contacts { count: touching.len() });
        }
        if touching.len() != 2 {
            self.gesture = None;
            return;
        }
        let (a, b) = if touching[0].id <= touching[1].id {
            (touching[0], touching[1])
        } else {
            (touching[1], touching[0])
        };
        let distance = (b.x - a.x).hypot(b.y - a.y);
        if distance < MIN_FINGER_DISTANCE {
            return;
        }
        let centroid = ((a.x + b.x) / 2.0, (a.y + b.y) / 2.0);
        let ids = [a.id, b.id];

        let gesture = match self.gesture.as_mut() {
            Some(gesture) if gesture.ids == ids => gesture,
            _ => {
                self.gesture = Some(Gesture {
                    ids,
                    start_distance: distance,
                    start_centroid: centroid,
                    last_distance: distance,
                    last_centroid: centroid,
                    mode: GestureMode::Pending,
                });
                return;
            }
        };

        if gesture.mode == GestureMode::Pending {
            let spread_change = (distance - gesture.start_distance).abs();
            let travel = (centroid.0 - gesture.start_centroid.0)
                .hypot(centroid.1 - gesture.start_centroid.1);
            if spread_change.max(travel) < LOCK_MOTION_RATIO * gesture.start_distance {
                return;
            }
            // Lock in and replay everything since touch-down, so no motion is lost.
            gesture.mode = if spread_change >= PINCH_DOMINANCE * travel {
                GestureMode::Pinch
            } else {
                GestureMode::Pan
            };
            gesture.last_distance = gesture.start_distance;
            gesture.last_centroid = gesture.start_centroid;
        }

        match gesture.mode {
            GestureMode::Pending => {}
            GestureMode::Pinch => {
                let ratio = distance / gesture.last_distance;
                gesture.last_distance = distance;
                if (ratio - 1.0).abs() >= RATIO_EPSILON {
                    events.push(GestureEvent::Pinch { ratio });
                }
            }
            GestureMode::Pan => {
                let dx = centroid.0 - gesture.last_centroid.0;
                let dy = centroid.1 - gesture.last_centroid.1;
                gesture.last_centroid = centroid;
                if dx.abs() >= PAN_EPSILON_MM || dy.abs() >= PAN_EPSILON_MM {
                    events.push(GestureEvent::Pan { dx, dy });
                }
            }
        }
    }
}

#[cfg(windows)]
pub use native::start;

#[cfg(windows)]
mod native {
    use super::{Contact, GestureTracker, TOUCHPAD_GESTURE_EVENT};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use tauri::{AppHandle, Emitter};
    use windows::core::w;
    use windows::Win32::Devices::HumanInterfaceDevice::{
        HidP_GetCaps, HidP_GetUsageValue, HidP_GetUsages, HidP_GetValueCaps, HidP_Input,
        HIDP_CAPS, HIDP_STATUS_SUCCESS, HIDP_VALUE_CAPS, PHIDP_PREPARSED_DATA,
    };
    use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::{
        GetRawInputData, GetRawInputDeviceInfoW, RegisterRawInputDevices, HRAWINPUT, RAWINPUT,
        RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK, RIDI_PREPARSEDDATA, RID_INPUT,
        RIM_TYPEHID,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetForegroundWindow, GetMessageW,
        GetWindowThreadProcessId, RegisterClassW, HWND_MESSAGE, MSG, WINDOW_EX_STYLE,
        WINDOW_STYLE, WM_INPUT, WNDCLASSW,
    };

    const PAGE_GENERIC_DESKTOP: u16 = 0x01;
    const PAGE_DIGITIZER: u16 = 0x0D;
    const USAGE_X: u16 = 0x30;
    const USAGE_Y: u16 = 0x31;
    const USAGE_TOUCH_PAD: u16 = 0x05;
    const USAGE_TIP_SWITCH: u16 = 0x42;
    const USAGE_CONTACT_ID: u16 = 0x51;
    const USAGE_CONTACT_COUNT: u16 = 0x54;
    const MAX_BUTTON_USAGES: usize = 16;

    /// Typical precision touchpad resolution, used when the descriptor has no units.
    const FALLBACK_MM_PER_LOGICAL_UNIT: f64 = 0.04;

    /// Millimetres per physical unit from a HID unit code (length only: cm or inch).
    fn unit_mm(units: u32, units_exp: u32) -> Option<f64> {
        let base_mm = match units & 0xF {
            1 => 10.0,
            3 => 25.4,
            _ => return None,
        };
        if (units >> 4) & 0xF != 1 {
            return None;
        }
        let nibble = (units_exp & 0xF) as i32;
        let exponent = if nibble > 7 { nibble - 16 } else { nibble };
        Some(base_mm * 10f64.powi(exponent))
    }

    #[derive(Clone, Copy)]
    struct Axis {
        logical_min: i32,
        logical_max: i32,
        span: f64,
    }

    impl Axis {
        fn from_caps(caps: &HIDP_VALUE_CAPS) -> Self {
            let logical = f64::from(caps.LogicalMax - caps.LogicalMin);
            let physical = f64::from(caps.PhysicalMax - caps.PhysicalMin);
            let span = match unit_mm(caps.Units, caps.UnitsExp) {
                Some(mm) if physical > 0.0 => physical * mm,
                _ => logical * FALLBACK_MM_PER_LOGICAL_UNIT,
            };
            Self {
                logical_min: caps.LogicalMin,
                logical_max: caps.LogicalMax,
                span,
            }
        }

        fn normalize(&self, value: u32) -> f64 {
            let range = f64::from(self.logical_max - self.logical_min).max(1.0);
            (f64::from(value as i32 - self.logical_min) / range) * self.span
        }
    }

    struct FingerSlot {
        link: u16,
        x: Axis,
        y: Axis,
    }

    struct DeviceLayout {
        preparsed: Vec<u64>,
        slots: Vec<FingerSlot>,
    }

    impl DeviceLayout {
        fn preparsed(&self) -> PHIDP_PREPARSED_DATA {
            PHIDP_PREPARSED_DATA(self.preparsed.as_ptr() as isize)
        }
    }

    /// Collects the contacts of one hybrid-mode frame, which may span several reports.
    #[derive(Default)]
    struct FrameAccumulator {
        expected: usize,
        seen: usize,
        contacts: Vec<Contact>,
    }

    struct State {
        app: AppHandle,
        devices: HashMap<isize, Option<DeviceLayout>>,
        frames: HashMap<isize, FrameAccumulator>,
        tracker: GestureTracker,
    }

    thread_local! {
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    }

    pub fn start(app: AppHandle) {
        let spawned = std::thread::Builder::new()
            .name("touchpad-pinch".into())
            .spawn(move || unsafe { run(app) });
        if let Err(error) = spawned {
            log::warn!("touchpad pinch: failed to spawn listener thread: {error}");
        }
    }

    unsafe fn run(app: AppHandle) {
        let instance = match GetModuleHandleW(None) {
            Ok(module) => module.into(),
            Err(error) => {
                log::warn!("touchpad pinch: GetModuleHandleW failed: {error}");
                return;
            }
        };
        let class_name = w!("OpenClipperTouchpadPinch");
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: class_name,
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            log::warn!("touchpad pinch: RegisterClassW failed");
            return;
        }
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            w!(""),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance),
            None,
        ) {
            Ok(hwnd) => hwnd,
            Err(error) => {
                log::warn!("touchpad pinch: CreateWindowExW failed: {error}");
                return;
            }
        };

        let device = RAWINPUTDEVICE {
            usUsagePage: PAGE_DIGITIZER,
            usUsage: USAGE_TOUCH_PAD,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        };
        if let Err(error) =
            RegisterRawInputDevices(&[device], std::mem::size_of::<RAWINPUTDEVICE>() as u32)
        {
            log::warn!("touchpad pinch: RegisterRawInputDevices failed: {error}");
            return;
        }

        STATE.with(|state| {
            *state.borrow_mut() = Some(State {
                app,
                devices: HashMap::new(),
                frames: HashMap::new(),
                tracker: GestureTracker::default(),
            });
        });
        log::info!("touchpad pinch: raw input listener registered");

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            DispatchMessageW(&message);
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_INPUT {
            STATE.with(|state| {
                if let Some(state) = state.borrow_mut().as_mut() {
                    state.handle_input(HRAWINPUT(lparam.0 as _));
                }
            });
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }

    fn app_is_foreground() -> bool {
        unsafe {
            let foreground = GetForegroundWindow();
            if foreground.is_invalid() {
                return false;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(foreground, Some(&mut pid));
            pid == std::process::id()
        }
    }

    unsafe fn load_layout(device: HANDLE) -> Option<DeviceLayout> {
        let mut size = 0u32;
        GetRawInputDeviceInfoW(Some(device), RIDI_PREPARSEDDATA, None, &mut size);
        if size == 0 {
            return None;
        }
        let mut preparsed = vec![0u64; (size as usize).div_ceil(8)];
        let copied = GetRawInputDeviceInfoW(
            Some(device),
            RIDI_PREPARSEDDATA,
            Some(preparsed.as_mut_ptr().cast()),
            &mut size,
        );
        if copied == u32::MAX {
            return None;
        }
        let handle = PHIDP_PREPARSED_DATA(preparsed.as_ptr() as isize);

        let mut caps = HIDP_CAPS::default();
        if HidP_GetCaps(handle, &mut caps) != HIDP_STATUS_SUCCESS {
            return None;
        }
        let mut count = caps.NumberInputValueCaps;
        let mut value_caps = vec![HIDP_VALUE_CAPS::default(); usize::from(count)];
        if HidP_GetValueCaps(HidP_Input, value_caps.as_mut_ptr(), &mut count, handle)
            != HIDP_STATUS_SUCCESS
        {
            return None;
        }
        value_caps.truncate(usize::from(count));

        let mut axes: HashMap<u16, (Option<Axis>, Option<Axis>)> = HashMap::new();
        for cap in &value_caps {
            if cap.UsagePage != PAGE_GENERIC_DESKTOP || cap.IsRange {
                continue;
            }
            let usage = cap.Anonymous.NotRange.Usage;
            let entry = axes.entry(cap.LinkCollection).or_default();
            if usage == USAGE_X {
                entry.0 = Some(Axis::from_caps(cap));
            } else if usage == USAGE_Y {
                entry.1 = Some(Axis::from_caps(cap));
            }
        }
        let mut slots: Vec<FingerSlot> = axes
            .into_iter()
            .filter_map(|(link, axes)| match axes {
                (Some(x), Some(y)) => Some(FingerSlot { link, x, y }),
                _ => None,
            })
            .collect();
        slots.sort_by_key(|slot| slot.link);
        if slots.is_empty() {
            return None;
        }
        log::info!("touchpad pinch: touchpad with {} finger slots", slots.len());
        Some(DeviceLayout { preparsed, slots })
    }

    impl State {
        unsafe fn handle_input(&mut self, input: HRAWINPUT) {
            let header_size = std::mem::size_of::<RAWINPUTHEADER>() as u32;
            let mut size = 0u32;
            GetRawInputData(input, RID_INPUT, None, &mut size, header_size);
            if size == 0 {
                return;
            }
            let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
            let read = GetRawInputData(
                input,
                RID_INPUT,
                Some(buffer.as_mut_ptr().cast()),
                &mut size,
                header_size,
            );
            if read == u32::MAX || read == 0 {
                return;
            }
            let raw = &*(buffer.as_ptr() as *const RAWINPUT);
            if raw.header.dwType != RIM_TYPEHID.0 {
                return;
            }
            let device_key = raw.header.hDevice.0 as isize;
            let device = raw.header.hDevice;
            let layout = self
                .devices
                .entry(device_key)
                .or_insert_with(|| load_layout(device));
            let Some(layout) = layout.as_ref() else {
                return;
            };

            let hid = &raw.data.hid;
            let report_size = hid.dwSizeHid as usize;
            let report_count = hid.dwCount as usize;
            if report_size == 0 {
                return;
            }
            let data = std::slice::from_raw_parts(hid.bRawData.as_ptr(), report_size * report_count);
            let frame = self.frames.entry(device_key).or_default();
            let mut events = Vec::new();
            for chunk in data.chunks_exact(report_size) {
                if let Some(touching) = read_report(layout, frame, chunk) {
                    self.tracker.frame(&touching, &mut events);
                }
            }
            if events.is_empty() || !app_is_foreground() {
                return;
            }
            for event in events {
                let _ = self.app.emit(TOUCHPAD_GESTURE_EVENT, event);
            }
        }
    }

    /// Feeds one HID report into the frame accumulator. Returns the touching contacts
    /// once every contact announced by the frame's contact count has been read.
    unsafe fn read_report(
        layout: &DeviceLayout,
        frame: &mut FrameAccumulator,
        report: &[u8],
    ) -> Option<Vec<Contact>> {
        let preparsed = layout.preparsed();
        let mut contact_count = 0u32;
        let count_status = HidP_GetUsageValue(
            HidP_Input,
            PAGE_DIGITIZER,
            None,
            USAGE_CONTACT_COUNT,
            &mut contact_count,
            preparsed,
            report,
        );
        if count_status == HIDP_STATUS_SUCCESS && contact_count > 0 {
            *frame = FrameAccumulator {
                expected: contact_count as usize,
                ..Default::default()
            };
        }
        if frame.seen >= frame.expected {
            return None;
        }

        let mut report = report.to_vec();
        let slots_in_report = layout.slots.len().min(frame.expected - frame.seen);
        for slot in layout.slots.iter().take(slots_in_report) {
            frame.seen += 1;
            let mut usages = [0u16; MAX_BUTTON_USAGES];
            let mut usage_len = MAX_BUTTON_USAGES as u32;
            let tip = HidP_GetUsages(
                HidP_Input,
                PAGE_DIGITIZER,
                Some(slot.link),
                usages.as_mut_ptr(),
                &mut usage_len,
                preparsed,
                &mut report,
            ) == HIDP_STATUS_SUCCESS
                && usages[..usage_len as usize].contains(&USAGE_TIP_SWITCH);
            if !tip {
                continue;
            }
            let mut id = u32::from(slot.link);
            let _ = HidP_GetUsageValue(
                HidP_Input,
                PAGE_DIGITIZER,
                Some(slot.link),
                USAGE_CONTACT_ID,
                &mut id,
                preparsed,
                &report,
            );
            let (mut x, mut y) = (0u32, 0u32);
            if HidP_GetUsageValue(HidP_Input, PAGE_GENERIC_DESKTOP, Some(slot.link), USAGE_X, &mut x, preparsed, &report)
                != HIDP_STATUS_SUCCESS
                || HidP_GetUsageValue(HidP_Input, PAGE_GENERIC_DESKTOP, Some(slot.link), USAGE_Y, &mut y, preparsed, &report)
                    != HIDP_STATUS_SUCCESS
            {
                continue;
            }
            frame.contacts.push(Contact {
                id,
                x: slot.x.normalize(x),
                y: slot.y.normalize(y),
            });
        }

        if frame.seen >= frame.expected {
            Some(std::mem::take(&mut frame.contacts))
        } else {
            None
        }
    }
}

