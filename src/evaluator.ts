const { hand, convert } = require('poker-calculator');

export default function eval(cards) {
    // Convert each card using the provided convert function
    const convertedCards = cards.map(card => convert(card));

    // Evaluate the hand using the imported hand function
    const evaluatedHand = hand(convertedCards);

    return evaluatedHand.value;
}
