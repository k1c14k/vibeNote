use crate::pieces::PieceError;
use ndarray::Array2;
use ort::session::Session;
use std::sync::OnceLock;
use tokenizers::Tokenizer;

pub const MODEL_BYTES: &[u8] = include_bytes!("../model.onnx");
pub const TOKENIZER_BYTES: &[u8] = include_bytes!("../tokenizer.json");

pub const DEFAULT_CHAR_LIMIT: usize = 2000;
pub const DEFAULT_TOKEN_LIMIT: usize = 800;

static TOKENIZER: OnceLock<Tokenizer> = OnceLock::new();

/// Returns a reference to the global embedding tokenizer.
pub fn get_tokenizer() -> &'static Tokenizer {
    TOKENIZER.get_or_init(|| {
        let mut tokenizer =
            Tokenizer::from_bytes(TOKENIZER_BYTES).expect("Failed to load tokenizer from bytes");
        tokenizer
            .with_truncation(None)
            .expect("Failed to disable truncation");
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
    let encoding = tokenizer
        .encode(text, true)
        .map_err(|e| PieceError::Tokenizer(e.to_string()))?;
    let token_count = encoding.get_ids().len();

    if token_count > max_tokens {
        return Err(PieceError::TokenLimitExceeded(max_tokens, token_count));
    }

    Ok(token_count)
}

/// Initializes the embedding model session.
pub fn init_model() -> Result<Session, ort::Error> {
    Session::builder()?.commit_from_memory(MODEL_BYTES)
}

/// Generates a 384-dimensional vector embedding for the given input text using the ONNX model.
pub fn generate_embedding(session: &mut Session, text: &str) -> Result<Vec<f32>, ort::Error> {
    let tokenizer = get_tokenizer();
    let encoding = tokenizer
        .encode(text, true)
        .map_err(|e| ort::Error::new(format!("Tokenizer error: {}", e)))?;

    let ids = encoding.get_ids();
    let mask = encoding.get_attention_mask();
    let type_ids = encoding.get_type_ids();
    let seq_len = ids.len();

    // Convert encoding outputs into int64 arrays of shape [1, seq_len]
    let input_ids = Array2::from_shape_vec((1, seq_len), ids.iter().map(|&x| x as i64).collect())
        .map_err(|e| ort::Error::new(format!("Failed to create ndarray: {:?}", e)))?;

    let attention_mask =
        Array2::from_shape_vec((1, seq_len), mask.iter().map(|&x| x as i64).collect())
            .map_err(|e| ort::Error::new(format!("Failed to create ndarray: {:?}", e)))?;

    let token_type_ids =
        Array2::from_shape_vec((1, seq_len), type_ids.iter().map(|&x| x as i64).collect())
            .map_err(|e| ort::Error::new(format!("Failed to create ndarray: {:?}", e)))?;

    let input_ids_val = ort::value::Value::from_array(input_ids)?;
    let attention_mask_val = ort::value::Value::from_array(attention_mask)?;
    let token_type_ids_val = ort::value::Value::from_array(token_type_ids)?;

    // Execute session run
    let outputs = session.run(ort::inputs![
        "input_ids" => &input_ids_val,
        "attention_mask" => &attention_mask_val,
        "token_type_ids" => &token_type_ids_val,
    ])?;

    // Extract output shape and data
    let (shape, data) = outputs["last_hidden_state"].try_extract_tensor::<f32>()?;

    let hidden_dim = shape[2] as usize;

    // Perform weighted mean pooling
    let mut sum = vec![0.0f32; hidden_dim];
    let mut mask_sum = 0.0f32;

    for i in 0..seq_len {
        let m = mask[i] as f32;
        mask_sum += m;
        for d in 0..hidden_dim {
            sum[d] += data[i * hidden_dim + d] * m;
        }
    }

    if mask_sum > 0.0 {
        for d in 0..hidden_dim {
            sum[d] /= mask_sum;
        }
    }

    // L2 normalization
    let norm = sum.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for d in 0..hidden_dim {
            sum[d] /= norm;
        }
    }

    Ok(sum)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_model() {
        let session = init_model().expect("Failed to initialize model session");
        assert!(
            !session.inputs().is_empty(),
            "Model should have at least one input node"
        );
        assert!(
            !session.outputs().is_empty(),
            "Model should have at least one output node"
        );
    }

    #[test]
    fn test_generate_embedding() {
        let mut session = init_model().unwrap();
        let embedding =
            generate_embedding(&mut session, "Hello from vibeNote embedding engine!").unwrap();
        assert_eq!(embedding.len(), 384);

        // Ensure L2 normalized (norm is close to 1.0)
        let norm = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-4);
    }

    #[test]
    fn test_get_tokenizer() {
        let tokenizer = get_tokenizer();
        let encoding = tokenizer
            .encode("Hello world from vibeNote!", true)
            .unwrap();
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
