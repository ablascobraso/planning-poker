import { describe, expect, it } from 'vitest';

import { cardNumber, isValidCard } from '../src/lib/scales';

describe('decks', () => {
    it('turns number cards into the number saved to Jira', () => {
        expect(cardNumber('8')).toBe(8);
        expect(cardNumber('0')).toBe(0);
        expect(cardNumber('½')).toBe(0.5);
    });

    it("has no number for cards that aren't numbers", () => {
        for (const card of ['?', '☕', 'XS', 'M', '', undefined, null, 5]) {
            expect(cardNumber(card), String(card)).toBeNull();
        }
    });

    it('only accepts cards from the chosen deck', () => {
        expect(isValidCard('fibonacci', '13')).toBe(true);
        expect(isValidCard('fibonacci', 'XL')).toBe(false);
        expect(isValidCard('tshirt', 'XL')).toBe(true);
        expect(isValidCard('no-such-deck', '1')).toBe(false);
    });
});
