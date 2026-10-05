import { startDesign } from '../app.js';
import { mountNavigation } from '../shared/navigation.js';

window.name = 'spenic-design';
mountNavigation('design');
startDesign();
