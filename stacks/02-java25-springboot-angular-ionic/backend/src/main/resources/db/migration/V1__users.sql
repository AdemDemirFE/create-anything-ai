-- Reference Stack 02 schema (Flyway baseline).
-- Email uniqueness is enforced HERE at the persistence layer, after the
-- application normalizes (lowercases + trims) the address — the unique index
-- sees only canonical values, so case variants cannot create duplicate
-- accounts (normalize-before-unique contract).
CREATE TABLE users (
    id            UUID PRIMARY KEY,
    email         VARCHAR(254) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_users_email UNIQUE (email)
);
