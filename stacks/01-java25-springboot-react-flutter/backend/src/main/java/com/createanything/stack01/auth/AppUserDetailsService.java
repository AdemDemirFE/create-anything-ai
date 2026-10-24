package com.createanything.stack01.auth;

import java.util.List;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Bridges JPA users to Spring Security. Email is the username.
 */
@Service
public class AppUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    public AppUserDetailsService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        return userRepository.findByEmail(normalize(email))
                .<UserDetails>map(u -> new org.springframework.security.core.userdetails.User(
                        u.getEmail(), u.getPasswordHash(), List.of()))
                .orElseThrow(() -> new UsernameNotFoundException("No account for that email."));
    }

    public static String normalize(String email) {
        return email == null ? null : email.trim().toLowerCase();
    }
}
