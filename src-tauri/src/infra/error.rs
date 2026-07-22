use sea_orm::DbErr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    SeaOrm(#[from] DbErr),
}

impl From<DbError> for String {
    fn from(value: DbError) -> Self {
        value.to_string()
    }
}

pub type DbResult<T> = Result<T, DbError>;

impl DbError {
    pub fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }
}
