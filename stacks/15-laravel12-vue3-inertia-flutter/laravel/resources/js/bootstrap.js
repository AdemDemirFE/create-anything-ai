import axios from 'axios';
import { router } from '@inertiajs/vue3';

window.axios = axios;
window.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

// Inertia visit failures (429 etc.) are surfaced through the shared
// flash/status prop by the pages themselves; nothing global needed here.

router.on('error', () => {});
