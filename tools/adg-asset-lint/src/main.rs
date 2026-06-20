// ADG asset-lint pixel reader.
//
// Pure, deterministic MEASUREMENT only: it decodes a raster image and reports the
// numbers the policy needs (format, dimensions, whole-image mean luminance, and the
// per-edge mean luminance and mean alpha of a border strip). All thresholds, the
// allowed-format set, the pass/fail decision, and the exit-code policy live in the
// Node orchestrator (scripts/asset-lint.mjs), which reads the assetLint control from
// the single policy source. Keeping policy out of here means the Rust binary can be
// rebuilt or swapped without touching governance behaviour.
//
//   adg-asset-lint [--background <color|transparent>] [--edge-strip <px>] <files...>
//
// Output: one JSON array on stdout, one object per input file:
//   {"file","format","width","height","meanLuminance",
//    "edges":{top,bottom,left,right}, "edgeAlpha":{top,bottom,left,right}}
// or {"file","error":"..."} for a file that cannot be decoded. Exit 0 always (a decode
// failure is reported per-file, not as a process error); the Node gate owns enforcement.

use std::env;
use std::process::exit;

use image::GenericImageView;

struct Config {
    background: (f64, f64, f64), // linearised? no -- sRGB component means, matching ImageMagick %[fx:mean]
    transparent_bg: bool,
    edge_strip: u32,
}

fn parse_args() -> (Config, Vec<String>) {
    let mut background = (1.0, 1.0, 1.0); // white
    let mut transparent_bg = false;
    let mut edge_strip: u32 = 2;
    let mut files = Vec::new();
    let mut it = env::args().skip(1).peekable();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--background" => {
                let v = it.next().unwrap_or_default();
                if v == "transparent" || v == "none" {
                    transparent_bg = true;
                    background = (1.0, 1.0, 1.0);
                } else {
                    background = named_color(&v);
                }
            }
            "--edge-strip" => {
                edge_strip = it.next().and_then(|v| v.parse().ok()).unwrap_or(2).max(1);
            }
            "--version" => {
                println!("adg-asset-lint {}", env!("CARGO_PKG_VERSION"));
                exit(0);
            }
            other => files.push(other.to_string()),
        }
    }
    (
        Config {
            background,
            transparent_bg,
            edge_strip,
        },
        files,
    )
}

fn named_color(name: &str) -> (f64, f64, f64) {
    match name.to_lowercase().as_str() {
        "white" => (1.0, 1.0, 1.0),
        "black" => (0.0, 0.0, 0.0),
        _ => {
            // #rrggbb
            if let Some(hex) = name.strip_prefix('#') {
                if hex.len() == 6 {
                    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255);
                    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255);
                    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(255);
                    return (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
                }
            }
            (1.0, 1.0, 1.0)
        }
    }
}

// Mean luminance over a rectangle, compositing each pixel over the background so a
// transparent area reads as the background colour. Luminance is the simple channel mean
// (R+G+B)/3 in [0,1], matching ImageMagick's %[fx:mean] on a flattened image, so the
// thresholds carried over from the draft keep their meaning.
fn region_mean_luma(
    img: &image::RgbaImage,
    bg: (f64, f64, f64),
    x0: u32,
    y0: u32,
    w: u32,
    h: u32,
) -> f64 {
    let mut sum = 0.0;
    let mut n = 0u64;
    for y in y0..(y0 + h) {
        for x in x0..(x0 + w) {
            let p = img.get_pixel(x, y).0;
            let a = p[3] as f64 / 255.0;
            let r = (p[0] as f64 / 255.0) * a + bg.0 * (1.0 - a);
            let g = (p[1] as f64 / 255.0) * a + bg.1 * (1.0 - a);
            let b = (p[2] as f64 / 255.0) * a + bg.2 * (1.0 - a);
            sum += (r + g + b) / 3.0;
            n += 1;
        }
    }
    if n == 0 {
        1.0
    } else {
        sum / n as f64
    }
}

fn region_mean_alpha(img: &image::RgbaImage, x0: u32, y0: u32, w: u32, h: u32) -> f64 {
    let mut sum = 0.0;
    let mut n = 0u64;
    for y in y0..(y0 + h) {
        for x in x0..(x0 + w) {
            sum += img.get_pixel(x, y).0[3] as f64 / 255.0;
            n += 1;
        }
    }
    if n == 0 {
        0.0
    } else {
        sum / n as f64
    }
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn num(v: f64) -> String {
    // Stable, deterministic formatting to 6 dp (the Node side rounds again).
    format!("{:.6}", v)
}

fn measure(cfg: &Config, file: &str) -> String {
    let reader = match image::ImageReader::open(file).and_then(|r| r.with_guessed_format()) {
        Ok(r) => r,
        Err(e) => return format!("{{\"file\":\"{}\",\"error\":\"open: {}\"}}", json_escape(file), json_escape(&e.to_string())),
    };
    let format = reader
        .format()
        .map(|f| format!("{:?}", f).to_uppercase())
        .unwrap_or_else(|| "UNKNOWN".to_string());
    let img = match reader.decode() {
        Ok(i) => i,
        Err(e) => return format!("{{\"file\":\"{}\",\"format\":\"{}\",\"error\":\"decode: {}\"}}", json_escape(file), format, json_escape(&e.to_string())),
    };
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return format!("{{\"file\":\"{}\",\"format\":\"{}\",\"error\":\"zero dimension\"}}", json_escape(file), format);
    }
    let rgba = img.to_rgba8();
    let bg = cfg.background;
    let s = cfg.edge_strip.min(w).min(h);
    let mean = region_mean_luma(&rgba, bg, 0, 0, w, h);
    // Edge strips.
    let top = region_mean_luma(&rgba, bg, 0, 0, w, s);
    let bottom = region_mean_luma(&rgba, bg, 0, h - s, w, s);
    let left = region_mean_luma(&rgba, bg, 0, 0, s, h);
    let right = region_mean_luma(&rgba, bg, w - s, 0, s, h);
    let (at, ab, al, ar) = if cfg.transparent_bg {
        (
            region_mean_alpha(&rgba, 0, 0, w, s),
            region_mean_alpha(&rgba, 0, h - s, w, s),
            region_mean_alpha(&rgba, 0, 0, s, h),
            region_mean_alpha(&rgba, w - s, 0, s, h),
        )
    } else {
        (0.0, 0.0, 0.0, 0.0)
    };
    format!(
        "{{\"file\":\"{}\",\"format\":\"{}\",\"width\":{},\"height\":{},\"meanLuminance\":{},\"edges\":{{\"top\":{},\"bottom\":{},\"left\":{},\"right\":{}}},\"edgeAlpha\":{{\"top\":{},\"bottom\":{},\"left\":{},\"right\":{}}}}}",
        json_escape(file), format, w, h, num(mean),
        num(top), num(bottom), num(left), num(right),
        num(at), num(ab), num(al), num(ar),
    )
}

fn main() {
    let (cfg, files) = parse_args();
    let objects: Vec<String> = files.iter().map(|f| measure(&cfg, f)).collect();
    println!("[{}]", objects.join(","));
}
