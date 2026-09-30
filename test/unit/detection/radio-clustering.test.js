import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clusterRadioGroups } from './module-loader.js';

describe('radio-clustering', () => {
    describe('clusterRadioGroups', () => {
        it('returns input fields unmodified if fewer than 2 fields exist', () => {
            const single = [{ type: 'checkBox', name: 'opt1', x: 50, y: 100, width: 14, height: 14 }];
            assert.deepEqual(clusterRadioGroups(single), single);
            assert.deepEqual(clusterRadioGroups([]), []);
        });

        it('clusters horizontal baseline checkboxes into a unified radioGroup matching MUTUAL_EXCLUSIVE_SETS (yes/no)', () => {
            const fields = [
                { id: 'f1', type: 'checkBox', name: 'yes', x: 100, y: 200, width: 14, height: 14, page: 1 },
                { id: 'f2', type: 'checkBox', name: 'no', x: 130, y: 200, width: 14, height: 14, page: 1 } // gap = 16 (6 <= gap <= 70)
            ];

            const clustered = clusterRadioGroups(fields, [], new Set());
            assert.equal(clustered.length, 2);
            assert.equal(clustered[0].type, 'radioGroup');
            assert.equal(clustered[1].type, 'radioGroup');
            assert.equal(clustered[0].radioGroup, 'yes_no_choice');
            assert.equal(clustered[1].radioGroup, 'yes_no_choice');
            assert.equal(clustered[0].exportValue, 'yes');
            assert.equal(clustered[1].exportValue, 'no');
        });

        it('clusters vertical column checkboxes into a unified radioGroup (e.g. tax classification or status)', () => {
            const fields = [
                { id: 'f1', type: 'checkBox', name: 'single', x: 100, y: 200, width: 14, height: 14, page: 1 },
                { id: 'f2', type: 'checkBox', name: 'married', x: 100, y: 220, width: 14, height: 14, page: 1 }, // vGap = 6 (4 <= vGap <= 32)
                { id: 'f3', type: 'checkBox', name: 'divorced', x: 100, y: 240, width: 14, height: 14, page: 1 }
            ];

            const clustered = clusterRadioGroups(fields, [], new Set());
            assert.equal(clustered.length, 3);
            assert.equal(clustered[0].type, 'radioGroup');
            assert.equal(clustered[1].type, 'radioGroup');
            assert.equal(clustered[2].type, 'radioGroup');
            assert.equal(clustered[0].radioGroup, 'marital_status');
            assert.equal(clustered[1].radioGroup, 'marital_status');
            assert.equal(clustered[2].radioGroup, 'marital_status');
            assert.equal(clustered[0].exportValue, 'single');
            assert.equal(clustered[1].exportValue, 'married');
            assert.equal(clustered[2].exportValue, 'divorced');
        });

        it('does not cluster checkboxes when gaps exceed thresholds (gap > 70 for horizontal, vGap > 32 for vertical)', () => {
            const farFields = [
                { id: 'f1', type: 'checkBox', name: 'yes', x: 100, y: 200, width: 14, height: 14, page: 1 },
                { id: 'f2', type: 'checkBox', name: 'no', x: 220, y: 200, width: 14, height: 14, page: 1 } // gap = 106 > 70
            ];

            const clustered = clusterRadioGroups(farFields, [], new Set());
            assert.equal(clustered.length, 2);
            assert.equal(clustered[0].type, 'checkBox');
            assert.equal(clustered[1].type, 'checkBox');
        });

        it('does not cluster comb character boxes into radio groups', () => {
            const combFields = [
                { id: 'c1', type: 'checkBox', isComb: true, name: 'c1', x: 100, y: 200, width: 14, height: 14, page: 1 },
                { id: 'c2', type: 'checkBox', isComb: true, name: 'c2', x: 116, y: 200, width: 14, height: 14, page: 1 }
            ];

            const clustered = clusterRadioGroups(combFields, [], new Set());
            assert.equal(clustered.length, 2);
            assert.equal(clustered[0].type, 'checkBox');
        });
    });
});
