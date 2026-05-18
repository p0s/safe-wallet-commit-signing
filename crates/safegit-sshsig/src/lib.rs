pub fn is_armored_ssh_signature(value: &str) -> bool {
    value.starts_with("-----BEGIN SSH SIGNATURE-----\n")
        && value.trim_end().ends_with("-----END SSH SIGNATURE-----")
}

#[cfg(test)]
mod tests {
    use super::is_armored_ssh_signature;

    #[test]
    fn detects_armored_signature() {
        assert!(is_armored_ssh_signature(
            "-----BEGIN SSH SIGNATURE-----\nabc\n-----END SSH SIGNATURE-----\n"
        ));
    }
}
