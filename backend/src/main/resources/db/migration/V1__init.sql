-- Reference Stack 01 initial schema (Flyway V1).
-- Users: email is the login identity; password_hash is a BCrypt hash.

CREATE TABLE users (
    id            UUID PRIMARY KEY,
    email         VARCHAR(254) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Unique email at the persistence layer (PRODUCT_REQUIREMENTS.md section 6).
CREATE UNIQUE INDEX ux_users_email ON users (email);
