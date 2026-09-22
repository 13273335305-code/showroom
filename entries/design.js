import { startDesign } from '../app.js';
import { mountNavigation } from '../shared/navigation.js';
import { requireAuth } from '../shared/auth.js';

window.name = 'spenic-design';
await requireAuth({ feature: 'design' });
mountNavigation('design');
startDesign();
