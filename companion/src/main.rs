use std::path::PathBuf;

use anyhow::{bail, Result};
use tokio::io::BufReader;
use std::time::Duration;
use herdlingd::{config, enroll, install, proxy, rpc, serve, update};

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
                let paired = pair::added_devices(&before, &after);
                let checked = pair::take_checked(&cfg_dir);
                if paired.is_empty() {
                    println!("Pairing window closed with no new device.");
                }
                for d in paired {
                    // Pairing v2: the phone proved the code over this key, so no compare is needed.
                    if checked.as_ref().is_some_and(|(id, key)| *id == d.id && *key == d.public_key) {
                        println!("Paired {}  key {} (checked with the code)", d.name, d.fingerprint);
                    } else {
                        confirm_device(home, &config_path, &d).await?;
                    }
                }
                return Ok(());
            }
        }
    }
}

/// How long `herdlingd pair` waits for the answer to "Keep this phone?".
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);

/// Shows the key fingerprint of a phone that just paired with pairing v1 (an older app). On a
/// terminal, asks the user to keep it: v1 sends the pairing code over plain HTTP, so a device on
/// the LAN that reads the code can pair its own key. The phone shows the fingerprint of its own key, and the user compares the two.
/// No, the end of input, Ctrl-C or no answer in `CONFIRM_TIMEOUT` removes the device again.
async fn confirm_device(home: &std::path::Path, config_path: &std::path::Path, d: &herdlingd::pair::Added) -> Result<()> {
    use herdlingd::pair;
    use std::io::Write;
    println!("Paired {}  key {}", d.name, d.fingerprint);
    // SAFETY: isatty has no preconditions.
    if unsafe { libc::isatty(0) } != 1 {
        return Ok(());
    }
    println!("\nDevice name: {}\nPhone key:   {}", d.name, d.fingerprint);
    println!("Newer versions of Herdling show the phone key after pairing.");
    print!("Keep this phone? Check that the phone shows the same key. [y/N] ");
    std::io::stdout().flush()?;
    let read = tokio::task::spawn_blocking(|| {
        let mut line = String::new();
        match std::io::stdin().read_line(&mut line) {
            Ok(n) if n > 0 => Some(line),
            _ => None,
        }
    });
    let answer = tokio::select! {
        r = tokio::time::timeout(CONFIRM_TIMEOUT, read) => r.ok().and_then(Result::ok).flatten(),
        _ = tokio::signal::ctrl_c() => None,
    };
    if pair::keep_answer(answer.as_deref()) {
        println!("Kept {}.", d.name);
        return Ok(());
    }
    let keys = home.join(".ssh/authorized_keys");
    match pair::unpair(&keys, config_path, &d.id, Some(&d.public_key))? {
        pair::Unpair::Removed { .. } => println!("\nRemoved {}. The phone cannot connect with this key.", d.name),
        _ => println!("\nThe device changed after pairing. Nothing removed. Check it with: herdlingd devices"),
    }
    Ok(())
}

/// `herdlingd unpair <device_id>`: removes a paired device, for example a lost phone.
fn unpair_cmd(home: &std::path::Path, id: &str) -> Result<()> {
    use herdlingd::pair;
    match pair::unpair(&home.join(".ssh/authorized_keys"), &config::default_path(home), id, None)? {
        pair::Unpair::Removed { removed_keys, .. } => {
            println!("Removed device {id} and {removed_keys} key line(s).");
            Ok(())
        }
        _ => bail!("no paired device has the id {id}. Run herdlingd devices to see the ids."),
    }
}

/// The proxy mode of the browser preview: checks the grant, then copies bytes between the SSH
/// channel (stdin and stdout) and the dev server on loopback. See `herdlingd::proxy`.
async fn proxy_cmd(home: &std::path::Path, port: u16, grant: &str) -> ! {
    let reserved = config::load(&config::default_path(home)).unwrap_or_default().pair_port;
    let ctx = proxy::ProxyCtx::new(home, reserved);
    let code = match proxy::run(tokio::io::stdin(), tokio::io::stdout(), port, grant, &ctx).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("herdlingd proxy: {e}");
            2
        }
    };
    // Exit at once: tokio reads stdin on a blocking thread that cannot be cancelled.
    std::process::exit(code)
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
                         herdlingd devices | unpair <device_id>\n       \
                         herdlingd update [--check] [--version X.Y.Z] [--allow-downgrade]\n       \
                         herdlingd proxy <port> <grant>";
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
            // The phone key forces `herdlingd rpc`. sshd puts the command that the app asked for
            // in SSH_ORIGINAL_COMMAND. Only an exact proxy request changes the mode.
            if let Some((port, grant)) = std::env::var("SSH_ORIGINAL_COMMAND").ok().as_deref().and_then(proxy::parse_original_command) {
                proxy_cmd(&home, port, &grant).await;
            }
            let mut ctx = rpc::Ctx::new(herdr_socket(&home), home.clone());
            ctx.core_socket = herdlingd::core::endpoint::from_env(&home);
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
                core_socket: herdlingd::core::endpoint::from_env(&home),
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
            let result = pair_cmd(&home).await;
            // Exit at once: a stdin read that timed out stays on a blocking thread.
            if let Err(e) = &result {
                eprintln!("Error: {e:#}");
            }
            std::process::exit(i32::from(result.is_err()))
        }
        Some("devices") => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            print!("{}", herdlingd::pair::format_devices(&config::load(&config::default_path(&home))?.devices));
            Ok(())
        }
        Some("unpair") => {
            let args: Vec<String> = std::env::args().skip(2).collect();
            let [id] = args.as_slice() else { bail!("{USAGE}") };
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            unpair_cmd(&home, id)
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
        Some("proxy") => {
            // A host added by hand without a forced command runs the app's command in the shell.
            let args: Vec<String> = std::env::args().skip(2).collect();
            let [port, grant] = args.as_slice() else { bail!("{USAGE}") };
            let line = format!("herdlingd proxy {port} {grant}");
            let Some((port, grant)) = proxy::parse_original_command(&line) else {
                bail!("herdlingd proxy: the port must be 1-65535 and the grant 32 hex characters")
            };
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            proxy_cmd(&home, port, &grant).await
        }
        _ => bail!("{USAGE}"),
    }
}
