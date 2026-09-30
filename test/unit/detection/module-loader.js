// test/unit/detection/module-loader.js
// Loads modular detection pipeline for unit tests

import './setup-env.js';

export * from '../../../js/engines/detection/index.js';
export { isOverlapping } from '../../../js/utils/geometry.js';
export { state, toggleCheckboxField, getCheckboxGroupKey, getCheckboxGroupFields, setCheckboxGroup } from '../../../js/core/state.js';
