//! Display enumeration in CoreGraphics global coordinates (points,
//! origin at the top-left of the primary display).

use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGDisplayCopyDisplayMode, CGDisplayMode, CGGetActiveDisplayList,
    CGMainDisplayID,
};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: u32,
    /// 1-based index (1 = main) as used by the URL scheme `display` param.
    pub index: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub is_main: bool,
}

impl Display {
    pub fn contains(&self, px: f64, py: f64) -> bool {
        px >= self.x && px < self.x + self.width && py >= self.y && py < self.y + self.height
    }
    pub fn pixel_width(&self) -> usize {
        (self.width * self.scale).round() as usize
    }
    pub fn pixel_height(&self) -> usize {
        (self.height * self.scale).round() as usize
    }
}

pub fn list() -> Vec<Display> {
    let mut ids: [CGDirectDisplayID; 32] = [0; 32];
    let mut count: u32 = 0;
    unsafe {
        CGGetActiveDisplayList(32, ids.as_mut_ptr(), &mut count);
    }
    let main = CGMainDisplayID();
    let mut out: Vec<Display> = ids[..count as usize]
        .iter()
        .map(|&id| {
            let b = CGDisplayBounds(id);
            let mode = CGDisplayCopyDisplayMode(id);
            let pw = CGDisplayMode::pixel_width(mode.as_deref()) as f64;
            let scale = if b.size.width > 0.0 && pw > 0.0 { (pw / b.size.width).max(1.0) } else { 1.0 };
            Display {
                id,
                index: 0,
                x: b.origin.x,
                y: b.origin.y,
                width: b.size.width,
                height: b.size.height,
                scale,
                is_main: id == main,
            }
        })
        .collect();
    // main display first, others left-to-right
    out.sort_by(|a, b| b.is_main.cmp(&a.is_main).then(a.x.partial_cmp(&b.x).unwrap()));
    for (i, d) in out.iter_mut().enumerate() {
        d.index = i + 1;
    }
    out
}

pub fn primary_height() -> f64 {
    CGDisplayBounds(CGMainDisplayID()).size.height
}

pub fn at_point(x: f64, y: f64) -> Display {
    let all = list();
    all.iter().find(|d| d.contains(x, y)).cloned().unwrap_or_else(|| all[0].clone())
}

pub fn under_mouse() -> Display {
    let (x, y) = crate::macos::mouse_location();
    at_point(x, y)
}

pub fn by_id(id: u32) -> Option<Display> {
    list().into_iter().find(|d| d.id == id)
}

pub fn by_index(index: usize) -> Option<Display> {
    list().into_iter().find(|d| d.index == index)
}
