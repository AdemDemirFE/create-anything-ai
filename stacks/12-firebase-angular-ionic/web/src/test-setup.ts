// Angular TestBed bootstrap for zone.js-based tests (Angular 19 + Ionic 8).
// We intentionally do NOT use @analogjs/vitest-angular's runtime setup: its
// setup-testbed imports `provideZonelessChangeDetection`, an Angular 20+ API.
// Zone.js must be loaded before the TestBed is used, and '@angular/compiler'
// must be present for JIT-compiled Ionic/Angular templates.
import 'zone.js'
import '@angular/compiler'

import { TestBed } from '@angular/core/testing'
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing'

TestBed.initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
  { teardown: { destroyAfterEach: true } },
)
