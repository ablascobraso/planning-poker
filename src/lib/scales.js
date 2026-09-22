// The backend owns the decks so the UI never has to keep a copy in sync:
// getState ships the cards for the active scale down to the client.

export const SCALES = {
    fibonacci: {
        label: 'Fibonacci',
        cards: ['0', '1', '2', '3', '5', '8', '13', '21', '?', '☕'],
    },
    tshirt: {
        label: 'T-shirt',
        cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕'],
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
    Object.entries(SCALES).map(([id, { label }]) => ({ id, label }));
