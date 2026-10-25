package com.createanything.stack02;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Reference Stack 02 backend entrypoint: Java 25 + Spring Boot 4.1.
 * Serves the JSON API under {@code /api/v1/**}; the built Angular web bundle
 * is expected to be served separately (its own prefix), per the stack rule
 * "API and web live on separate prefixes".
 */
@SpringBootApplication
public class Stack02Application {

    public static void main(String[] args) {
        SpringApplication.run(Stack02Application.class, args);
    }
}
