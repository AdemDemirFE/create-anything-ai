package com.createanything.stack02.auth;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * User persistence. All lookups are by NORMALIZED email; callers must pass
 * {@link AppUserDetailsService#normalize} output, never raw client input.
 */
public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);
}
