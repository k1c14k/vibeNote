use ort::session::Session;

pub const MODEL_BYTES: &[u8] = include_bytes!("../model.onnx");

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
        
        // Verify input/output details of the loaded model
        assert!(!session.inputs().is_empty(), "Model should have at least one input node");
        assert!(!session.outputs().is_empty(), "Model should have at least one output node");

        println!("Input name: {}", session.inputs()[0].name());
        println!("Output name: {}", session.outputs()[0].name());
    }
}
