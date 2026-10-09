//! File name pattern expansion ("Screenshot X {YYYY}-{MM}-{DD} at {HH}.{mm}.{ss}").

use chrono::{DateTime, Datelike, Local, Timelike, Utc};
use rand::distr::Alphanumeric;
use rand::Rng;

pub struct NameContext<'a> {
    pub app_name: &'a str,
    pub window_title: &'a str,
    pub counter: u32,
    pub kind: &'a str,
}

pub const TOKENS: &[(&str, &str)] = &[
    ("{YYYY}", "Year"),
    ("{YY}", "Year (short)"),
    ("{MM}", "Month (numeric)"),
    ("{MMMM}", "Month (name)"),
    ("{MMM}", "Month (short name)"),
    ("{DD}", "Day"),
    ("{dddd}", "Day of week"),
    ("{ddd}", "Day of week (short)"),
    ("{HH}", "Hour (24h)"),
    ("{hh}", "Hour (12h)"),
    ("{mm}", "Minutes"),
    ("{ss}", "Seconds"),
    ("{A}", "AM/PM"),
    ("{app}", "App name"),
    ("{window}", "Window title"),
    ("{random}", "Random characters"),
    ("{counter}", "Auto-increment number"),
    ("{type}", "Capture type"),
];

const MONTHS: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
    "December",
];
const DAYS: [&str; 7] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

struct Parts {
    year: i32,
    month: u32,
    day: u32,
    weekday: usize,
    hour: u32,
    minute: u32,
    second: u32,
}

fn parts_local(d: DateTime<Local>) -> Parts {
    Parts {
        year: d.year(),
        month: d.month(),
        day: d.day(),
        weekday: d.weekday().num_days_from_monday() as usize,
        hour: d.hour(),
        minute: d.minute(),
        second: d.second(),
    }
}

fn parts_utc(d: DateTime<Utc>) -> Parts {
    Parts {
        year: d.year(),
        month: d.month(),
        day: d.day(),
        weekday: d.weekday().num_days_from_monday() as usize,
        hour: d.hour(),
        minute: d.minute(),
        second: d.second(),
    }
}

pub fn expand(pattern: &str, ctx: &NameContext, utc: bool, remove_illegal: bool) -> String {
    let p = if utc { parts_utc(Utc::now()) } else { parts_local(Local::now()) };
    let h12 = if p.hour % 12 == 0 { 12 } else { p.hour % 12 };
    let random: String = rand::rng().sample_iter(&Alphanumeric).take(6).map(char::from).collect();
    let mut s = pattern.to_string();
    let reps: Vec<(&str, String)> = vec![
        ("{YYYY}", format!("{:04}", p.year)),
        ("{YY}", format!("{:02}", p.year % 100)),
        ("{MMMM}", MONTHS[(p.month - 1) as usize].to_string()),
        ("{MMM}", MONTHS[(p.month - 1) as usize][..3].to_string()),
        ("{MM}", format!("{:02}", p.month)),
        ("{DD}", format!("{:02}", p.day)),
        ("{dddd}", DAYS[p.weekday].to_string()),
        ("{ddd}", DAYS[p.weekday][..3].to_string()),
        ("{HH}", format!("{:02}", p.hour)),
        ("{hh}", format!("{:02}", h12)),
        ("{mm}", format!("{:02}", p.minute)),
        ("{ss}", format!("{:02}", p.second)),
        ("{A}", if p.hour < 12 { "AM".into() } else { "PM".into() }),
        ("{app}", ctx.app_name.to_string()),
        ("{window}", ctx.window_title.to_string()),
        ("{random}", random),
        ("{counter}", ctx.counter.to_string()),
        ("{type}", ctx.kind.to_string()),
    ];
    for (k, v) in reps {
        s = s.replace(k, &v);
    }
    sanitize(&s, remove_illegal)
}

pub fn sanitize(name: &str, strict: bool) -> String {
    let mut out: String = name
        .chars()
        .map(|c| match c {
            '/' | ':' => '-',
            c if strict && "\\?%*|\"<>".contains(c) => '-',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    if strict {
        out = out.chars().filter(|c| c.is_ascii() || c.is_alphanumeric()).collect();
    }
    let trimmed = out.trim().trim_start_matches('.').to_string();
    if trimmed.is_empty() {
        "Screenshot X".into()
    } else {
        trimmed.chars().take(200).collect()
    }
}

pub fn uses_counter(pattern: &str) -> bool {
    pattern.contains("{counter}")
}
