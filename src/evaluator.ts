// @ts-ignore
import { hand, convert } from 'poker-calculator';

export default function evalHand(cards: string[]): number {
    // Convert each card using the provided convert function
    const convertedCards = cards.map(card => convert(card.charAt(0), card.charAt(1)));

    // Evaluate the hand using the imported hand function
    const evaluatedHand = hand(convertedCards);

    // Return the hand's value (ranking)
    return evaluatedHand.value;
}
