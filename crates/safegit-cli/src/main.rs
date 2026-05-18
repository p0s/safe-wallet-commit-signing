use safegit_frost::{
    ThresholdPolicy, sign_with_key_packages, trusted_dealer_keygen, trusted_dealer_sign_demo,
    trusted_dealer_sign_demo_with_seed,
};
use std::{env, fs, process};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn main() {
    if let Err(error) = run(env::args().skip(1).collect()) {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        print_help();
        return Ok(());
    }
    if args.get(0).map(String::as_str) == Some("frost")
        && args.get(1).map(String::as_str) == Some("sign-demo")
    {
        return frost_sign_demo(&args[2..]);
    }
    if args.get(0).map(String::as_str) == Some("frost")
        && args.get(1).map(String::as_str) == Some("keygen")
    {
        return frost_keygen(&args[2..]);
    }
    if args.get(0).map(String::as_str) == Some("frost")
        && args.get(1).map(String::as_str) == Some("sign")
    {
        return frost_sign(&args[2..]);
    }
    Err(format!("unsupported command: {}", args.join(" ")))
}

fn frost_keygen(args: &[String]) -> Result<(), String> {
    let threshold = parse_u8_flag(args, "--threshold")?;
    let participants = parse_u8_flag(args, "--participants")?;
    let out_dir = required_flag(args, "--out-dir")?;
    let policy = ThresholdPolicy {
        required: threshold,
        total: participants,
    };
    let ceremony = trusted_dealer_keygen(policy)?;

    fs::create_dir_all(out_dir)
        .map_err(|error| format!("failed to create ceremony directory: {error}"))?;
    write_private_file(
        &format!("{out_dir}/public_key_package.hex"),
        &format!("{}\n", hex(&ceremony.public_key_package_bytes)),
    )?;

    let mut key_package_files = Vec::new();
    for (index, key_package) in ceremony.key_package_bytes.iter().enumerate() {
        let filename = format!("signer-{}.key_package.hex", index + 1);
        write_private_file(
            &format!("{out_dir}/{filename}"),
            &format!("{}\n", hex(key_package)),
        )?;
        key_package_files.push(filename);
    }

    let ceremony_json = format!(
        concat!(
            "{{\n",
            "  \"scheme\": \"FROST-Ed25519\",\n",
            "  \"mode\": \"trusted-dealer-local-key-package\",\n",
            "  \"threshold\": {},\n",
            "  \"participants\": {},\n",
            "  \"verifyingKeyHex\": \"{}\",\n",
            "  \"publicKeyPackageFile\": \"public_key_package.hex\",\n",
            "  \"keyPackageFiles\": [{}]\n",
            "}}\n"
        ),
        threshold,
        participants,
        hex(&ceremony.verifying_key_bytes),
        key_package_files
            .iter()
            .map(|filename| format!("\"{filename}\""))
            .collect::<Vec<_>>()
            .join(", ")
    );
    write_private_file(&format!("{out_dir}/ceremony.json"), &ceremony_json)?;
    println!(
        "{}",
        format!(
            concat!(
                "{{\n",
                "  \"ok\": true,\n",
                "  \"scheme\": \"FROST-Ed25519\",\n",
                "  \"mode\": \"trusted-dealer-local-key-package\",\n",
                "  \"threshold\": {},\n",
                "  \"participants\": {},\n",
                "  \"verifyingKeyHex\": \"{}\",\n",
                "  \"outDir\": \"{}\"\n",
                "}}"
            ),
            threshold,
            participants,
            hex(&ceremony.verifying_key_bytes),
            out_dir
        )
    );
    Ok(())
}

fn frost_sign_demo(args: &[String]) -> Result<(), String> {
    let threshold = parse_u8_flag(args, "--threshold")?;
    let participants = parse_u8_flag(args, "--participants")?;
    let message_path = required_flag(args, "--message-file")?;
    let message =
        fs::read(message_path).map_err(|error| format!("failed to read message: {error}"))?;
    let policy = ThresholdPolicy {
        required: threshold,
        total: participants,
    };
    let proof = if let Ok(seed_hex) = flag(args, "--demo-seed-hex") {
        trusted_dealer_sign_demo_with_seed(&message, policy, parse_seed_hex(seed_hex)?)?
    } else {
        trusted_dealer_sign_demo(&message, policy)?
    };
    let json = format!(
        concat!(
            "{{\n",
            "  \"scheme\": \"FROST-Ed25519\",\n",
            "  \"mode\": \"trusted-dealer-local-e2e\",\n",
            "  \"threshold\": {},\n",
            "  \"participants\": {},\n",
            "  \"verifyingKeyHex\": \"{}\",\n",
            "  \"signatureHex\": \"{}\"\n",
            "}}\n"
        ),
        threshold,
        participants,
        hex(&proof.verifying_key_bytes),
        hex(&proof.signature_bytes)
    );
    if let Ok(out) = flag(args, "--out") {
        fs::write(out, json).map_err(|error| format!("failed to write proof: {error}"))?;
    } else {
        print!("{json}");
    }
    Ok(())
}

fn frost_sign(args: &[String]) -> Result<(), String> {
    let message_path = required_flag(args, "--message-file")?;
    let public_key_package_path = required_flag(args, "--public-key-package-file")?;
    let key_package_paths = flags(args, "--key-package-file");
    if key_package_paths.is_empty() {
        return Err("missing --key-package-file".to_owned());
    }
    let threshold = optional_u8_flag(args, "--threshold")?.unwrap_or(key_package_paths.len() as u8);
    let participants = optional_u8_flag(args, "--participants")?.unwrap_or(threshold);
    ThresholdPolicy {
        required: threshold,
        total: participants,
    }
    .validate()
    .map_err(str::to_owned)?;
    if key_package_paths.len() < usize::from(threshold) {
        return Err(format!(
            "at least {threshold} --key-package-file values are required"
        ));
    }

    let message =
        fs::read(message_path).map_err(|error| format!("failed to read message: {error}"))?;
    let public_key_package_bytes = read_hex_file(public_key_package_path).map_err(|error| {
        format!("failed to read public key package from {public_key_package_path}: {error}")
    })?;
    let key_package_bytes = key_package_paths
        .iter()
        .map(|path| {
            read_hex_file(path)
                .map_err(|error| format!("failed to read key package from {path}: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let proof = sign_with_key_packages(&message, &public_key_package_bytes, &key_package_bytes)?;
    let json = format!(
        concat!(
            "{{\n",
            "  \"scheme\": \"FROST-Ed25519\",\n",
            "  \"mode\": \"trusted-dealer-local-key-package\",\n",
            "  \"threshold\": {},\n",
            "  \"participants\": {},\n",
            "  \"verifyingKeyHex\": \"{}\",\n",
            "  \"signatureHex\": \"{}\"\n",
            "}}\n"
        ),
        threshold,
        participants,
        hex(&proof.verifying_key_bytes),
        hex(&proof.signature_bytes)
    );
    if let Ok(out) = flag(args, "--out") {
        write_private_file(out, &json)?;
    } else {
        print!("{json}");
    }
    Ok(())
}

fn flag<'a>(args: &'a [String], name: &str) -> Result<&'a str, String> {
    args.iter()
        .position(|candidate| candidate == name)
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
        .ok_or_else(|| format!("missing {name}"))
}

fn required_flag<'a>(args: &'a [String], name: &str) -> Result<&'a str, String> {
    flag(args, name)
}

fn flags<'a>(args: &'a [String], name: &str) -> Vec<&'a str> {
    args.iter()
        .enumerate()
        .filter_map(|(index, candidate)| {
            if candidate == name {
                args.get(index + 1).map(String::as_str)
            } else {
                None
            }
        })
        .collect()
}

fn parse_u8_flag(args: &[String], name: &str) -> Result<u8, String> {
    required_flag(args, name)?
        .parse::<u8>()
        .map_err(|_| format!("{name} must be a positive integer"))
}

fn optional_u8_flag(args: &[String], name: &str) -> Result<Option<u8>, String> {
    match flag(args, name) {
        Ok(value) => value
            .parse::<u8>()
            .map(Some)
            .map_err(|_| format!("{name} must be a positive integer")),
        Err(_) => Ok(None),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parse_seed_hex(seed_hex: &str) -> Result<[u8; 32], String> {
    if seed_hex.len() != 64 {
        return Err(
            "--demo-seed-hex must be exactly 32 bytes encoded as 64 hex characters".to_owned(),
        );
    }
    let mut seed = [0u8; 32];
    for (index, byte) in seed.iter_mut().enumerate() {
        let start = index * 2;
        *byte = u8::from_str_radix(&seed_hex[start..start + 2], 16).map_err(|_| {
            "--demo-seed-hex must contain only lowercase or uppercase hex".to_owned()
        })?;
    }
    Ok(seed)
}

fn read_hex_file(path: &str) -> Result<Vec<u8>, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    decode_hex(content.trim())
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 {
        return Err("hex input must have an even number of characters".to_owned());
    }
    let mut bytes = Vec::with_capacity(value.len() / 2);
    for index in (0..value.len()).step_by(2) {
        bytes.push(
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| "hex input contains a non-hex character".to_owned())?,
        );
    }
    Ok(bytes)
}

fn write_private_file(path: &str, content: &str) -> Result<(), String> {
    fs::write(path, content).map_err(|error| format!("failed to write {path}: {error}"))?;
    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("failed to set private permissions on {path}: {error}"))?;
    }
    Ok(())
}

fn print_help() {
    println!(concat!(
        "safegit-rs\n\nCommands:\n",
        "  frost keygen --threshold 2 --participants 3 --out-dir .secrets/frost-ceremony\n",
        "  frost sign --message-file ./payload.bin --public-key-package-file public_key_package.hex --key-package-file signer-1.key_package.hex --key-package-file signer-2.key_package.hex [--threshold 2] [--participants 3] [--out frost-proof.json]\n",
        "  frost sign-demo --threshold 2 --participants 3 --message-file ./payload.bin [--demo-seed-hex <64 hex chars>] [--out frost-proof.json]"
    ));
}
