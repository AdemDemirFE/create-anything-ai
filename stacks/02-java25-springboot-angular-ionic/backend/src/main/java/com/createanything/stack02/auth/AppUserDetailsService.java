package com.createanything.stack02.auth;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

/**
 * Loads users by email for Spring Security. The lookup email is normalized
 * (lowercased + trimmed) BEFORE the query, mirroring the registration write
 * path — normalize-before-unique holds for reads and writes alike.
 */
@Service
public class AppUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    public AppUserDetailsService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    /**
     * Canonical email normalization for the whole stack: trim surrounding
     * whitespace, then lowercase. Applied before every unique check, insert
     * and lookup.
     */
    public static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase();
    }

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        return userRepository.findByEmail(normalize(email))
                .<UserDetails>map(user -> org.springframework.security.core.userdetails.User
                        .withUsername(user.getEmail())
                        .password(user.getPasswordHash())
                        .roles("USER")
                        .build())
                .orElseThrow(() -> new UsernameNotFoundException("No account with that email."));
    }
}
