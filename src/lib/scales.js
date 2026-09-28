// The backend owns the decks so the UI never has to keep a copy in sync:
// getState ships the cards for the active scale down to the client.

// Ids are stored on sessions, so keep existing ones stable when editing decks.
export const SCALES = {
    fibonacci: {
        label: 'Fibonacci',
        cards: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕'],
    },
    modifiedFibonacci: {
        label: 'Modified Fibonacci',
        cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', '☕'],
    },
    tshirt: {
        label: 'T-shirts',
        cards: ['XS', 'S', 'M', 'L', 'XL', '?', '☕'],
    },
    powersOfTwo: {
        label: 'Powers of 2',
        cards: ['0', '1', '2', '4', '8', '16', '32', '64', '?', '☕'],
    },
};

export const DEFAULT_SCALE = 'fibonacci';

export const isValidScale = (scaleId) =>
    Object.prototype.hasOwnProperty.call(SCALES, scaleId);

export const isValidCard = (scaleId, card) =>
    isValidScale(scaleId) && SCALES[scaleId].cards.includes(card);

export const cardsFor = (scaleId) =>
    isValidScale(scaleId) ? SCALES[scaleId].cards : SCALES[DEFAULT_SCALE].cards;

export const scaleOptions = () =>
    Object.entries(SCALES).map(([id, { label, cards }]) => ({ id, label, cards }));
