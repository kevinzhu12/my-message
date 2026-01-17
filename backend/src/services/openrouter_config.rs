use crate::context_db::ContextDb;
use crate::openrouter::DEFAULT_MODEL;

pub fn get_openrouter_api_key(
    _context_db: &ContextDb,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    Ok(std::env::var("OPENROUTER_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty()))
}

pub fn get_openrouter_model(
    _context_db: &ContextDb,
) -> Result<String, Box<dyn std::error::Error>> {
    Ok(DEFAULT_MODEL.to_string())
}
