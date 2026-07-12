use ort::session::Session;
use tokenizers::Tokenizer;
use std::sync::OnceLock;
use crate::pieces::PieceError;

pub const MODEL_BYTES: &[u8] = include_bytes!("../model.onnx");
pub const TOKENIZER_BYTES: &[u8] = include_bytes!("../tokenizer.json");

pub const DEFAULT_CHAR_LIMIT: usize = 2000;
pub const DEFAULT_TOKEN_LIMIT: usize = 800;

static TOKENIZER: OnceLock<Tokenizer> = OnceLock::new();

/// Returns a reference to the global embedding tokenizer.
pub fn get_tokenizer() -> &'static Tokenizer {
    TOKENIZER.get_or_init(|| {
        let mut tokenizer = Tokenizer::from_bytes(TOKENIZER_BYTES).expect("Failed to load tokenizer from bytes");
        tokenizer.with_truncation(None).expect("Failed to disable truncation");
        tokenizer
    })
}

/// Checks if the input text passes both fail-fast character limit and precise token limit validation.
///
/// * `text` - The natural language text to validate.
/// * `char_limit` - Optional custom character limit (falls back to DEFAULT_CHAR_LIMIT).
/// * `token_limit` - Optional custom token limit (falls back to DEFAULT_TOKEN_LIMIT).
pub fn validate_limits(
    text: &str,
    char_limit: Option<usize>,
    token_limit: Option<usize>,
) -> Result<usize, PieceError> {
    let max_chars = char_limit.unwrap_or(DEFAULT_CHAR_LIMIT);
    let max_tokens = token_limit.unwrap_or(DEFAULT_TOKEN_LIMIT);

    // 1. Fail-fast character limit check
    let char_count = text.chars().count();
    if char_count > max_chars {
        return Err(PieceError::CharLimitExceeded(max_chars, char_count));
    }

    // 2. Precise token limit check
    let tokenizer = get_tokenizer();
    let encoding = tokenizer.encode(text, true)
        .map_err(|e| PieceError::Tokenizer(e.to_string()))?;
    let token_count = encoding.get_ids().len();

    if token_count > max_tokens {
        return Err(PieceError::TokenLimitExceeded(max_tokens, token_count));
    }

    Ok(token_count)
}

/// Initializes the embedding model session.
pub fn init_model() -> Result<Session, ort::Error> {
    Session::builder()?
        .commit_from_memory(MODEL_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_model() {
        let session = init_model().expect("Failed to initialize model session");
        assert!(!session.inputs().is_empty(), "Model should have at least one input node");
        assert!(!session.outputs().is_empty(), "Model should have at least one output node");
    }

    #[test]
    fn test_get_tokenizer() {
        let tokenizer = get_tokenizer();
        let encoding = tokenizer.encode("Hello world from vibeNote!", true).unwrap();
        assert!(!encoding.get_ids().is_empty());
    }

    #[test]
    fn test_validate_limits_success() {
        let text = "This is a clean, compliant text.";
        let tokens = validate_limits(text, None, None).unwrap();
        assert!(tokens > 0);
    }

    #[test]
    fn test_validate_limits_char_exceeded() {
        let text = "a".repeat(10);
        let err = validate_limits(&text, Some(5), Some(10)).unwrap_err();
        assert!(matches!(err, PieceError::CharLimitExceeded(5, 10)));
    }

    #[test]
    fn test_validate_limits_token_exceeded() {
        // "Hello world from vibeNote!" is about 6 tokens
        let text = "Hello world from vibeNote!";
        let err = validate_limits(text, Some(100), Some(2)).unwrap_err();
        assert!(matches!(err, PieceError::TokenLimitExceeded(2, _)));
    }
}
