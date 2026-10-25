import '../css/app.css';

import { createInertiaApp } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';

createInertiaApp({
    title: (title) => `${title} — ${import.meta.env.VITE_APP_NAME ?? 'Stack 17'}`,
    resolve: (name) =>
        resolvePageComponent(
            `./pages/${name}.tsx`,
            import.meta.glob(['./pages/**/*.tsx', '!./pages/**/*.test.tsx']),
        ),
    setup({ el, App, props }) {
        const root: ReactNode = <App {...props} />;
        createRoot(el).render(root);
    },
    progress: { color: '#4f46e5' },
});
