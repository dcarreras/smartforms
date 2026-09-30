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

    describe('clusterCheckboxGroups', () => {
        it('clusters mutually exclusive checkboxes and assigns groupKey, groupType, and exclusiveGroup without changing type', async () => {
            const { clusterCheckboxGroups } = await import('./module-loader.js');
            const fields = [
                { id: 'f1', type: 'checkBox', name: 'yes', x: 100, y: 200, width: 14, height: 14, page: 1 },
                { id: 'f2', type: 'checkBox', name: 'no', x: 130, y: 200, width: 14, height: 14, page: 1 }
            ];

            const clustered = clusterCheckboxGroups(fields, [], new Set());
            assert.equal(clustered.length, 2);
            assert.equal(clustered[0].type, 'checkBox');
            assert.equal(clustered[1].type, 'checkBox');
            assert.equal(clustered[0].groupKey, 'yes_no_choice');
            assert.equal(clustered[1].groupKey, 'yes_no_choice');
            assert.equal(clustered[0].groupType, 'yes_no');
            assert.equal(clustered[1].groupType, 'yes_no');
            assert.equal(clustered[0].exclusiveGroup, true);
            assert.equal(clustered[1].exclusiveGroup, true);
        });

        it('clusters vertical enum choices into an enum checkbox group', async () => {
            const { clusterCheckboxGroups } = await import('./module-loader.js');
            const fields = [
                { id: 'f1', type: 'checkBox', name: 'single', x: 100, y: 200, width: 14, height: 14, page: 1 },
                { id: 'f2', type: 'checkBox', name: 'married', x: 100, y: 220, width: 14, height: 14, page: 1 }
            ];

            const clustered = clusterCheckboxGroups(fields, [], new Set());
            assert.equal(clustered.length, 2);
            assert.equal(clustered[0].type, 'checkBox');
            assert.equal(clustered[0].groupKey, 'marital_status');
            assert.equal(clustered[0].groupType, 'enum');
            assert.equal(clustered[0].exclusiveGroup, true);
        });
    });

    describe('Checkbox Group State Semantics', () => {
        it('automatically unchecks paired partner when Yes/No checkbox is toggled to true', async () => {
            const { toggleCheckboxField } = await import('./module-loader.js');
            const yesBox = { id: 'cb_yes', type: 'checkBox', groupKey: 'grp_agree', groupType: 'yes_no', defaultChecked: false, checked: false, page: 1 };
            const noBox = { id: 'cb_no', type: 'checkBox', groupKey: 'grp_agree', groupType: 'yes_no', defaultChecked: true, checked: true, page: 1 };
            const allFields = [yesBox, noBox];

            // Toggling "Yes" to true should auto-uncheck "No"
            toggleCheckboxField(yesBox, true, allFields);
            assert.equal(yesBox.defaultChecked, true);
            assert.equal(yesBox.checked, true);
            assert.equal(noBox.defaultChecked, false);
            assert.equal(noBox.checked, false);

            // Toggling "No" to true should auto-uncheck "Yes"
            toggleCheckboxField(noBox, true, allFields);
            assert.equal(noBox.defaultChecked, true);
            assert.equal(noBox.checked, true);
            assert.equal(yesBox.defaultChecked, false);
            assert.equal(yesBox.checked, false);
        });

        it('automatically unchecks other enum partners in multi-option enum set', async () => {
            const { toggleCheckboxField } = await import('./module-loader.js');
            const opt1 = { id: 'opt1', type: 'checkBox', groupKey: 'grp_status', groupType: 'enum', defaultChecked: true, checked: true, page: 1 };
            const opt2 = { id: 'opt2', type: 'checkBox', groupKey: 'grp_status', groupType: 'enum', defaultChecked: false, checked: false, page: 1 };
            const opt3 = { id: 'opt3', type: 'checkBox', groupKey: 'grp_status', groupType: 'enum', defaultChecked: false, checked: false, page: 1 };
            const allFields = [opt1, opt2, opt3];

            toggleCheckboxField(opt3, true, allFields);
            assert.equal(opt3.defaultChecked, true);
            assert.equal(opt1.defaultChecked, false);
            assert.equal(opt2.defaultChecked, false);
        });

        it('does not uncheck siblings when exclusiveGroup is false or checkboxGroupMulti is true', async () => {
            const { toggleCheckboxField } = await import('./module-loader.js');
            const cb1 = { id: 'cb1', type: 'checkBox', groupKey: 'grp_multi', exclusiveGroup: false, defaultChecked: true, checked: true, page: 1 };
            const cb2 = { id: 'cb2', type: 'checkBox', groupKey: 'grp_multi', exclusiveGroup: false, defaultChecked: false, checked: false, page: 1 };
            const allFields = [cb1, cb2];

            toggleCheckboxField(cb2, true, allFields);
            assert.equal(cb2.defaultChecked, true);
            assert.equal(cb1.defaultChecked, true); // Still true!
        });

        it('strictly preserves checkboxes in other unrelated groups', async () => {
            const { toggleCheckboxField } = await import('./module-loader.js');
            const grp1_a = { id: 'g1a', type: 'checkBox', groupKey: 'grp1', defaultChecked: false, checked: false, page: 1 };
            const grp1_b = { id: 'g1b', type: 'checkBox', groupKey: 'grp1', defaultChecked: true, checked: true, page: 1 };
            const grp2_a = { id: 'g2a', type: 'checkBox', groupKey: 'grp2', defaultChecked: true, checked: true, page: 1 };
            const allFields = [grp1_a, grp1_b, grp2_a];

            toggleCheckboxField(grp1_a, true, allFields);
            assert.equal(grp1_a.defaultChecked, true);
            assert.equal(grp1_b.defaultChecked, false);
            assert.equal(grp2_a.defaultChecked, true); // Unrelated group preserved!
        });
    });
});

