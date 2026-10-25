package com.createanything.stack02.web;

import java.io.IOException;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Resolves the correlation id ONCE per request and applies it to the
 * response: {@code X-Request-Id} is set before the handler runs, controllers
 * read the same value via {@link #currentId(HttpServletRequest)} for the
 * envelope {@code meta.request_id}, and the exception handler echoes it too —
 * header and body can never diverge.
 *
 * <p>Policy: an incoming {@code X-Request-Id} is reused only when it fully
 * matches {@link ApiResponse#REQUEST_ID_PATTERN} (1..64 chars of
 * [A-Za-z0-9-]). Absent, empty, longer, or otherwise non-conforming values
 * are discarded and replaced by a server-generated opaque UUID; client input
 * is validated before reuse, never reflected verbatim.
 */
@Component
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    /** Request attribute the resolved id is stored under. */
    public static final String ATTRIBUTE = RequestIdFilter.class.getName() + ".requestId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String incoming = request.getHeader(HEADER);
        String resolved = incoming != null && incoming.matches(ApiResponse.REQUEST_ID_PATTERN)
                ? incoming
                : UUID.randomUUID().toString();
        request.setAttribute(ATTRIBUTE, resolved);
        response.setHeader(HEADER, resolved);
        filterChain.doFilter(request, response);
    }

    /** The correlation id resolved for this request (header or generated). */
    public static String currentId(HttpServletRequest request) {
        Object value = request.getAttribute(ATTRIBUTE);
        return value instanceof String id ? id : UUID.randomUUID().toString();
    }
}
