pub fn canonical_commit_message(message: &str) -> String {
    let normalized = message.replace("\r\n", "\n").replace('\r', "\n");
    format!("{}\n", normalized.trim_end_matches('\n'))
}

#[cfg(test)]
mod tests {
    use super::canonical_commit_message;

    #[test]
    fn normalizes_trailing_newlines() {
        assert_eq!(canonical_commit_message("hello\r\n\n"), "hello\n");
    }
}
