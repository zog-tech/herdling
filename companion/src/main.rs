use std::path::PathBuf;

use anyhow::{bail, Result};
use tokio::io::BufReader;
use std::time::Duration;
use herdlingd::{config, enroll, install, rpc, serve, update};

fn herdr_socket(home: &std::path::Path) -> PathBuf {
    match std::env::var_os("HERDR_SOCKET") {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => home.join(".config/herdr/herdr.sock"),
    }
}

async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    match signal(SignalKind::terminate()) {
        Ok(mut term) => tokio::select! {
            _ = term.recv() => {}
            _ = tokio::signal::ctrl_c() => {}
        },
        Err(_) => {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}

/// Rows of the large digits printed by `herdlingd pair`.
const DIGITS: [[&str; 5]; 10] = [
    ["███", "█ █", "█ █", "█ █", "███"],
    ["  █", "  █", "  █", "  █", "  █"],
    ["███", "  █", "███", "█  ", "███"],
    ["███", "  █", "███", "  █", "███"],
    ["█ █", "█ █", "███", "  █", "  █"],
    ["███", "█  ", "███", "  █", "███"],
    ["███", "█  ", "███", "█ █", "███"],
    ["███", "  █", "  █", "  █", "  █"],
    ["███", "█ █", "███", "█ █", "███"],
    ["███", "█ █", "███", "  █", "███"],
];

fn big_digits(code: &str) -> String {
    let glyphs: Vec<&[&str; 5]> = code.bytes().filter(u8::is_ascii_digit).map(|b| &DIGITS[usize::from(b - b'0')]).collect();
    (0..5)
        .map(|row| format!("  {}\n", glyphs.iter().map(|g| g[row]).collect::<Vec<_>>().join("  ")))
        .collect()
}

/// First non-loopback IPv4 address of this machine.
fn lan_ipv4() -> Option<std::net::Ipv4Addr> {
    if_addrs::get_if_addrs().ok()?.into_iter().find_map(|i| match i.ip() {
        std::net::IpAddr::V4(a) if !a.is_loopback() => Some(a),
        _ => None,
    })
}

/// `herdlingd pair`: opens the pairing window, shows the code, the host key fingerprint and
/// the QR code, then stays until the window is used or closes and prints each device it paired.
async fn pair_cmd(home: &std::path::Path) -> Result<()> {
    use herdlingd::pair;
    let config_path = config::default_path(home);
    let cfg = config::load(&config_path)?;
    let before = cfg.devices.clone();
    let cfg_dir = config_path.parent().map(PathBuf::from).unwrap_or_else(|| home.join(".config/herdling"));
    let now = || std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let code = pair::open_window(&cfg_dir, now())?;
    let fingerprint = pair::host_fingerprint(&pair::default_host_key_paths());

    let local = std::net::SocketAddr::from(([127, 0, 0, 1], cfg.pair_port));
    if std::net::TcpStream::connect_timeout(&local, Duration::from_secs(1)).is_err() {
        eprintln!("warning: serve is not running — run herdlingd install");
    }

    println!("Pairing code (valid for {} minutes):\n", pair::WINDOW.as_secs() / 60);
    print!("{}", big_digits(&code));
    println!("\n  {code}\n");
    match &fingerprint {
        Some(fp) => println!("Host key: {fp}\nIf you type the code by hand, check that Herdling shows this key.\n"),
        None => eprintln!("warning: no host key found, so Herdling cannot check the host key while pairing\n"),
    }
    match lan_ipv4() {
        Some(ip) => {
            let url = pair::pair_url(&ip.to_string(), cfg.pair_port, &code, fingerprint.as_deref());
            println!("Host: {ip}  port: {}\n", cfg.pair_port);
            let qr = qrcode::QrCode::new(url.as_bytes())?;
            println!("{}", qr.render::<qrcode::render::unicode::Dense1x2>().quiet_zone(true).build());
            println!("Scan the code in Herdling, or add the host by hand and type the code.");
        }
        None => println!("No LAN IPv4 address found. Add the host by hand in Herdling and type the code."),
    }
    println!("Waiting for the phone. Press Ctrl-C to close the window.");

    let mut tick = tokio::time::interval(Duration::from_millis(500));
    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = tokio::signal::ctrl_c() => {
                pair::close_window(&cfg_dir);
                println!("\nPairing window closed.");
                return Ok(());
            }
        }
        match pair::window_state(&cfg_dir, now()) {
            pair::WindowState::Open(_) => continue,
            pair::WindowState::Expired => {
                pair::close_window(&cfg_dir);
                println!("Pairing window closed with no new device.");
                return Ok(());
            }
            pair::WindowState::Closed => {
                // Give serve a moment to save the device after it took the window.
                tokio::time::sleep(Duration::from_millis(500)).await;
                let after = config::load(&config_path)?.devices;
                let paired = pair::new_devices(&before, &after);
                if paired.is_empty() {
                    println!("Pairing window closed with no new device.");
                }
                for (name, fp) in paired {
                    println!("Paired {name}  key {fp}");
                }
                return Ok(());
            }
        }
    }
}

/// `herdlingd update`: the same as the `update.check` and `update.apply` methods.
async fn update_cmd(ctx: update::UpdateCtx, usage: &str) -> Result<()> {
    let (mut check, mut allow_downgrade, mut version) = (false, false, None);
    let mut args = std::env::args().skip(2);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--check" => check = true,
            "--allow-downgrade" => allow_downgrade = true,
            "--version" => version = Some(args.next().ok_or_else(|| anyhow::anyhow!("--version needs a value\n{usage}"))?),
            other => bail!("unknown option {other}\n{usage}"),
        }
    }
    let fail = |e: herdlingd::types::RpcError| anyhow::anyhow!("{} ({})", e.message, e.code);
    if check {
        let r = update::check(&ctx, version.as_deref()).await.map_err(fail)?;
        if r.update_available {
            println!("Update available: {} -> {}  (run: herdlingd update)", r.current, r.latest);
        } else {
            println!("herdlingd {} is up to date (latest: {}).", r.current, r.latest);
        }
        if !r.notes.trim().is_empty() {
            println!("\n{}", r.notes.trim());
        }
        return Ok(());
    }
    println!("Updating {} ...", ctx.exe.display());
    let r = update::apply(&ctx, version.as_deref(), allow_downgrade).await.map_err(fail)?;
    if r.status == "up_to_date" {
        println!("herdlingd {} is up to date.", r.from);
    } else {
        println!("Updated herdlingd {} -> {}.", r.from, r.to);
        if r.service_restarted {
            println!("The service restarted with the new version.");
        } else {
            println!("The service did not restart. Run: herdlingd install");
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    const USAGE: &str = "usage: herdlingd rpc | serve | pair | enroll | install [--dry-run] | version\n       \
                         herdlingd update [--check] [--version X.Y.Z] [--allow-downgrade]";
    if matches!(std::env::args().nth(1).as_deref(), Some("version" | "--version" | "-V")) {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    // A help flag never runs a subcommand: `install --help` once installed the service.
    if std::env::args().skip(1).any(|a| a == "-h" || a == "--help" || a == "help") {
        println!("{USAGE}");
        return Ok(());
    }
    if std::env::args().nth(1).as_deref() == Some("install") {
        if let Some(a) = std::env::args().skip(2).find(|a| a != "--dry-run") {
            bail!("unknown option {a}\n{USAGE}");
        }
    }
    match std::env::args().nth(1).as_deref() {
        Some("rpc") => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let mut ctx = rpc::Ctx::new(herdr_socket(&home), home.clone());
            if let Ok(exe) = std::env::current_exe().and_then(|p| p.canonicalize()) {
                ctx.update = Some(update::UpdateCtx::new(home, exe));
            }
            ctx.sys = Some(std::sync::Arc::new(herdlingd::boot::SystemRunner));
            let result = rpc::run(BufReader::new(tokio::io::stdin()), tokio::io::stdout(), ctx).await;
            // Exit at once: tokio reads stdin on a blocking thread that cannot be
            // cancelled, so a normal runtime shutdown would wait for the next input line.
            std::process::exit(match result {
                Ok(()) => 0,
                Err(e) => {
                    eprintln!("herdlingd: {e:#}");
                    1
                }
            })
        }
        Some("serve") => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let ctx = serve::ServeCtx {
                herdr_socket: herdr_socket(&home),
                config_path: config::default_path(&home),
                home,
                push_url: "https://exp.host/--/api/v2/push/send".into(),
                debounce: Duration::from_secs(5),
                pair_port: None,
                host_key_paths: herdlingd::pair::default_host_key_paths(),
                exe: std::env::current_exe()?.canonicalize()?,
            };
            serve::run(ctx, shutdown_signal()).await
        }
        Some("pair") => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            pair_cmd(&home).await
        }
        Some("enroll") => {
            // Reads one JSON request on stdin, prints one JSON line. The restricted rpc key
            // cannot reach this: sshd forces `herdlingd rpc` for it and ignores the client command.
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let exe = std::env::current_exe().and_then(|p| p.canonicalize()).unwrap_or_default();
            let (line, code) = enroll::run(std::io::stdin(), &enroll::EnrollCtx::new(&home, exe));
            println!("{line}");
            std::process::exit(code)
        }
        Some("install") => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let dry_run = std::env::args().skip(2).any(|a| a == "--dry-run");
            let os = if cfg!(target_os = "macos") { install::Os::Macos } else { install::Os::Linux };
            let report = install::install(&install::InstallOpts { home, exe: std::env::current_exe()?.canonicalize()?, os, dry_run })?;
            println!("Binary: {}\nUnit:   {}", report.bin.display(), report.unit_path.display());
            for c in &report.commands {
                println!("{} {}", if dry_run { "Would run:" } else { "Ran:" }, c.join(" "));
            }
            for s in &report.next_steps {
                println!("Next: {s}");
            }
            Ok(())
        }
        Some("update") => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            update_cmd(update::UpdateCtx::new(home, std::env::current_exe()?.canonicalize()?), USAGE).await
        }
        _ => bail!("{USAGE}"),
    }
}
