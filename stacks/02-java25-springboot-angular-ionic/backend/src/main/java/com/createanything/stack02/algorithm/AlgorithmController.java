package com.createanything.stack02.algorithm;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.createanything.stack02.web.ApiResponse;
import com.createanything.stack02.web.BadRequestException;
import com.createanything.stack02.web.RequestIdFilter;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Screen 4 — the algorithm workbench. Fixed catalog + bounded input; the
 * measured {@code execution_ms} is reported separately from the theoretical
 * Big-O {@code complexity}. Realtime push (SSE/WebSocket) is FORBIDDEN in
 * this stack: clients re-run or poll; nothing streams.
 */
@RestController
@RequestMapping("/api/v1/algorithm")
public class AlgorithmController {

    public record RunRequest(
            @NotBlank @Size(max = AlgorithmEngine.MAX_INPUT_LENGTH) String input) {
    }

    public record CatalogEntry(String id, String label, String complexity, String explanation) {
    }

    private final AlgorithmCatalogService catalogService;

    public AlgorithmController(AlgorithmCatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @GetMapping
    public ApiResponse<List<CatalogEntry>> catalog(HttpServletRequest request) {
        List<CatalogEntry> entries = catalogService.entries().stream()
                .map(algorithm -> new CatalogEntry(algorithm.getId(), algorithm.getLabel(),
                        algorithm.getComplexity(), algorithm.getExplanation()))
                .toList();
        return ApiResponse.ok(entries, RequestIdFilter.currentId(request));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<AlgorithmEngine.Result>> run(
            @Valid @RequestBody RunRequest body,
            @org.springframework.web.bind.annotation.RequestParam("algorithm") String algorithmId,
            HttpServletRequest request) {
        AlgorithmCatalog algorithm = AlgorithmCatalog.byId(algorithmId);
        if (algorithm == null) {
            throw new BadRequestException("UNKNOWN_ALGORITHM",
                    "Unknown algorithm. Fetch the catalog for valid ids.");
        }
        AlgorithmEngine.Result result;
        try {
            result = AlgorithmEngine.run(algorithm, body.input());
        } catch (IllegalArgumentException ex) {
            throw new BadRequestException("VALIDATION_ERROR", ex.getMessage());
        }
        return ResponseEntity.status(HttpStatus.OK)
                .body(ApiResponse.ok(result, RequestIdFilter.currentId(request)));
    }
}
