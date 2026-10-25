/**
 * Type declaration for the Ziggy `route()` helper.
 *
 * The real helper is injected at runtime by the `@routes` directive in
 * resources/views/app.blade.php (Ziggy renders the route list + a typed
 * route() function into every page). This declaration keeps `tsc --noEmit`
 * honest without pulling Ziggy's generated types into the build.
 */
declare function route(
    name: string,
    params?: Record<string, unknown> | number | string | undefined,
): string;

declare module 'ziggy-js' {
    // Ziggy's types ship with the package; this keeps imports resolvable for
    // tooling without a build step. The runtime global comes from @routes.
}
