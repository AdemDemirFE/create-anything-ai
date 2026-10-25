package com.createanything.stack02.auth;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

/**
 * Application user. Passwords are only ever stored as BCrypt hashes; the raw
 * password is never persisted or logged.
 *
 * <p>Email uniqueness is enforced at the persistence layer (unique column)
 * AFTER normalization: every write path lowercases and trims the address
 * BEFORE it reaches this table, so MixedCase@Example.com and
 * mixedcase@example.com collide on the same row instead of creating two
 * accounts (normalize-before-unique contract).
 */
@Entity
@Table(name = "users")
public class User {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    /** Normalized (lowercased, trimmed) email. Unique at the persistence layer. */
    @Column(nullable = false, unique = true, length = 254)
    private String email;

    /** BCrypt hash. Never selected into API responses. */
    @Column(nullable = false, length = 100)
    private String passwordHash;

    @Column(nullable = false)
    private Instant createdAt;

    protected User() {
        // JPA
    }

    public User(String email, String passwordHash) {
        this.email = email;
        this.passwordHash = passwordHash;
    }

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public UUID getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
