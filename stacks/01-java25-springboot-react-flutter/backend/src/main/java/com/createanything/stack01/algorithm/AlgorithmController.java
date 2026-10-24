package com.createanything.stack01.algorithm;

import java.security.Principal;
import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.createanything.stack01.web.ApiResponse;
import com.createanything.stack01.web.BadRequestException;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * Algorithm workbench (four-screen journey D). Requires authentication.
 *
 * Security model: the client may only pick an algorithm id from the fixed
 * catalog and supply bounded text input. User code is never executed; there is
 * no eval/reflection/classloading of request content anywhere on this path.
 */
@RestController
@RequestMapping("/api/v1/algorithm")
public class AlgorithmController {

    public record RunRequest(@NotBlank String algorithm, @NotBlank String input) {
    }

    public record AlgorithmInfo(String id, String name, String complexity, String explanation) {

        static AlgorithmInfo from(AlgorithmCatalog a) {
            return new AlgorithmInfo(a.getId(), a.getDisplayName(), a.getComplexity(),
                    a.getExplanation());
        }
    }

    @GetMapping
    public ApiResponse<List<AlgorithmInfo>> list(Principal principal) {
        return ApiResponse.ok(AlgorithmCatalog.all().stream().map(AlgorithmInfo::from).toList());
    }

    @PostMapping("/run")
    public ApiResponse<AlgorithmEngine.Result> run(@Valid @RequestBody RunRequest request) {
        AlgorithmCatalog algorithm = AlgorithmCatalog.byId(request.algorithm());
        if (algorithm == null) {
            throw new BadRequestException("UNKNOWN_ALGORITHM",
                    "Unknown algorithm. Use GET /api/v1/algorithm to list the available ones.");
        }
        if (request.input().length() > AlgorithmEngine.MAX_INPUT_LENGTH) {
            throw new BadRequestException("INPUT_TOO_LARGE",
                    "Input exceeds the maximum length of " + AlgorithmEngine.MAX_INPUT_LENGTH
                            + " characters.");
        }
        try {
            AlgorithmEngine.Result result = AlgorithmEngine.run(algorithm, request.input());
            return ApiResponse.ok(result);
        } catch (IllegalArgumentException ex) {
            throw new BadRequestException("VALIDATION_ERROR", ex.getMessage());
        }
    }
}
