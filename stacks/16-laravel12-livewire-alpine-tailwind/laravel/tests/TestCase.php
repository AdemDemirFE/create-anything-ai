<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Vite asset injection is a deploy artifact (npm run build) and is
        // irrelevant to what the feature suite asserts. Without this, every
        // test that renders a Blade/Livewire page would require a prior build.
        $this->withoutVite();
    }
}
