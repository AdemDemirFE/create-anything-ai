package com.createanything.stack02.algorithm;

import java.util.List;

import org.springframework.stereotype.Service;

/**
 * Exposes the fixed algorithm catalog to controllers. A tiny seam so tests
 * and future profiles can vary the catalog without touching HTTP code.
 */
@Service
public class AlgorithmCatalogService {

    public List<AlgorithmCatalog> entries() {
        return List.of(AlgorithmCatalog.values());
    }
}
