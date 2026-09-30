import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSemanticProps, isUniversalStaticText, GENERIC_PATTERNS } from './module-loader.js';

describe('semantic-resolver', () => {
    describe('resolveSemanticProps', () => {
        it('covers distinct pattern branches across GENERIC_PATTERNS', () => {
            const cases = [
                // Dates
                { label: 'Payment Due Date', expectedId: 'due_date', expectedType: 'dateField', format: 'date' },
                { label: 'Date of Birth', expectedId: 'dob', expectedType: 'dateField', format: 'date' },
                { label: 'Expiration Date', expectedId: 'expiration_date', expectedType: 'dateField', format: 'date' },
                { label: 'Generic Date', expectedId: 'date', expectedType: 'dateField', format: 'date' },

                // Names
                { label: 'First Name', expectedId: 'first_name', expectedType: 'textField', format: 'text' },
                { label: 'Last Name', expectedId: 'last_name', expectedType: 'textField', format: 'text' },
                { label: 'Full Name', expectedId: 'full_name', expectedType: 'textField', format: 'text' },
                { label: 'Middle Initial', expectedId: 'middle_initial', expectedType: 'textField', format: 'text' },

                // Contact & Telecom
                { label: 'Email Address', expectedId: 'email', expectedType: 'textField', format: 'email' },
                { label: 'Phone Number', expectedId: 'phone', expectedType: 'textField', format: 'phone' },
                { label: 'Mobile Phone', expectedId: 'phone', expectedType: 'textField', format: 'phone' },
                { label: 'Fax Number', expectedId: 'phone', expectedType: 'textField', format: 'phone' },

                // Addresses
                { label: 'Street Address', expectedId: 'street_address', expectedType: 'textField', format: 'text' },
                { label: 'City', expectedId: 'city', expectedType: 'textField', format: 'text' },
                { label: 'State / Province', expectedId: 'state', expectedType: 'textField', format: 'text' },
                { label: 'Zip Code', expectedId: 'zip_code', expectedType: 'textField', format: 'number' },
                { label: 'Country', expectedId: 'country', expectedType: 'textField', format: 'text' },

                // Government & Financial Identifiers
                { label: 'Social Security Number', expectedId: 'ssn', expectedType: 'textField', format: 'number' },
                { label: 'Invoice Number', expectedId: 'invoice_number', expectedType: 'textField', format: 'number' },
                { label: 'Bank Account Number', expectedId: 'account_number', expectedType: 'textField', format: 'number' },
                { label: 'Routing Transit Number', expectedId: 'routing_number', expectedType: 'textField', format: 'number' },

                // Financial Amounts & Quantities
                { label: 'Subtotal Amount', expectedId: 'subtotal', expectedType: 'textField', format: 'currency' },
                { label: 'Sales Tax', expectedId: 'tax', expectedType: 'textField', format: 'currency' },
                { label: 'Grand Total', expectedId: 'total', expectedType: 'textField', format: 'currency' },
                { label: 'Total Amount', expectedId: 'amount', expectedType: 'textField', format: 'currency' },
                { label: 'Unit Price', expectedId: 'unit_price', expectedType: 'textField', format: 'currency' },
                { label: 'Quantity Ordered', expectedId: 'quantity', expectedType: 'textField', format: 'number' },

                // Organization & Roles
                { label: 'Company Organization', expectedId: 'organization', expectedType: 'textField', format: 'text' },
                { label: 'Job Title', expectedId: 'job_title', expectedType: 'textField', format: 'text' },

                // Signature & Legal
                { label: 'Authorized Signature', expectedId: 'signature', expectedType: 'signature', format: 'text' },

                // Narrative / Multiline
                { label: 'Additional Comments', expectedId: 'comments', expectedType: 'textField', format: 'text', multiline: true }
            ];

            for (const c of cases) {
                const res = resolveSemanticProps(c.label, 'textField', new Set());
                assert.equal(res.name, c.expectedId, `Failed ID for label: "${c.label}"`);
                assert.equal(res.type, c.expectedType, `Failed Type for label: "${c.label}"`);
                assert.equal(res.dataFormat, c.format, `Failed DataFormat for label: "${c.label}"`);
                if (c.multiline) {
                    assert.equal(res.multiline, true, `Expected multiline true for "${c.label}"`);
                }
            }
        });

        it('handles duplicate due_date vs generic date ordering precedence', () => {
            // Due date has priority 2, which gives it a higher score than generic date
            const res = resolveSemanticProps('Payment Due Date', 'textField', new Set());
            assert.equal(res.name, 'due_date');
            assert.equal(res.type, 'dateField');
        });

        it('handles non-Latin-script fallback without collapsing to empty string', () => {
            // Devanagari "नाम"
            const devRes = resolveSemanticProps('नाम', 'textField', new Set());
            assert.ok(devRes.name.length > 0);
            assert.equal(devRes.name, 'नम');

            // CJK "姓名" (Full Name)
            const cjkRes = resolveSemanticProps('姓名', 'textField', new Set());
            assert.equal(cjkRes.name, '姓名');

            // Arabic "الاسم" (The Name)
            const arRes = resolveSemanticProps('الاسم', 'textField', new Set());
            assert.equal(arRes.name, 'الاسم');
        });

        it('handles usedNames collisions deterministically', () => {
            const usedNames = new Set(['first_name']);
            const res1 = resolveSemanticProps('First Name', 'textField', usedNames);
            assert.equal(res1.name, 'first_name_2');
            assert.ok(usedNames.has('first_name_2'));

            const res2 = resolveSemanticProps('First Name', 'textField', usedNames);
            assert.equal(res2.name, 'first_name_3');
            assert.ok(usedNames.has('first_name_3'));
        });
    });

    describe('isUniversalStaticText', () => {
        it('identifies known static text banners, headings, disclaimers, and metadata (known-true)', () => {
            const knownTrue = [
                'OMB No. 1545-0074',
                'Form 1040',
                'Cat. No. 11320B',
                'Rev. December 2024',
                'IRS Use Only',
                'For Official Use Only',
                'Section 1: General Information',
                'Part I: Taxpayer Identification',
                'Schedule A - Itemized Deductions',
                'Caution: Do not submit this document',
                'Note: Attach all statements',
                'Instructions: Please read carefully',
                'Are you a citizen of the United States?',
                '1. Are you currently employed in this state?',
                'Mail to: Department of Revenue',
                'Please print clearly in ink',
                'www.irs.gov/form1040',
                '(Please print clearly in ink)',
                '(Check all that apply)',
                '1',
                '42',
                '$',
                '€',
                '------------------------------------',
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                'By signing below, I certify under penalty of perjury that all answers given above are true and complete.'
            ];

            for (const text of knownTrue) {
                assert.equal(isUniversalStaticText(text), true, `Expected "${text}" to be static text`);
            }
        });

        it('identifies valid form field prompts and exceptions (known-false)', () => {
            const knownFalse = [
                'First Name',
                'Date of Birth',
                'Authorized Signature',
                'Social Security Number',
                'Street Address',
                'Item Description',
                'Item 1 Description', // Explicit exception in regex
                'Item Name',
                'Item No.',
                'Unit Price',
                'Sick?', // Short 1-word inquiry (<2 words and <=15 chars) valid as toggle/column prompt
                'Active?'
            ];

            for (const text of knownFalse) {
                assert.equal(isUniversalStaticText(text), false, `Expected "${text}" NOT to be static text`);
            }
        });
    });
});
